// ============================================================================
// CALIXTO OMNISYSTEM - MOTOR DE PROCESSAMENTO (V12 PLATINUM OMNICHANNEL)
// ============================================================================

// ============================================================================
// 1. IMPORTAÇÕES E CONFIGURAÇÕES INICIAIS
// ============================================================================
const axios = require('axios'); // 🚀 NOVO: Necessário para atirar no Instagram
const sessions = require('./sessions');
const contratos = require('./contratos'); 
const path = require('path');
const fs = require('fs');

/**
 * Função utilitária para pausar a execução assincronamente.
 * Usada para simular o tempo de digitação humana do robô.
 * @param {number} ms - Milissegundos de pausa
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


// ============================================================================
// 2. UTILITÁRIOS DO SISTEMA (CORE ENGINE)
// ============================================================================

/**
 * Limpa agendamentos que já passaram de 2 horas para não inflar o banco.
 */
async function limparAgendamentosAntigos(prisma, clienteId) {
    try {
        const margem = new Date(new Date().getTime() - (120 * 60 * 1000)); 
        await prisma.lembrete.deleteMany({ 
            where: { clienteId: clienteId, dataAgendada: { lt: margem } } 
        });
    } catch (e) { console.error("[CRON] Erro na faxina:", e.message); }
}

/**
 * Normaliza textos (remove acentos, cedilhas e põe em minúsculas).
 * Essencial para comparar o que o cliente digitou com as opções do Menu.
 */
function normalizar(texto) {
    if (!texto) return "";
    return String(texto).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

/**
 * Calcula o tempo de "digitando..." baseado no tamanho do texto.
 * Mínimo de 1s, Máximo de 5s.
 */
function calcularTempo(texto) {
    if (!texto) return 1000;
    return Math.min(1000 + (String(texto).length * 50), 5000);
}

/**
 * Lê o JSON do Drawflow e descobre qual é o ID do próximo nó conectado.
 */
function getNextNodeId(node, outputName = 'output_1') {
    try { return node?.outputs?.[outputName]?.connections?.[0]?.node || null; } 
    catch (e) { return null; }
}

/**
 * Define quanto tempo (em segundos) o bot aguarda a resposta do cliente.
 */
function getTTL(node) {
    if (!node) return 60;
    if (node.name === 'espera') return parseInt(node.data?.time) || 60;
    if (node.name === 'pergunta') return 3600; // 1 hora para perguntas
    return (parseInt(node.data?.timeout) || 60) * 60;
}

/**
 * Mini-NLP (Processamento de Linguagem) para interpretar datas e horas digitadas.
 * Suporta formatos como "31/03 14:00" ou apenas "14:00".
 */
function tratarDataAmigavel(texto) {
    try {
        if (!texto) return null;
        const txt = normalizar(texto);
        const agora = new Date();
        
        let dia = agora.getDate();
        let mes = agora.getMonth();
        let ano = agora.getFullYear();

        if (txt.includes('amanha')) {
            const amanha = new Date(agora);
            amanha.setDate(amanha.getDate() + 1);
            dia = amanha.getDate();
            mes = amanha.getMonth();
            ano = amanha.getFullYear();
        }

        const matchHora = texto.match(/(\d{1,2})[:hH](\d{2})?/);
        const matchData = texto.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);

        if (matchData) {
            dia = parseInt(matchData[1]);
            mes = parseInt(matchData[2]) - 1;
            if (matchData[3]) ano = matchData[3].length === 2 ? 2000 + parseInt(matchData[3]) : parseInt(matchData[3]);
        }

        if (matchHora) {
            return new Date(ano, mes, dia, parseInt(matchHora[1]), parseInt(matchHora[2] || 0), 0);
        }
        
        const dP = new Date(texto);
        return isNaN(dP.getTime()) ? null : dP;
    } catch (e) { return null; }
}

/**
 * Converte números inteiros em Emojis para o WhatsApp.
 */
function getEmojiNumber(num) {
    const emojis = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
    return emojis[parseInt(num)] || num;
}

/**
 * 🚀 FUNÇÃO OMNICHANNEL: Decide por qual cano a mensagem vai sair.
 */
async function enviarMensagemOmni(sock, remoteJid, texto, origem, igToken) {
    if (origem === 'WHATSAPP' && sock) {
        await sock.sendMessage(remoteJid, { text: texto });
        console.log(`[ENGINE] 🟢 Resposta enviada no WhatsApp para: ${remoteJid}`);
        
    } else if (origem === 'INSTAGRAM') {
        try {
            // CORREÇÃO: O domínio correto ao usar Page Access Token é graph.facebook.com
            await axios.post(`https://graph.facebook.com/v20.0/me/messages`, {
                recipient: { id: remoteJid },
                message: { text: texto }
            }, {
                headers: { 
                    'Authorization': `Bearer ${igToken}`, 
                    'Content-Type': 'application/json' 
                }
            });
            console.log(`[ENGINE] 🟣 Resposta enviada no Instagram para: ${remoteJid}`);
            
        } catch (e) { 
            console.error("❌ Erro ao enviar IG:", e?.response?.data || e.message); 
        }
    }
}

// ============================================================================
// 3. MOTOR DE PROCESSAMENTO DE MENSAGENS (O CÉREBRO)
// ============================================================================

/**
 * Ponto de entrada de todas as mensagens. Analisa o estado do usuário,
 * verifica regras de negócio, salva variáveis e decide o próximo passo.
 */
// 🚀 Adicionamos 'origem' e 'igToken' no final da assinatura
async function processarMensagem(clienteId, remoteJid, textoMsg, sock, prisma, pushName, origem = 'WHATSAPP', igToken = null) {
    try {
        // 3.1 Sanitização do Número
        const userNum = String(remoteJid).replace(/:[0-9]+/g, '').replace(/@lid/g, '@s.whatsapp.net');
        if (userNum.endsWith('@g.us')) return; // Ignora grupos

        const msgLimpa = String(textoMsg).toUpperCase().trim();

        // 3.2 Comandos Globais (Override)
        if (msgLimpa.includes('#BOT') || msgLimpa.includes('3BOT')) {
            await sessions.setPausado(userNum, false);
            return await enviarMensagemOmni(sock, remoteJid, "🤖 *Robô Reativado!*", origem, igToken);
        }
        if (msgLimpa.includes('#RESET')) {
            await sessions.limparSessao(userNum);
            await sessions.setPausado(userNum, false);
            return await enviarMensagemOmni(sock, remoteJid, "🔄 *Sessão reiniciada!*", origem, igToken);
        }
        if (await sessions.isPausado(userNum)) return;

        // 3.3 Validação do Cliente (SaaS)
        await limparAgendamentosAntigos(prisma, clienteId);
        const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
        if (!cliente || cliente.status !== 'ONLINE' || !cliente.fluxoJson) return;

        const fluxoData = cliente.fluxoJson.drawflow?.Home?.data;
        if (!fluxoData) return;

        let estadoAtualId = await sessions.getEtapaUsuario(userNum);
        let proximoId = null;

        // 3.4 Descoberta de Posição no Funil
        if (!estadoAtualId) {
            const startNode = Object.values(fluxoData).find(n => n.name === 'inicio');
            proximoId = getNextNodeId(startNode);
        } else {
            const noAtual = fluxoData[estadoAtualId];
            if (!noAtual) return await sessions.limparSessao(userNum);

            // 🛡️ Prevenção: Garante que dadosSessao nunca seja undefined
            const dadosSessao = (await sessions.getDadosUsuario(userNum)) || {};

            // --- TRATAMENTO DE NÓ TIPO: PERGUNTA ---
            if (noAtual.name === 'pergunta') {
                const variavel = noAtual.data?.variable || 'resposta';
                await sessions.salvarDadosUsuario(userNum, variavel, textoMsg);
                dadosSessao[variavel] = textoMsg; 

                // Gatilho: Cancelamento
                if (dadosSessao.lista_cancelamento && !isNaN(textoMsg.trim())) {
                    try {
                        const index = parseInt(textoMsg.trim()) - 1;
                        const ids = JSON.parse(dadosSessao.lista_cancelamento);
                        
                        if (parseInt(textoMsg.trim()) === 0) {
                            await sessions.salvarDadosUsuario(userNum, 'lista_cancelamento', null);
                            await enviarMensagemOmni(sock, remoteJid, "Operação encerrada.", origem, igToken);
                            proximoId = getNextNodeId(noAtual);
                        } else if (index >= 0 && index < ids.length) {
                            await prisma.lembrete.delete({ where: { id: ids[index] } });
                            await sessions.salvarDadosUsuario(userNum, 'lista_cancelamento', null);
                            await enviarMensagemOmni(sock, remoteJid, "✅ *Agendamento cancelado!*", origem, igToken);
                            proximoId = getNextNodeId(noAtual);
                        } else {
                            return await enviarMensagemOmni(sock, remoteJid, "❌ Número inválido. Tente novamente.", origem, igToken);
                        }
                    } catch (errJson) {
                        console.error("Erro no parse do cancelamento:", errJson);
                        await sessions.salvarDadosUsuario(userNum, 'lista_cancelamento', null);
                        proximoId = getNextNodeId(noAtual);
                    }
                } 
                // Gatilho: Busca de CPF
                else if (variavel === 'cpf_consulta') {
                    const cpfB = String(textoMsg).replace(/\D/g, ''); 
                    const agends = await prisma.lembrete.findMany({ 
                        where: { cpf: cpfB, clienteId }, orderBy: { dataAgendada: 'asc' } 
                    });
                    
                    if (agends.length === 0) {
                        await enviarMensagemOmni(sock, remoteJid, `❌ Nenhum agendamento futuro para o CPF ${cpfB}.`, origem, igToken);
                        proximoId = getNextNodeId(noAtual);
                    } else {
                        let lista = `📅 *SEUS AGENDAMENTOS (CPF: ${cpfB}):*\n\n`;
                        const idsParaCancelar = [];
                        agends.forEach((item, i) => {
                            lista += `${getEmojiNumber(i+1)} 🕒 *${item.dataAgendada.toLocaleString('pt-BR')}*\n`;
                            idsParaCancelar.push(item.id);
                        });
                        lista += "\n👉 Digite o número para **CANCELAR** ou *0* para sair.";
                        await sessions.salvarDadosUsuario(userNum, 'lista_cancelamento', JSON.stringify(idsParaCancelar));
                        return await enviarMensagemOmni(sock, remoteJid, lista, origem, igToken);
                    }
                } 
       // Gatilho: Criação de Agendamento
       else if (variavel === 'data_agendamento') {
        try {
            const textoLimpo = textoMsg.trim();
            
            // 🔒 TRAVA DE FORMATO: Valida exatamente "DD/MM HH:mm" (ex: 14/03 15:00)
            const regexData = /^\d{2}\/\d{2}\s\d{2}:\d{2}$/;
            
            if (!regexData.test(textoLimpo)) {
                await enviarMensagemOmni(sock, remoteJid, "❌ *Formato Inválido!*\n\nPor favor, digite exatamente no formato de data e hora.\nExemplo: *14/03 15:00*", origem, igToken);
                return; // Para a execução aqui e espera o cliente tentar de novo
            }

            // Se passou pelo Regex, tenta converter a data
            let dataC = tratarDataAmigavel(textoLimpo);
            
            // Verifica se a data faz sentido no calendário (ex: recusa 32/13 25:00)
            if (!dataC || isNaN(dataC.getTime())) {
                await enviarMensagemOmni(sock, remoteJid, "❌ *Data Inexistente!*\n\nEssa data não é válida no calendário. Tente novamente.\nExemplo: *31/03 14:00*", origem, igToken);
                return; 
            }
            
            dataC.setSeconds(0);
            
            // 🏢 Regra de Horário Comercial
            if (cliente.usarHorarioComercial === true) {
                const diaSemana = dataC.getDay(); 
                const hora = dataC.getHours();
                if (diaSemana === 0 || hora < 8 || hora >= 18) {
                    await enviarMensagemOmni(sock, remoteJid, "🏢 *Fora do Horário!*\n\nAtendemos de *Seg a Sáb, das 08:00 às 18:00*.\nEnvie outro horário, por favor.", origem, igToken);
                    return;
                }
            }
            
            // 🚫 Conflito de Horário (Double Booking)
            const horarioOcupado = await prisma.lembrete.findFirst({ 
                where: { clienteId: clienteId, dataAgendada: dataC } 
            });
            
            if (horarioOcupado) {
                await enviarMensagemOmni(sock, remoteJid, "❌ *Horário Indisponível!*\n\nEste horário já foi reservado por outra pessoa. Envie uma nova data/hora.", origem, igToken);
                return;
            }
                        // Gravação no Banco
                        const nomeF = dadosSessao.nome_cliente || dadosSessao.nome || pushName || "Cliente";
                        let cleanN = dadosSessao.telefone_lembrete ? String(dadosSessao.telefone_lembrete).replace(/\D/g, '') : userNum.split('@')[0].replace(/\D/g, '');
                        if (cleanN.length === 10 || cleanN.length === 11) cleanN = '55' + cleanN;

                        await prisma.lembrete.create({ 
                            data: { numero: cleanN, nome: nomeF, cpf: dadosSessao.cpf_cliente || dadosSessao.cpf || "S/N", mensagem: `Confirmado: ${nomeF}`, dataAgendada: dataC, clienteId: clienteId } 
                        });

                        const dataPt = dataC.toLocaleDateString('pt-BR');
                        const horaPt = dataC.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

                        // Confirma para o cliente IMEDIATAMENTE (No canal certo)
                        await enviarMensagemOmni(sock, remoteJid, `✅ *AGENDAMENTO CONFIRMADO!*\n\nSua consulta ficou para o dia *${dataPt}* às *${horaPt}*. Te enviaremos um lembrete. Até lá! 👋`, origem, igToken);

                        proximoId = getNextNodeId(noAtual);

                        // Notifica o gestor EM SEGUNDO PLANO (Sempre no WhatsApp, então usa sock.sendMessage)
                        if (cliente.numeroNotificacao && sock) {
                            let numG = String(cliente.numeroNotificacao).replace(/\D/g, '');
                            if (numG.length === 10 || numG.length === 11) numG = '55' + numG;

                            let jidGestor1 = numG + '@s.whatsapp.net';
                            let jidGestor2 = null;

                            if (numG.startsWith('55') && numG.length === 13) {
                                jidGestor2 = numG.slice(0, 4) + numG.slice(5) + '@s.whatsapp.net';
                            } else if (numG.startsWith('55') && numG.length === 12) {
                                jidGestor2 = numG.slice(0, 4) + '9' + numG.slice(4) + '@s.whatsapp.net';
                            }

                            let jidFinalGestor = jidGestor1;

                            try {
                                const [resG1] = await sock.onWhatsApp(jidGestor1);
                                if (resG1 && resG1.exists) jidFinalGestor = resG1.jid;
                                else if (jidGestor2) {
                                    const [resG2] = await sock.onWhatsApp(jidGestor2);
                                    if (resG2 && resG2.exists) jidFinalGestor = resG2.jid;
                                }
                            } catch (e) {}

                            const msgGestor = `🚀 *NOVO AGENDAMENTO (${origem})*\n\n👤 *Paciente:* ${nomeF}\n📅 *Data:* ${dataPt}\n🕒 *Horário:* ${horaPt}\n📱 *Contato:* ${cleanN}`;
                            
                            sock.sendMessage(jidFinalGestor, { text: msgGestor }).catch(e => console.error("❌ Falha ao avisar gestor:", e.message));
                        }

                    } catch (e) {
                        console.error("[AGENDAMENTO] Erro na criação:", e.message);
                        await enviarMensagemOmni(sock, remoteJid, "⚠️ Ocorreu um erro no sistema. Tente novamente.", origem, igToken);
                        return;
                    }
                } 
                else {
                    proximoId = getNextNodeId(noAtual);
                    console.log("🚨 [DEBUG GESTOR] Valor no banco:", cliente.numeroNotificacao); 

                    // Aviso silencioso
                    if (cliente.numeroNotificacao) {
                        let numG = cliente.numeroNotificacao.replace(/\D/g, '');
                    }
                }
            } 
            // --- TRATAMENTO DE NÓ TIPO: MENU ---
            else if (noAtual.name === 'menu') {
                const entrada = String(textoMsg).trim();
                const indexDigitado = parseInt(entrada) - 1; 
                // 🛡️ Proteção: Garante que noAtual.data existe
                const chavesOpcoes = Object.keys(noAtual.data || {})
                    .filter(k => k.startsWith('opcao'))
                    .sort((a, b) => parseInt(a.replace('opcao', '')) - parseInt(b.replace('opcao', '')));
                
                let key = null;

                if (!isNaN(indexDigitado) && indexDigitado >= 0 && indexDigitado < chavesOpcoes.length) {
                    key = `output_${chavesOpcoes[indexDigitado].replace('opcao', '')}`;
                }
                if (!key) {
                    chavesOpcoes.forEach(k => {
                        if (normalizar(noAtual.data[k]).includes(normalizar(entrada))) key = `output_${k.replace('opcao', '')}`;
                    });
                }
                
                proximoId = getNextNodeId(noAtual, key);
                // Fallback para porta de erro/inválido
                if (!proximoId) {
                    proximoId = getNextNodeId(noAtual, `output_${chavesOpcoes.length + 2}`);
                }
            } 
            else {
                proximoId = getNextNodeId(noAtual);
            }
        }

        // LOG DE DEPURAÇÃO (Adicione aqui)
        console.log(`🔍 [DEBUG ENGINE] Estado Atual: ${estadoAtualId || 'Início'}`);
        console.log(`🎯 [DEBUG ENGINE] Próximo Nó ID: ${proximoId}`);

        // 3.5 Despachante Final
        if (proximoId) {
            await executarNo(proximoId, cliente.fluxoJson, sock, remoteJid, userNum, clienteId, prisma, pushName, origem, igToken);
        } else {
            console.log("⚠️ [DEBUG ENGINE] Fluxo parou: Nenhum próximo nó encontrado.");
        }


    } catch (error) {
        console.error(`[ENGINE] Erro Geral no Processamento:`, error.message);
    }
}


// ============================================================================
// 4. TRADUTOR DE VARIÁVEIS E EXECUTOR RECURSIVO (A MÁQUINA DE ESTADOS)
// ============================================================================

/**
 * Lê variáveis salvas do usuário e as substitui no texto atual.
 * Ex: Transforma "Olá {{nome}}" em "Olá Vitor".
 */
async function traduzirVariaveis(texto, userNum) {
    if (!texto) return "";
    try {
        const variaveisSalvas = await sessions.getDadosUsuario(userNum); 
        if (!variaveisSalvas || Object.keys(variaveisSalvas).length === 0) return texto;

        let textoTraduzido = String(texto);
        Object.keys(variaveisSalvas).forEach(chave => {
            const regex = new RegExp(`{{${chave}}}`, 'g');
            // 🛡️ Previne undefined ao substituir
            textoTraduzido = textoTraduzido.replace(regex, variaveisSalvas[chave] || "");
        });
        return textoTraduzido;
    } catch (e) { return texto; }
}

/**
 * Função recursiva que executa a ação do nó atual (enviar mensagem, áudio, PDF)
 * e avança automaticamente para o próximo nó se for uma ação direta.
 */
// 🚀 Assinatura atualizada com origem e igToken
async function executarNo(nodeId, fluxoDataCompleto, sock, remoteJid, userNum, clienteId, prisma, pushName, origem = 'WHATSAPP', igToken = null) {
    try {
        const node = fluxoDataCompleto?.drawflow?.Home?.data?.[nodeId];
        if (!node) return;

        await sessions.setEtapaUsuario(userNum, nodeId, getTTL(node), clienteId, remoteJid);

        // --- AÇÃO: TEXTO (Mensagem, Pergunta, Menu) ---
        if (node.name === 'mensagem' || node.name === 'pergunta' || node.name === 'menu') {
            let txtRaw = node.data?.message || node.data?.question || "";
            let txt = await traduzirVariaveis(txtRaw, userNum);

            if (node.name === 'menu') {
                let opts = "";
                const chavesOrdenadas = Object.keys(node.data || {})
                    .filter(k => k.startsWith('opcao'))
                    .sort((a, b) => parseInt(a.replace('opcao', '')) - parseInt(b.replace('opcao', '')));
                    
                chavesOrdenadas.forEach((k, index) => {
                    opts += `\n${getEmojiNumber(index + 1)} - ${node.data[k]}`;
                });
                txt += `\n${opts}`;
            }

            if (txt) {
                if (origem === 'WHATSAPP' && sock) await sock.sendPresenceUpdate('composing', remoteJid);
                await delay(calcularTempo(txt));
                // 🚀 Disparo Omni
                await enviarMensagemOmni(sock, remoteJid, txt, origem, igToken);
            }

            // Mensagem simples avança sozinha. Pergunta e Menu esperam resposta.
            if (node.name === 'mensagem') {
                const next = getNextNodeId(node);
                if (next) await executarNo(next, fluxoDataCompleto, sock, remoteJid, userNum, clienteId, prisma, pushName, origem, igToken);
            }
        } 
        
        // --- AÇÃO: MÍDIA (Foto, Vídeo, Áudio) ---
        else if (node.name === 'midia' || node.name === 'audio') {
            if (origem === 'INSTAGRAM') {
                // 🛡️ Fallback de segurança para a Meta API
                await enviarMensagemOmni(sock, remoteJid, "📄 [Mídia recebida - Verifique no WhatsApp]", origem, igToken);
            } else if (origem === 'WHATSAPP' && sock && node.data?.url) {
                try {
                    const filePath = path.join(__dirname, '..', 'public', 'uploads', path.basename(node.data.url));
                    if (fs.existsSync(filePath)) {
                        const buffer = fs.readFileSync(filePath);
                        const ext = path.extname(node.data.url).toLowerCase();
                        await sock.sendPresenceUpdate(node.name === 'audio' ? 'recording' : 'composing', remoteJid);
                        await delay(1500);

                        if (ext === '.pdf') {
                            // PDFs devem ser enviados como 'document' e precisam de fileName e mimetype
                            const nomeArquivo = path.basename(node.data.url);
                            await sock.sendMessage(remoteJid, { 
                                document: { url: filePath },
                                fileName: nomeArquivo, 
                                mimetype: 'application/pdf',
                                caption: node.data.caption || '' // Opcional, o WhatsApp aceita legenda em docs dependendo da versão
                            });
                        }

                       else if (ext === '.mp4') {
                            await sock.sendMessage(remoteJid, { video: buffer, caption: node.data.caption || '', mimetype: 'video/mp4' });
                        } else if (['.jpg', '.png', '.jpeg', '.webp'].includes(ext)) {
                            await sock.sendMessage(remoteJid, { image: buffer, caption: node.data.caption || '' });
                        } else {
                            await sock.sendMessage(remoteJid, { audio: buffer, mimetype: 'audio/mp4', ptt: node.name === 'audio' });
                        }
                    } else {
                        console.warn(`[ENGINE] Arquivo não encontrado: ${filePath}`);
                    }
                } catch (e) { console.error(`[ENGINE] Erro mídia:`, e.message); }
            }
            
            const next = getNextNodeId(node);
            if (next) await executarNo(next, fluxoDataCompleto, sock, remoteJid, userNum, clienteId, prisma, pushName, origem, igToken);
        }

        // --- AÇÃO: TRANSBORDO HUMANO ---
        else if (node.name === 'transferir') {
            try {
                const dadosSessao = await sessions.getDadosUsuario(userNum) || {};
                const nomeReal = dadosSessao.nome_cliente || dadosSessao.nome || pushName || "Cliente";
                let isLid = userNum.includes('@lid');
                let numeroReal = userNum.split('@')[0].split(':')[0].replace(/\D/g, '');
                let numeroSalvo = String(dadosSessao.telefone || dadosSessao.whatsapp || "").replace(/\D/g, '');

                if (numeroSalvo.length >= 10) { numeroReal = numeroSalvo; isLid = false; }
                if (!isLid && (numeroReal.length === 10 || numeroReal.length === 11)) numeroReal = '55' + numeroReal;

                // 1. Avisa o cliente IMEDIATAMENTE 
                await enviarMensagemOmni(sock, remoteJid, node.data?.message || "⏳ Um especialista continuará seu atendimento em instantes...", origem, igToken);
                await sessions.setPausado(userNum, true);

                // 2. Dispara a notificação para o gestor (Em Background - Sempre no WhatsApp)
                if (node.data?.notificacao && sock && origem === 'WHATSAPP') {
                    let numG = String(node.data.notificacao).replace(/\D/g, '');
                    console.log(`\n🚨 [TRANSBORDO] Iniciando notificação para o número: ${numG}`);

                    if (numG.length === 10 || numG.length === 11) numG = '55' + numG;

                    let jidTentativa1 = numG + '@s.whatsapp.net';
                    let jidTentativa2 = null;

                    if (numG.startsWith('55') && numG.length === 13) {
                        jidTentativa2 = numG.slice(0, 4) + numG.slice(5) + '@s.whatsapp.net'; 
                    } else if (numG.startsWith('55') && numG.length === 12) {
                        jidTentativa2 = numG.slice(0, 4) + '9' + numG.slice(4) + '@s.whatsapp.net'; 
                    }

                    let jidFinalGestor = jidTentativa1;

                    try {
                        const [res1] = await sock.onWhatsApp(jidTentativa1);
                        if (res1 && res1.exists) { jidFinalGestor = res1.jid; } 
                        else if (jidTentativa2) {
                            const [res2] = await sock.onWhatsApp(jidTentativa2);
                            if (res2 && res2.exists) { jidFinalGestor = res2.jid; }
                        }
                    } catch (e) { console.warn(`⚠️ [TRANSBORDO] Não foi possível validar o JID na Meta, usando padrão...`); }

                    let msgNotif = `🚨 *ATENDIMENTO HUMANO SOLICITADO*\n\n👤 *Cliente:* ${nomeReal}\n`;
                    if (isLid || numeroReal.length > 13) {
                        msgNotif += `📱 *Número:* Oculto pela Meta (Anúncio)\n👉 Abra o WhatsApp no celular/web para responder a mensagem mais recente.\n\n`;
                    } else {
                        msgNotif += `📱 *Número:* ${numeroReal}\n👉 *Link direto:* https://wa.me/${numeroReal}\n\n`;
                    }
                    msgNotif += `💡 Quando finalizar, envie *#BOT* na conversa do cliente para reativar a automação.`;

                    sock.sendMessage(jidFinalGestor, { text: msgNotif })
                        .then(() => console.log(`[TRANSBORDO] ✅ Notificação entregue com sucesso para ${jidFinalGestor}`))
                        .catch(err => console.error(`[TRANSBORDO] ❌ Falha ao notificar a equipe:`, err.message));
                } 
                else if (node.data?.notificacao && origem === 'INSTAGRAM') {
                     console.log(`[TRANSBORDO-IG] Transferência via Instagram solicitada. O atendente deve olhar a DM.`);
                }
            } catch (e) { console.error("[ENGINE] Erro geral no bloco de transbordo:", e.message); }
        }

        // --- AÇÃO: ROTEADOR DE HORÁRIO ---
        else if (node.name === 'horario') {
            const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
            const minAtual = (agora.getHours() * 60) + agora.getMinutes();
            const [h1, m1] = (node.data?.inicio || "09:00").split(':').map(Number);
            const [h2, m2] = (node.data?.fim || "18:00").split(':').map(Number);
            
            const portaSaida = (minAtual >= (h1 * 60 + m1) && minAtual < (h2 * 60 + m2)) ? 'output_1' : 'output_2';
            const next = getNextNodeId(node, portaSaida);
            if (next) await executarNo(next, fluxoDataCompleto, sock, remoteJid, userNum, clienteId, prisma, pushName, origem, igToken);
        }

        // --- AÇÃO: ESPERA (DELAY) ---
        else if (node.name === 'espera') {
            await delay((parseInt(node.data?.time) || 5) * 1000);
            const next = getNextNodeId(node);
            if (next) await executarNo(next, fluxoDataCompleto, sock, remoteJid, userNum, clienteId, prisma, pushName, origem, igToken);
        }

        // --- AÇÃO: GERAR PDF ---
        else if (node.name === 'gerar_documento') {
            try {
                if (!node.data?.templateId) {
                    await enviarMensagemOmni(sock, remoteJid, "⚠️ *Erro interno:* Modelo de contrato não selecionado.", origem, igToken);
                } 
                else if (origem === 'WHATSAPP' && sock) {
                    await sock.sendPresenceUpdate('composing', remoteJid);
                    const dados = await sessions.getDadosUsuario(userNum);
                    const res = await contratos.processarContrato(prisma, node.data.templateId, dados, userNum);
                    
                    if (res?.caminhoArquivo && fs.existsSync(res.caminhoArquivo)) {
                        await sessions.salvarDadosUsuario(userNum, 'ultimo_pdf_path', res.caminhoArquivo);
                        await sock.sendMessage(remoteJid, { document: fs.readFileSync(res.caminhoArquivo), fileName: res.nomeArquivo, mimetype: 'application/pdf' });
                    }
                } 
                else if (origem === 'INSTAGRAM') {
                     await enviarMensagemOmni(sock, remoteJid, "📄 [Documento gerado - Disponível apenas via WhatsApp]", origem, igToken);
                }
            } catch (e) { console.error("[ENGINE] Erro contrato:", e.message); }
            
            const next = getNextNodeId(node);
            if (next) await executarNo(next, fluxoDataCompleto, sock, remoteJid, userNum, clienteId, prisma, pushName, origem, igToken);
        }

        // --- AÇÃO: ENVIAR PDF PARA TERCEIRO ---
        else if (node.name === 'enviar_para') {
            try {
                const dados = await sessions.getDadosUsuario(userNum) || {};
                // Só envia para terceiro se estiver no WPP, pois o Insta não suporta mandar arquivos para números genéricos
                if (dados.ultimo_pdf_path && fs.existsSync(dados.ultimo_pdf_path) && origem === 'WHATSAPP' && sock) {
                    let numD = String(node.data?.numero || "").replace(/\D/g, '');
                    if (numD.length === 10 || numD.length === 11) numD = '55' + numD;
                    await sock.sendMessage(numD + '@s.whatsapp.net', { document: fs.readFileSync(dados.ultimo_pdf_path), fileName: "Documento.pdf", mimetype: 'application/pdf' });
                }
            } catch (e) { console.error("[ENGINE] Erro enviar_para:", e.message); }
            
            const next = getNextNodeId(node);
            if (next) await executarNo(next, fluxoDataCompleto, sock, remoteJid, userNum, clienteId, prisma, pushName, origem, igToken);
        }
        
        // --- AÇÃO: FINALIZAR (LIMPAR SESSÃO) ---
        else if (node.name === 'finalizar') {
            await sessions.limparSessao(userNum);
        }

    } catch (error) {
        console.error("[ENGINE] Erro crítico no executarNo:", error.message);
    }
}
// ============================================================================
// 5. EXECUTOR DE TIMEOUT (ACIONADO PELO CRON/WORKER DE LIMPEZA)
// ============================================================================

/**
 * Movimenta o usuário para a porta "Timeout" do Drawflow caso ele demore
 * muito tempo para responder uma pergunta ou menu.
 */
// 🚀 Assinatura atualizada para repassar a origem e o token do Instagram
async function executarTimeout(userNum, clienteId, remoteJid, nodeId, prisma, sock, pushName, origem = 'WHATSAPP', igToken = null) {
    try {
        const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
        if (!cliente || !cliente.fluxoJson) return;

        const node = cliente.fluxoJson.drawflow?.Home?.data?.[nodeId];
        if (!node) return;

        const totalOpcoes = Object.keys(node.data || {}).filter(k => k.startsWith('opcao')).length;
        const nextId = getNextNodeId(node, `output_${totalOpcoes + 1}`);
        
        if (nextId) {
            // 🚀 Propaga as variáveis OmniChannel para a máquina de estados
            await executarNo(nextId, cliente.fluxoJson, sock, remoteJid, userNum, clienteId, prisma, pushName, origem, igToken);
        }
    } catch (e) {
        console.error("[ENGINE] Erro no timeout:", e.message);
    }
}


// ============================================================================
// 6. EXPORTAÇÕES GLOBAIS
// ============================================================================
module.exports = { 
    processarMensagem, 
    executarNo, 
    executarTimeout 
};