// ============================================================================
// CALIXTO OMNISYSTEM - MOTOR DE PROCESSAMENTO (V12 PLATINUM OMNICHANNEL)
// ============================================================================

// ============================================================================
// 1. IMPORTAÇÕES E CONFIGURAÇÕES INICIAIS
// ============================================================================
const axios = require('axios'); // 🚀 NOVO: Necessário para atirar no Instagram
const sessions = require('./sessions');
const contratos = require('./contratos'); 
const agenda = require('./agenda');
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
 * Apaga agendamentos com mais de 90 dias para não inflar o banco
 * (os recentes ficam para aparecer no histórico da agenda).
 */
async function limparAgendamentosAntigos(prisma, clienteId) {
    try {
        const margem = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        await prisma.lembrete.deleteMany({ 
            where: { clienteId: clienteId, dataAgendada: { lt: margem }, OR: [{ fim: null }, { fim: { lt: margem } }] } 
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
 * @param {number|string} num - Número da opção (1, 2, ... 25)
 * @param {boolean} usarEmoji - Se false, retorna número puro ("11"). Se true, usa emojis.
 * Suporta qualquer quantidade: 1-10 usa tabela fixa, 11+ compõe dígito a dígito (11 => 1️⃣1️⃣).
 */
const USAR_EMOJI_NAS_LISTAS = true; // Mude para false para desligar emojis em TODAS as listas por padrão

function getEmojiNumber(num, usarEmoji = USAR_EMOJI_NAS_LISTAS) {
    const n = parseInt(num);
    if (usarEmoji === false || usarEmoji === 'false' || usarEmoji === '0' || usarEmoji === 0) {
        return String(isNaN(n) ? num : n);
    }
    const emojis = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
    if (!isNaN(n) && n >= 0 && n <= 10) return emojis[n];
    // 11+: compõe dígito a dígito para não ficar sem emoji (ex: 12 => 1️⃣2️⃣)
    if (!isNaN(n) && n > 10) {
        const digitos = { '0': "0️⃣", '1': "1️⃣", '2': "2️⃣", '3': "3️⃣", '4': "4️⃣", '5': "5️⃣", '6': "6️⃣", '7': "7️⃣", '8': "8️⃣", '9': "9️⃣" };
        return String(n).split('').map(d => digitos[d] || d).join('');
    }
    return num;
}

/**
 * Decide se um nó de menu deve usar emojis.
 * O editor salva df-usarEmoji / df-semEmoji no node.data.
 * Por padrão (fluxos antigos sem o campo) mantém TRUE para não quebrar nada.
 */
function deveUsarEmoji(nodeData) {
    if (!nodeData) return USAR_EMOJI_NAS_LISTAS;
    // ATENÇÃO: o navegador minifica atributos HTML (df-usarEmoji vira df-usaremoji),
    // então o valor chega no banco em minúsculo. Checa as duas formas.
    const semEmoji = nodeData.semEmoji ?? nodeData.sememoji;
    if (semEmoji === true || semEmoji === 'true' || semEmoji === '1' || semEmoji === 1 || semEmoji === 'on') return false;
    const usarEmoji = nodeData.usarEmoji ?? nodeData.usaremoji;
    if (usarEmoji === false || usarEmoji === 'false' || usarEmoji === '0' || usarEmoji === 0 || usarEmoji === 'off') return false;
    return true;
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
async function processarMensagem(clienteId, remoteJid, textoMsg, sock, prisma, pushName, origem = 'WHATSAPP', igToken = null) {
    try {
        // 3.1 Sanitização do Número
        const userNum = String(remoteJid).replace(/:[0-9]+/g, '').replace(/@lid/g, '@s.whatsapp.net');
        if (userNum.endsWith('@g.us')) return; // Ignora grupos

        const msgLimpa = String(textoMsg).toUpperCase().trim();

         // 3.2 Comandos Globais (Override)
        
        // COMANDO: REATIVAR (#BOT ou #DESPAUSAR)
        if (msgLimpa.includes('#BOT') || msgLimpa.includes('3BOT') || msgLimpa.includes('#DESPAUSAR') || msgLimpa.includes('#RESUME')) {
            await sessions.setPausado(userNum, false);
            return await enviarMensagemOmni(sock, remoteJid, "▶️ *Robô Reativado!*", origem, igToken);
        }

        // COMANDO: RESETAR
        if (msgLimpa.includes('#RESET')) {
            await sessions.limparSessao(userNum);
            await sessions.setPausado(userNum, false);
            return await enviarMensagemOmni(sock, remoteJid, "🔄 *Sessão reiniciada!*", origem, igToken);
        }

        // COMANDO: PAUSAR (#PAUSE ou #PAUSAR)
        if (msgLimpa.includes('#PAUSE') || msgLimpa.includes('#PAUSAR')) {
            await sessions.setPausado(userNum, true);
            return await enviarMensagemOmni(sock, remoteJid, "⏸️ *Automação Pausada.*\nO bot não responderá mais este número até que você envie *#BOT* ou *#DESPAUSAR*.", origem, igToken);
        }

        // VERIFICAÇÃO DE STATUS: Se estiver pausado, o código morre aqui e não responde o cliente
        if (await sessions.isPausado(userNum)) return;

        // 3.3 Validação do Cliente (SaaS)
        await limparAgendamentosAntigos(prisma, clienteId);
        const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
        if (!cliente || cliente.status !== 'ONLINE' || !cliente.fluxoJson) return;

        const fluxoData = cliente.fluxoJson.drawflow?.Home?.data;
        if (!fluxoData) return;

        // ==========================================================
        // 🔐 3.3b ACESSO SECRETO (bloco configurável no editor)
        // Híbrido: "#COMANDO" sozinho pede senha / "#COMANDO SENHA" entra direto.
        // Bloco isolado (inputs=0): só entra digitando comando+senha, senão segue inicio normal.
        // ==========================================================
        try {
            const dadosPre = (await sessions.getDadosUsuario(userNum)) || {};
            const nosSecretos = Object.entries(fluxoData || {})
                .filter(([, n]) => n && n.name === 'acesso_secreto' && String(n.data?.comando || '').trim() !== '')
                .sort((a, b) => String(b[1].data.comando).length - String(a[1].data.comando).length);

            const entrarNoSecreto = async (secretNode) => {
                await sessions.salvarDadosUsuario(userNum, 'aguardando_senha_para', null);
                await sessions.setPausado(userNum, false);
                const nextSecreto = getNextNodeId(secretNode);
                if (nextSecreto) {
                    await executarNo(nextSecreto, cliente.fluxoJson, sock, remoteJid, userNum, clienteId, prisma, pushName, origem, igToken);
                } else {
                    await enviarMensagemOmni(sock, remoteJid, "🔓 *Acesso liberado!* Mas o bloco secreto está sem saída conectada (output_1).", origem, igToken);
                }
            };

            // 1) Usuário já digitou o comando e está aguardando a senha
            if (dadosPre.aguardando_senha_para) {
                const aguardId = String(dadosPre.aguardando_senha_para);
                const secretAguard = fluxoData[aguardId];
                if (secretAguard && secretAguard.name === 'acesso_secreto') {
                    const senhaEsperada = String(secretAguard.data?.senha ?? '').trim();
                    const tentativa = String(textoMsg).trim();
                    const msgErroFinal = String(secretAguard.data?.msg_erro ?? '').trim() || "❌ *Senha incorreta!* Tente novamente ou digite *0* para sair.";

                    if (tentativa === '0') {
                        await sessions.salvarDadosUsuario(userNum, 'aguardando_senha_para', null);
                        return await enviarMensagemOmni(sock, remoteJid, "❌ Acesso cancelado.", origem, igToken);
                    }
                    if (senhaEsperada !== '' && tentativa === senhaEsperada) {
                        return await entrarNoSecreto(secretAguard);
                    }
                    return await enviarMensagemOmni(sock, remoteJid, msgErroFinal, origem, igToken);
                } else {
                    // Bloco foi deletado do editor: limpa a trava e segue fluxo normal
                    await sessions.salvarDadosUsuario(userNum, 'aguardando_senha_para', null);
                }
            }

            // 2) Mensagem nova bate com algum comando secreto? (exato ou "COMANDO SENHA")
            if (nosSecretos.length > 0) {
                const textoTrim = String(textoMsg).trim();
                const textoUpper = textoTrim.toUpperCase();
                for (const [secretId, secretNode] of nosSecretos) {
                    const cmdRaw = String(secretNode.data?.comando || '').trim();
                    if (!cmdRaw) continue;
                    const cmdUpper = cmdRaw.toUpperCase();
                    const senhaNode = String(secretNode.data?.senha ?? '').trim();
                    const msgPede = String(secretNode.data?.msg_senha ?? '').trim() || "🔐 Digite a senha de acesso:";
                    const msgErroNode = String(secretNode.data?.msg_erro ?? '').trim() || "❌ *Senha incorreta!* Tente novamente ou digite *0* para sair.";

                    if (textoUpper === cmdUpper) {
                        await sessions.salvarDadosUsuario(userNum, 'aguardando_senha_para', secretId);
                        return await enviarMensagemOmni(sock, remoteJid, await traduzirVariaveis(msgPede, userNum), origem, igToken);
                    }
                    if (textoUpper.startsWith(cmdUpper + ' ')) {
                        const resto = textoTrim.slice(cmdRaw.length).trim();
                        if (resto === '0') {
                            await sessions.salvarDadosUsuario(userNum, 'aguardando_senha_para', null);
                            return await enviarMensagemOmni(sock, remoteJid, "❌ Acesso cancelado.", origem, igToken);
                        }
                        if (senhaNode !== '' && resto === senhaNode) {
                            return await entrarNoSecreto(secretNode);
                        }
                        // Senha veio junto mas errada: trava em modo aguardando para retry
                        await sessions.salvarDadosUsuario(userNum, 'aguardando_senha_para', secretId);
                        return await enviarMensagemOmni(sock, remoteJid, await traduzirVariaveis(msgErroNode, userNum), origem, igToken);
                    }
                }
            }
        } catch (e) { console.error("[ACESSO_SECRETO] Erro:", e.message); }

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
                const textoLimpo = textoMsg.trim();
                let cpfValido = true; // Flag para saber se podemos salvar

              // ==========================================
                // 🔒 1. MOTOR DE VALIDAÇÃO DE CPF
                // ==========================================
                if (variavel === 'cpf_cliente' || variavel === 'cpf_consulta') {
                    
                    // 🛡️ INTERCEPTADOR: Se o cliente está no menu de cancelar, NÃO valida os 11 dígitos!
                    if (dadosSessao.lista_cancelamento) {
                        // Deixamos cpfValido como false para ele NÃO sobrescrever o CPF antigo com o "1" na memória
                        cpfValido = false; 
                    } 
                    else {
                        // ESCAPE: O cliente quer cancelar a digitação
                        if (textoLimpo === '0') {
                            await enviarMensagemOmni(sock, remoteJid, "↩️ Operação cancelada.", origem, igToken);
                            await sessions.salvarDadosUsuario(userNum, variavel, null);
                            proximoId = getNextNodeId(noAtual);
                            cpfValido = false; 
                        } 
                        // ERRO: Tem letras, espaços, pontos, ou não tem 11 números
                        else if (!/^\d{11}$/.test(textoLimpo)) {
                            await enviarMensagemOmni(sock, remoteJid, "❌ *CPF Inválido!*\n\nPor favor, digite exatamente *11 números*, sem espaços, pontos ou traços.\n\nExemplo: *12345678900*", origem, igToken);
                            return; // 🛑 Para a execução aqui. O cliente fica preso até acertar.
                        } 
                        // SUCESSO: É um CPF perfeito de 11 dígitos
                        else {
                            // Se for cadastro, envia a confirmação bonitinha
                            if (variavel === 'cpf_cliente') {
                                const cpfFormatado = textoLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
                                await enviarMensagemOmni(sock, remoteJid, `✅ CPF *${cpfFormatado}* validado e registrado com sucesso!`, origem, igToken);
                            }
                        }
                    }
                }

                // Só salva no banco se não tiver sido cancelado pelo escape '0' E se não for resposta de menu
                if (cpfValido) {
                    await sessions.salvarDadosUsuario(userNum, variavel, textoLimpo);
                    dadosSessao[variavel] = textoLimpo; 
                }

                // ==========================================
                // 🎯 2. GATILHOS DE NEGÓCIO E TRANSAÇÕES
                // ==========================================
                
                // Gatilho: Cancelamento de Consulta
                if (dadosSessao.lista_cancelamento && !isNaN(textoLimpo)) {
                    try {
                        const index = parseInt(textoLimpo) - 1;
                        const ids = JSON.parse(dadosSessao.lista_cancelamento);
                        
                        if (parseInt(textoLimpo) === 0) {
                            await sessions.salvarDadosUsuario(userNum, 'lista_cancelamento', null);
                            await enviarMensagemOmni(sock, remoteJid, "Operação de cancelamento encerrada.", origem, igToken);
                            proximoId = getNextNodeId(noAtual);
                        } else if (index >= 0 && index < ids.length) {
                            await prisma.lembrete.delete({ where: { id: ids[index] } });
                            await sessions.salvarDadosUsuario(userNum, 'lista_cancelamento', null);
                            await enviarMensagemOmni(sock, remoteJid, "✅ *Agendamento cancelado com sucesso!*", origem, igToken);
                            proximoId = getNextNodeId(noAtual);
                        } else {
                            return await enviarMensagemOmni(sock, remoteJid, "❌ Número inválido na lista. Tente novamente.", origem, igToken);
                        }
                    } catch (errJson) {
                        await sessions.salvarDadosUsuario(userNum, 'lista_cancelamento', null);
                        proximoId = getNextNodeId(noAtual);
                    }
                } 
                
                // Gatilho: Busca de CPF (Consulta de Horários do Paciente)
                else if (variavel === 'cpf_consulta' && cpfValido) {
                    const cpfB = textoLimpo; 
                    const agends = await prisma.lembrete.findMany({ 
 where: { cpf: cpfB, clienteId, dataAgendada: { gte: new Date() } }, orderBy: { dataAgendada: 'asc' } 
                    });
                    
                    if (agends.length === 0) {
                        // 🛑 Alternativa de Erro: Não achou o CPF, prende o usuário aqui até acertar ou desistir
                        await enviarMensagemOmni(sock, remoteJid, `❌ *CPF não encontrado!*\n\nNão achamos nenhum agendamento futuro para o CPF *${cpfB}*.\n\n👉 *Digite o CPF novamente* (só números) para corrigir, ou envie *0* para sair.`, origem, igToken);
                        await sessions.salvarDadosUsuario(userNum, variavel, null); // Limpa para forçar re-digitação
                        return; // Trava o fluxo aqui
                    } else {
                        let lista = `📅 *SEUS AGENDAMENTOS (CPF: ${cpfB}):*\n\n`;
                        const idsParaCancelar = [];
                        agends.forEach((item, i) => {
                            lista += `${getEmojiNumber(i+1)} 🕒 *${item.dataAgendada.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}*\n`;
                            idsParaCancelar.push(item.id);
                        });
                        lista += "\n👉 Digite o número correspondente para **CANCELAR** ou envie *0* para sair do menu.";
                        await sessions.salvarDadosUsuario(userNum, 'lista_cancelamento', JSON.stringify(idsParaCancelar));
                        return await enviarMensagemOmni(sock, remoteJid, lista, origem, igToken);
                    }
                }
                

                // ==========================================
                // 📅 Agenda: escolher dia e horário (menus numerados ou data digitada)
                // ==========================================
                else if (VARS_AGENDA.includes(variavel)) {
                    const resultado = await tratarRespostaAgenda({
                        sock, remoteJid, userNum, cliente, prisma, origem, igToken, pushName,
                        nodeId: estadoAtualId, variavel, dados: dadosSessao
                    }, textoLimpo);
                    if (resultado !== 'avancar') return;
                    proximoId = getNextNodeId(noAtual);
                }
                else {
                    proximoId = getNextNodeId(noAtual);
                }
            } 
            
            // --- TRATAMENTO DE NÓ TIPO: MENU ---
            else if (noAtual.name === 'menu') {
                const entrada = String(textoMsg).trim();
                const indexDigitado = parseInt(entrada) - 1; 
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

        // LOG DE DEPURAÇÃO
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

// ============================================================================
// 📅 AGENDA NA CONVERSA
// O cliente escolhe o dia e o horário respondendo com números, digita a data
// ("25/11 14:30", "amanhã 9h") ou abre o calendário visual pelo link.
// ============================================================================
const VARS_AGENDA = ['data_agendamento', 'ver_disponibilidade'];

function urlDoSiteAgenda() {
    try { return String(require('./email').lerConfig().siteUrl || process.env.BASE_URL || '').trim().replace(/\/+$/, ''); }
    catch (e) { return String(process.env.BASE_URL || '').replace(/\/+$/, ''); }
}

function linkDaAgenda(ctx) {
    const base = urlDoSiteAgenda();
    if (!base) return null;
    try {
        return `${base}/agendar/${agenda.criarToken({ c: ctx.cliente.id, u: ctx.userNum, j: ctx.remoteJid, o: ctx.origem, q: ctx.nodeId })}`;
    } catch (e) { return null; }
}

const salvarEstadoAgenda = (ctx, estado) => sessions.salvarDadosUsuario(ctx.userNum, 'agenda_estado', estado ? JSON.stringify(estado) : null);

async function mostrarDiasAgenda(ctx, prefixo = '') {
    const dias = await agenda.proximosDias(ctx.prisma, ctx.cliente, { quantidade: 7 });
    if (!dias.length) {
        await salvarEstadoAgenda(ctx, null);
        await enviarMensagemOmni(ctx.sock, ctx.remoteJid, `${prefixo}😕 *Agenda cheia por enquanto.*\n\nNão há horários livres nos próximos dias. Tente de novo mais tarde ou fale com a gente por aqui.`, ctx.origem, ctx.igToken);
        return;
    }
    const reservar = ctx.variavel === 'data_agendamento';
    const exemplo = `${agenda.dataCurta(dias[0].livres[0])} ${agenda.hora(dias[0].livres[0])}`;
    let msg = `${prefixo}📅 *Escolha o melhor dia:*\n\n`;
    msg += dias.map((d, i) => `${getEmojiNumber(i + 1)} ${d.rotulo}  _(${d.livres.length} ${d.livres.length === 1 ? 'horário' : 'horários'})_`).join('\n');
    msg += `\n\nResponda com o *número* do dia.`;
    msg += reservar ? `\n✍️ Ou digite a data e a hora, ex: *${exemplo}*` : `\n✍️ Ou digite a data, ex: *${agenda.dataCurta(dias[0].livres[0])}*`;
    if (reservar) {
        const link = linkDaAgenda(ctx);
        if (link) msg += `\n\n🗓️ *Prefere ver no calendário?* Toque no link e escolha:\n${link}`;
    }
    await salvarEstadoAgenda(ctx, { etapa: 'dias', dias: dias.map(d => d.chave) });
    await enviarMensagemOmni(ctx.sock, ctx.remoteJid, msg, ctx.origem, ctx.igToken);
}

function blocoDeHorarios(livres, numerado) {
    const grupos = [['☀️ *Manhã*', []], ['🌤️ *Tarde*', []], ['🌙 *Noite*', []]];
    livres.forEach((d, i) => {
        const h = agenda.partes(d).h;
        grupos[h < 12 ? 0 : h < 18 ? 1 : 2][1].push(numerado ? `*${i + 1})* ${agenda.hora(d)}` : agenda.hora(d));
    });
    return grupos.filter(g => g[1].length).map(([titulo, itens]) => {
        const linhas = [];
        const porLinha = numerado ? 3 : 4;
        for (let i = 0; i < itens.length; i += porLinha) linhas.push(itens.slice(i, i + porLinha).join('     '));
        return `${titulo}\n${linhas.join('\n')}`;
    }).join('\n\n');
}

async function mostrarHorasAgenda(ctx, chave, livres, prefixo = '') {
    const numerado = ctx.variavel === 'data_agendamento';
    let msg = `${prefixo}🕒 *${agenda.rotuloDia(chave)}*: horários livres\n\n${blocoDeHorarios(livres, numerado)}`;
    if (numerado) {
        msg += `\n\nResponda com o *número* do horário.\n0️⃣ Voltar para os dias`;
        await salvarEstadoAgenda(ctx, { etapa: 'horas', chave, horas: livres.map(d => d.toISOString()) });
    }
    await enviarMensagemOmni(ctx.sock, ctx.remoteJid, msg, ctx.origem, ctx.igToken);
}

// Chamado quando o robô faz a pergunta de agenda
async function abrirAgendaNaConversa(ctx) {
    try {
        if (ctx.variavel === 'data_agendamento' && ctx.dados.agenda_dia) {
            const chave = ctx.dados.agenda_dia;
            await sessions.salvarDadosUsuario(ctx.userNum, 'agenda_dia', null);
            const livres = await agenda.livresNoDia(ctx.prisma, ctx.cliente, chave);
            if (livres.length) return await mostrarHorasAgenda(ctx, chave, livres);
        }
        await mostrarDiasAgenda(ctx);
    } catch (e) {
        console.error('[AGENDA] Erro ao mostrar a agenda:', e.message);
    }
}

async function confirmarReservaAgenda(ctx, data) {
    const d = ctx.dados || {};
    const nome = d.nome_cliente || d.nome || ctx.pushName || 'Cliente';
    const numero = d.telefone_lembrete || String(ctx.userNum).split('@')[0];
    const r = await agenda.reservar(ctx.prisma, ctx.cliente, { data, nome, numero, cpf: d.cpf_cliente || d.cpf || d.cpf_usuario });
    if (!r.ok) {
        const cfg = agenda.configDe(ctx.cliente);
        const motivos = {
            ocupado: '❌ *Esse horário já está reservado.*',
            fechado: `🏢 *Fora do horário de atendimento.*\nAtendemos: ${agenda.resumoHorario(ctx.cliente)}.`,
            passado: '⏰ *Esse horário já passou ou está muito em cima da hora.*',
            longe: `📆 *A agenda está aberta só para os próximos ${cfg.diasAFrente} dias.*`,
            invalido: '❌ *Não entendi essa data.*'
        };
        const prefixo = (motivos[r.motivo] || motivos.invalido) + '\n\n';
        const chave = agenda.chaveDe(data);
        const livres = r.motivo === 'longe' ? [] : await agenda.livresNoDia(ctx.prisma, ctx.cliente, chave);
        if (livres.length) await mostrarHorasAgenda({ ...ctx, variavel: 'data_agendamento' }, chave, livres, prefixo + 'Veja o que ainda está livre nesse dia:\n\n');
        else await mostrarDiasAgenda({ ...ctx, variavel: 'data_agendamento' }, prefixo);
        return 'parar';
    }
    await salvarEstadoAgenda(ctx, null);
    await sessions.salvarDadosUsuario(ctx.userNum, 'data_agendamento', `${agenda.dataCurta(data)} ${agenda.hora(data)}`);
    await enviarMensagemOmni(ctx.sock, ctx.remoteJid, `✅ *Agendamento confirmado!*\n\n📅 ${agenda.textoCompleto(data)}\n\nVamos te mandar um lembrete antes. Até lá! 👋`, ctx.origem, ctx.igToken);
    agenda.avisarGestor(ctx.sock, ctx.cliente, `🚀 *NOVO AGENDAMENTO (${ctx.origem})*\n\n👤 *Cliente:* ${r.lembrete.nome}\n📅 *Data:* ${agenda.dataBR(data)}\n🕒 *Horário:* ${agenda.hora(data)}\n📱 *Contato:* ${r.lembrete.numero}`);
    return 'avancar';
}

// Chamado quando o cliente responde à pergunta de agenda. Retorna 'avancar' ou 'parar'.
async function tratarRespostaAgenda(ctx, texto) {
    const enviar = (msg) => enviarMensagemOmni(ctx.sock, ctx.remoteJid, msg, ctx.origem, ctx.igToken);
    try {
        let estado = null;
        try { estado = ctx.dados.agenda_estado ? JSON.parse(ctx.dados.agenda_estado) : null; } catch (e) {}
        const reservar = ctx.variavel === 'data_agendamento';
        const txt = String(texto || '').trim();

        const abrirDia = async (chave) => {
            const livres = await agenda.livresNoDia(ctx.prisma, ctx.cliente, chave);
            if (!livres.length) {
                await mostrarDiasAgenda(ctx, `😕 Não há horários livres em *${agenda.rotuloDia(chave)}*.\n\n`);
                return 'parar';
            }
            await mostrarHorasAgenda(ctx, chave, livres);
            if (reservar) return 'parar';
            // Só consulta: guarda o dia para a próxima pergunta (data_agendamento) já abrir nele
            await salvarEstadoAgenda(ctx, null);
            await sessions.salvarDadosUsuario(ctx.userNum, 'agenda_dia', chave);
            return 'avancar';
        };

        // 1) Data digitada
        const lido = agenda.interpretarTexto(txt);
        if (lido && lido.invalido) {
            await enviar('❌ *Essa data não existe no calendário.* Confira e envie de novo, ex: *25/11 14:30*');
            return 'parar';
        }
        if (lido) {
            if (lido.data && reservar) return await confirmarReservaAgenda(ctx, lido.data);
            return await abrirDia(lido.chave);
        }

        // 2) Número de uma lista
        if (/^\d{1,2}$/.test(txt) && estado) {
            const n = Number(txt);
            if (estado.etapa === 'horas') {
                if (n === 0) { await mostrarDiasAgenda(ctx); return 'parar'; }
                const iso = estado.horas[n - 1];
                if (!iso) { await enviar(`❌ Escolha um número de 1 a ${estado.horas.length}, ou *0* para voltar aos dias.`); return 'parar'; }
                return await confirmarReservaAgenda(ctx, new Date(iso));
            }
            if (estado.etapa === 'dias') {
                const chave = estado.dias[n - 1];
                if (!chave) { await enviar(`❌ Escolha um número de 1 a ${estado.dias.length}.`); return 'parar'; }
                return await abrirDia(chave);
            }
        }

        // 3) Não entendeu: repete o passo atual
        if (estado && estado.etapa === 'horas') {
            await enviar('🤔 Não entendi. Responda com o *número* do horário, ou *0* para voltar aos dias.');
        } else {
            await mostrarDiasAgenda(ctx, '🤔 Não entendi. ');
        }
        return 'parar';
    } catch (e) {
        console.error('[AGENDA] Erro ao tratar resposta:', e.message);
        await enviar('⚠️ Tivemos um problema ao consultar a agenda. Tente de novo em instantes.');
        return 'parar';
    }
}

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
                    
                const usarEmojiMenu = deveUsarEmoji(node.data);
                chavesOrdenadas.forEach((k, index) => {
                    opts += `\n${getEmojiNumber(index + 1, usarEmojiMenu)} - ${node.data[k]}`;
                });
                txt += `\n${opts}`;
            }

            if (txt) {
                if (origem === 'WHATSAPP' && sock) await sock.sendPresenceUpdate('composing', remoteJid);
                await delay(calcularTempo(txt));
                // 🚀 Disparo Omni
                await enviarMensagemOmni(sock, remoteJid, txt, origem, igToken);
            }

            // Pergunta de agenda: mostra os dias livres logo em seguida
            if (node.name === 'pergunta' && VARS_AGENDA.includes(node.data?.variable)) {
                const clienteAg = await prisma.cliente.findUnique({ where: { id: clienteId } });
                if (clienteAg) await abrirAgendaNaConversa({
                    sock, remoteJid, userNum, cliente: clienteAg, prisma, origem, igToken, pushName,
                    nodeId, variavel: node.data.variable, dados: (await sessions.getDadosUsuario(userNum)) || {}
                });
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
            // 🛡️ ONE-SHOT: o executarNo acima rearmou um novo timeoutAt para o nó de destino.
            // Desativamos para não mandar "você ainda está aí?" de 1h em 1h em loop.
            // Se o cliente responder, o processarMensagem cria um novo TTL normalmente.
            // Se o destino for 'finalizar', a sessão já foi apagada e isso é no-op.
            await sessions.desativarTimeout(userNum);
        } else {
            // Sem porta de timeout conectada: limpa para não ficar preso verificando para sempre
            await sessions.limparSessao(userNum);
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
    executarTimeout,
    enviarMensagemOmni
};