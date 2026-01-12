// ============================================================
// ARQUIVO: modulos/engine.js (V9.3 - FINAL)
// ============================================================
const sessions = require('./sessions');
const path = require('path');
const fs = require('fs');

// Função auxiliar para pausa (delay visual)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Normalização de texto (Fuzzy Match) - Remove acentos e deixa minúsculo
function normalizar(texto) {
    if (!texto) return "";
    return texto.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

// Calcula tempo de digitação baseado no tamanho do texto
function calcularTempo(texto) {
    if (!texto) return 1000;
    return Math.min(1000 + (texto.length * 50), 5000);
}

// Navegação segura no JSON do fluxo
function getNextNodeId(node, outputName = 'output_1') {
    try {
        if (node?.outputs?.[outputName]?.connections?.length > 0) {
            return node.outputs[outputName].connections[0].node;
        }
    } catch (e) { return null; }
    return null;
}

// Detecta tipo de arquivo para envio
function getMimeType(ext) {
    const types = {
        '.pdf': 'application/pdf', '.txt': 'text/plain', '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.csv': 'text/csv'
    };
    return types[ext] || 'application/octet-stream';
}

// Calcula tempo de vida da sessão (TTL) baseado no nó atual
function getTTL(node) {
    // Se for nó de ESPERA, o TTL é o tempo configurado nele
    if (node.name === 'espera') {
        return parseInt(node.data.time) || 60; 
    }
    // Se for MENU com timeout ativo
    if (node.data && node.data['timeout-active'] && node.data.timeout) {
        const parsed = parseInt(node.data.timeout);
        if (!isNaN(parsed) && parsed > 0) return parsed * 60; 
    }
    return null; 
}

// ============================================================
// 1. PROCESSADOR DE MENSAGENS (A PORTA DE ENTRADA)
// ============================================================
async function processarMensagem(clienteId, remoteJid, textoMsg, sock, prisma, nomePerfil = "Cliente") {
    const userNum = remoteJid.replace(/\D/g, ''); 

    // --- COMANDOS ESPECIAIS ---

    // 1. Reiniciar tudo (#RESET)
    if (textoMsg.trim().toUpperCase() === '#RESET') {
        await sessions.limparSessao(userNum);
        await sock.sendMessage(remoteJid, { text: "🔄 Sessão reiniciada!" });
        return;
    }

    // 2. Sair do modo humano (#VOLTAR)
    if (textoMsg.trim().toUpperCase() === '#VOLTAR' || textoMsg.trim().toUpperCase() === '#BOT') {
        await sessions.setPausado(userNum, false); // Destrava o Redis
        await sessions.limparSessao(userNum);      // Limpa para começar do zero
        await sock.sendMessage(remoteJid, { text: "🤖 *O Bot assumiu novamente!* \nEnvie 'Oi' para ver o menu." });
        return;
    }

    // 3. Verifica se está em atendimento humano
    if (await sessions.isPausado(userNum)) {
        return; // Se estiver pausado, o código PARA aqui. O humano responde.
    }

    // --- LÓGICA DO ROBÔ ---

    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente || !cliente.fluxoJson) return;

    const fluxoData = cliente.fluxoJson.drawflow?.Home?.data;
    if (!fluxoData) return;

    let estadoAtualId = await sessions.getEtapaUsuario(userNum);
    let proximoId = null;

    // A. Cliente Novo (Sem sessão)
    if (!estadoAtualId) {
        const startNode = Object.values(fluxoData).find(n => n.name === 'inicio');
        if (startNode) proximoId = getNextNodeId(startNode);
    } 
    // B. Cliente Antigo (Com sessão)
    else {
        const noAtual = fluxoData[estadoAtualId];
        if (!noAtual) {
            await sessions.limparSessao(userNum);
            return processarMensagem(clienteId, remoteJid, textoMsg, sock, prisma);
        }

        // Se estava em ESPERA e falou, avança o fluxo
        if (noAtual.name === 'espera') {
             proximoId = getNextNodeId(noAtual);
        }

        // Se estava em MENU, verifica as opções
        else if (noAtual.name === 'menu') {
            const entradaRaw = textoMsg.trim(); 
            const entradaNorm = normalizar(entradaRaw);
            let connectionKey = null;
            
            // Verifica se digitou número (1, 2, 3)
            if (!isNaN(entradaRaw) && parseInt(entradaRaw) > 0) {
                connectionKey = `output_${entradaRaw}`;
            } else {
                // Verifica se digitou texto ("Financeiro") - Fuzzy Match
                Object.keys(noAtual.data).forEach(key => {
                    if (key.startsWith('opcao')) {
                        const textoOpcaoNorm = normalizar(noAtual.data[key]);
                        if (textoOpcaoNorm.includes(entradaNorm) || (entradaNorm.length > 2 && entradaNorm.includes(textoOpcaoNorm))) {
                            connectionKey = `output_${key.replace('opcao', '')}`;
                        }
                    }
                });
            }

            const target = getNextNodeId(noAtual, connectionKey);

            if (target) {
                proximoId = target;
            } else if (noAtual.data['invalid-active']) {
                // Rota de Erro (Não Entendi)
                let totalOpcoes = 0;
                Object.keys(noAtual.data).forEach(k => { if (k.startsWith('opcao')) totalOpcoes++; });
                
                let errorOutputIndex = totalOpcoes + 1; 
                if (noAtual.data['timeout-active']) errorOutputIndex++; 
                
                const rotaErro = getNextNodeId(noAtual, `output_${errorOutputIndex}`);
                if (rotaErro) proximoId = rotaErro;
                else {
                    const ttl = getTTL(noAtual);
                    await sessions.setEtapaUsuario(userNum, estadoAtualId, ttl, clienteId, remoteJid);
                    return;
                }
            } else { return; }
        } else {
            // Outros nós (Mensagem, etc) apenas avançam
            proximoId = getNextNodeId(noAtual);
        }
    }

    if (proximoId) {
        await executarNo(proximoId, fluxoData, sock, remoteJid, userNum, clienteId);
    }
}

// ============================================================
// 2. EXECUTOR DE NÓS (O QUE O BOT FAZ)
// ============================================================
async function executarNo(nodeId, fluxoData, sock, remoteJid, userNum, clienteId) {
    const node = fluxoData[nodeId];
    if (!node) return;

    console.log(`[ENGINE] 🚀 Executando: ${node.name} (${nodeId})`);
    
    // Salva onde o usuário está no Redis
    const ttl = getTTL(node);
    await sessions.setEtapaUsuario(userNum, nodeId, ttl, clienteId, remoteJid);

    // --- TIPO: ESPERA (DELAY) ---
    if (node.name === 'espera') {
        const tempo = parseInt(node.data.time) || 60;
        console.log(`[ENGINE] ⏳ Pausando fluxo por ${tempo} segundos...`);
        return; // IMPORTANTE: O código para aqui! O timeout.js vai retomar depois.
    }

    // --- TIPO: MENSAGEM ---
    if (node.name === 'mensagem') {
        const texto = node.data.message;
        if (texto) {
            await sock.sendPresenceUpdate('composing', remoteJid);
            await delay(calcularTempo(texto)); 
            await sock.sendMessage(remoteJid, { text: texto });
            await sock.sendPresenceUpdate('paused', remoteJid);
        }
        const next = getNextNodeId(node);
        if (next) await executarNo(next, fluxoData, sock, remoteJid, userNum, clienteId);
    }

    // --- TIPO: MÍDIA ---
    else if (node.name === 'midia' || node.name === 'audio') {
        const url = node.data.url;
        if (url) {
            const cleanUrl = url.startsWith('/') ? url.slice(1) : url;
            const filePath = path.resolve(__dirname, '..', 'public', cleanUrl);

            if (fs.existsSync(filePath)) {
                if (node.name === 'audio') {
                    await sock.sendPresenceUpdate('recording', remoteJid);
                    await delay(3000); 
                    await sock.sendMessage(remoteJid, { audio: { url: filePath }, mimetype: 'audio/mp4', ptt: node.data.ptt !== false });
                } else {
                    const ext = path.extname(filePath).toLowerCase();
                    const isVideo = ['.mp4', '.avi'].includes(ext);
                    const isImage = ['.jpg', '.jpeg', '.png'].includes(ext);
                    
                    await sock.sendPresenceUpdate('composing', remoteJid);
                    await delay(1500);

                    if (isVideo) {
                        await sock.sendMessage(remoteJid, { video: { url: filePath }, caption: node.data.caption || '', gifPlayback: false });
                    } else if (isImage) {
                        await sock.sendMessage(remoteJid, { image: { url: filePath }, caption: node.data.caption || '' });
                    } else {
                        const mimetype = getMimeType(ext);
                        await sock.sendMessage(remoteJid, { document: { url: filePath }, mimetype: mimetype, fileName: path.basename(filePath), caption: node.data.caption || '' });
                    }
                }
            } else {
                console.error(`[ENGINE] ❌ Arquivo não existe: ${filePath}`);
            }
        }
        const next = getNextNodeId(node);
        if (next) await executarNo(next, fluxoData, sock, remoteJid, userNum, clienteId);
    }

    // --- TIPO: MENU ---
    else if (node.name === 'menu') {
        const titulo = node.data.question || "Opções:";
        let opcoes = [];
        Object.keys(node.data).forEach(key => {
            if (key.startsWith('opcao')) opcoes.push({ id: parseInt(key.replace('opcao','')), text: node.data[key] });
        });
        opcoes.sort((a,b) => a.id - b.id);

        await sock.sendPresenceUpdate('composing', remoteJid);
        await delay(1000);

        const rawButton = node.data.buttons || node.data['buttons-active'];
        const usaBotao = (rawButton === true || rawButton === "true");

        // Envia botões se tiver poucas opções
        if (usaBotao && opcoes.length <= 3) {
            const buttons = opcoes.map(op => ({
                name: "quick_reply",
                buttonParamsJson: JSON.stringify({ display_text: op.text, id: String(op.id) })
            }));
            const msgInteractive = {
                viewOnceMessage: {
                    message: {
                        interactiveMessage: {
                            body: { text: titulo },
                            footer: { text: "Escolha uma opção:" },
                            header: { title: "", subtitle: "", hasMediaAttachment: false },
                            nativeFlowMessage: { buttons: buttons }
                        }
                    }
                }
            };
            await sock.sendMessage(remoteJid, msgInteractive);
        } else {
            let textoMenu = `*${titulo}*\n\n`;
            opcoes.forEach(op => textoMenu += `*${op.id}.* ${op.text}\n`);
            await sock.sendMessage(remoteJid, { text: textoMenu });
        }
    }

    // --- TIPO: HORÁRIO ---
    else if (node.name === 'horario') {
        const dataSP = new Date().toLocaleString("en-US", {timeZone: "America/Sao_Paulo"});
        const agora = new Date(dataSP);
        const minutosAtuais = (agora.getHours() * 60) + agora.getMinutes();
        const [h1, m1] = (node.data.inicio || "09:00").split(':').map(Number);
        const [h2, m2] = (node.data.fim || "18:00").split(':').map(Number);
        const inicio = h1 * 60 + m1;
        const fim = h2 * 60 + m2;
        const aberto = minutosAtuais >= inicio && minutosAtuais < fim;
        
        const saida = aberto ? 'output_1' : 'output_2';
        const next = getNextNodeId(node, saida);
        
        if (next) await executarNo(next, fluxoData, sock, remoteJid, userNum, clienteId);
    }

    // --- TIPO: TRANSFERIR (HUMANO) ---
    else if (node.name === 'transferir') {
        const setor = node.data.fila || "Geral";
        console.log(`[ENGINE] 👤 Transferindo ${userNum} para HUMANO.`);

        // 1. Avisa o cliente
        await sock.sendMessage(remoteJid, { 
            text: `⏳ *Aguarde um momento.*\n\nEstamos transferindo seu atendimento para o setor *${setor}*.\nUm atendente falará com você em breve.` 
        });

        // 2. Trava o Bot no Redis
        await sessions.setPausado(userNum, true);

        // 3. Notificação Dinâmica (Lê número do fluxo)
        const numeroAdminRaw = node.data.notificacao;

        if (numeroAdminRaw && numeroAdminRaw.length > 10) {
            try {
                const numeroLimpo = numeroAdminRaw.replace(/\D/g, '');
                const adminJid = numeroLimpo.includes('@') ? numeroLimpo : numeroLimpo + '@s.whatsapp.net';
                
                // MENSAGEM SEGURA COM NOME E ID
                const textoNotificacao = `🔔 *NOVO TRANSBORDO SOLICITADO*\n\n` +
                                         `👤 *Nome:* ${nomePerfil}\n` +
                                         `📱 *ID Técnico:* +${userNum}\n` +
                                         `📂 *Setor:* ${setor}\n` +
                                         `📅 *Data:* ${new Date().toLocaleTimeString('pt-BR')}\n\n` +
                                         `👉 *Ação:* Vá até o chat deste cliente e digite #VOLTAR para reativar o robô.`;

                await sock.sendMessage(adminJid, { text: textoNotificacao });
                console.log(`[ENGINE] 🔔 Notificação enviada para: ${adminJid}`);
                
            } catch (erro) {
                console.error(`[ENGINE] ❌ Erro notificação:`, erro.message);
            }
        }
        
        return; // Bot para aqui.
    }

    // --- TIPO: FINALIZAR ---
    else if (node.name === 'finalizar') {
        console.log(`[ENGINE] 🛑 Fim.`);
        await sessions.limparSessao(userNum);
    }
}

// ============================================================
// 3. EXECUTOR DE TIMEOUT (DESPERTADOR)
// ============================================================
async function executarTimeout(userNum, clienteId, remoteJid, nodeId, prisma, sock) {
    console.log(`[TIMEOUT] ⏰ Evento disparado: ${userNum}`);
    
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente || !cliente.fluxoJson) return;
    const fluxoData = cliente.fluxoJson.drawflow?.Home?.data;
    const node = fluxoData[nodeId];
    
    if (!node) {
        await sessions.limparSessao(userNum);
        return;
    }

    // CASO 1: FIM DA ESPERA (RETOMAR FLUXO)
    if (node.name === 'espera') {
        console.log(`[TIMEOUT] ✅ Espera concluída. Retomando fluxo...`);
        const nextId = getNextNodeId(node, 'output_1');
        if (nextId) await executarNo(nextId, fluxoData, sock, remoteJid, userNum, clienteId);
        else await sessions.limparSessao(userNum);
        return;
    }

    // CASO 2: ABANDONO DE MENU
    if (!node.data['timeout-active']) {
        await sessions.limparSessao(userNum);
        return;
    }

    // Calcula qual saída é a do Timeout
    let totalOpcoes = 0;
    if (node.name === 'menu') {
        Object.keys(node.data).forEach(k => { if (k.startsWith('opcao')) totalOpcoes++; });
    }
    
    const timeoutOutputIndex = totalOpcoes + 1;
    const timeoutOutputName = `output_${timeoutOutputIndex}`;
    
    const nextId = getNextNodeId(node, timeoutOutputName);
    
    if (nextId) await executarNo(nextId, fluxoData, sock, remoteJid, userNum, clienteId);
    else await sessions.limparSessao(userNum);
}

module.exports = { processarMensagem, executarNo, executarTimeout };