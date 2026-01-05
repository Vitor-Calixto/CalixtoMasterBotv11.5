// ============================================================
// ARQUIVO: modulos/engine.js (V8.0 - BOTÕES ATIVOS)
// ============================================================
const sessions = require('./sessions');
const path = require('path');
const fs = require('fs');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function calcularTempo(texto) {
    if (!texto) return 1000;
    const tempo = 1000 + (texto.length * 50); 
    return Math.min(tempo, 5000); 
}

function getNextNodeId(node, outputName = 'output_1') {
    try {
        if (node?.outputs?.[outputName]?.connections?.length > 0) {
            return node.outputs[outputName].connections[0].node;
        }
    } catch (e) { return null; }
    return null;
}

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

function getTTL(node) {
    let ttl = 3600; 
    if (node.data && node.data['timeout-active'] && node.data.timeout) {
        const parsed = parseInt(node.data.timeout);
        if (!isNaN(parsed) && parsed > 0) ttl = parsed * 60; 
    }
    return ttl;
}

// ============================================================
// FUNÇÃO PRINCIPAL
// ============================================================
async function processarMensagem(clienteId, remoteJid, textoMsg, sock, prisma) {
    const userNum = remoteJid.replace(/\D/g, ''); 

    if (textoMsg.trim().toUpperCase() === '#RESET') {
        await sessions.limparSessao(userNum);
        await sock.sendMessage(remoteJid, { text: "🔄 Sessão reiniciada!" });
        return;
    }

    if (await sessions.isPausado(userNum)) return;

    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente || !cliente.fluxoJson) return;

    const fluxoData = cliente.fluxoJson.drawflow?.Home?.data;
    if (!fluxoData) return;

    let estadoAtualId = await sessions.getEtapaUsuario(userNum);
    let proximoId = null;

    // --- INÍCIO ---
    if (!estadoAtualId) {
        const startNode = Object.values(fluxoData).find(n => n.name === 'inicio');
        if (startNode) proximoId = getNextNodeId(startNode);
    } 
    // --- EM ANDAMENTO ---
    else {
        const noAtual = fluxoData[estadoAtualId];
        
        if (!noAtual) {
            await sessions.limparSessao(userNum);
            return processarMensagem(clienteId, remoteJid, textoMsg, sock, prisma);
        }

        if (noAtual.name === 'menu') {
            const entrada = textoMsg.trim();
            
            // Verifica se é número (1, 2) OU se veio do ID do botão ("1", "2")
            // O whatsapp.js já me entrega o ID limpo se for botão
            let connectionKey = null;
            if (!isNaN(entrada) && parseInt(entrada) > 0) connectionKey = `output_${entrada}`;

            const target = getNextNodeId(noAtual, connectionKey);

            if (target) {
                proximoId = target;
            } else {
                if (noAtual.data['invalid-active']) {
                    let totalOpcoes = 0;
                    Object.keys(noAtual.data).forEach(k => { if (k.startsWith('opcao')) totalOpcoes++; });
                    let errorOutputIndex = totalOpcoes;
                    if (noAtual.data['timeout-active']) errorOutputIndex++;
                    errorOutputIndex++; 
                    const errorOutputName = `output_${errorOutputIndex}`;
                    proximoId = getNextNodeId(noAtual, errorOutputName);
                } 
                
                if (!proximoId) {
                    await sock.sendMessage(remoteJid, { text: "⚠️ Opção inválida. Escolha uma das opções abaixo." });
                    const ttl = getTTL(noAtual);
                    await sessions.setEtapaUsuario(userNum, estadoAtualId, ttl);
                    return;
                }
            }
        } else {
            proximoId = getNextNodeId(noAtual);
        }
    }

    if (proximoId) {
        await executarNo(proximoId, fluxoData, sock, remoteJid, userNum);
    } else if (estadoAtualId) {
        // ... (lógica de fim)
    }
}

// ============================================================
// EXECUTOR
// ============================================================
async function executarNo(nodeId, fluxoData, sock, remoteJid, userNum) {
    const node = fluxoData[nodeId];
    if (!node) return;

    console.log(`[ENGINE] 🚀 Executando: ${node.name} (${nodeId})`);
    const ttl = getTTL(node);
    await sessions.setEtapaUsuario(userNum, nodeId, ttl);

    // 1. MENSAGEM
    if (node.name === 'mensagem') {
        const texto = node.data.message;
        if (texto) {
            console.log(`[ENGINE] 💬 Digitando...`);
            await sock.sendPresenceUpdate('composing', remoteJid);
            await delay(calcularTempo(texto)); 
            await sock.sendMessage(remoteJid, { text: texto });
            await sock.sendPresenceUpdate('paused', remoteJid);
        }
        const next = getNextNodeId(node);
        if (next) await executarNo(next, fluxoData, sock, remoteJid, userNum);
    }

    // 2. MÍDIA
    else if (node.name === 'midia' || node.name === 'audio') {
        const url = node.data.url;
        if (url) {
            const cleanUrl = url.startsWith('/') ? url.slice(1) : url;
            const filePath = path.resolve(__dirname, '..', 'public', cleanUrl);

            if (fs.existsSync(filePath)) {
                if (node.name === 'audio') {
                    console.log(`[ENGINE] 🎤 Gravando...`);
                    await sock.sendPresenceUpdate('recording', remoteJid);
                    await delay(3000); 
                    await sock.sendMessage(remoteJid, { audio: { url: filePath }, mimetype: 'audio/mp4', ptt: node.data.ptt !== false });
                } else {
                    const ext = path.extname(filePath).toLowerCase();
                    const fileName = path.basename(filePath);
                    const isVideo = ['.mp4', '.avi'].includes(ext);
                    const isImage = ['.jpg', '.jpeg', '.png'].includes(ext);
                    
                    console.log(`[ENGINE] 📤 Enviando mídia...`);
                    await sock.sendPresenceUpdate('composing', remoteJid);
                    await delay(1500);

                    if (isVideo) {
                        await sock.sendMessage(remoteJid, { video: { url: filePath }, caption: node.data.caption || '', gifPlayback: false });
                    } else if (isImage) {
                        await sock.sendMessage(remoteJid, { image: { url: filePath }, caption: node.data.caption || '' });
                    } else {
                        const mimetype = getMimeType(ext);
                        await sock.sendMessage(remoteJid, { document: { url: filePath }, mimetype: mimetype, fileName: fileName, caption: node.data.caption || '' });
                    }
                }
            } else {
                console.error(`[ENGINE] ❌ Arquivo não existe: ${filePath}`);
            }
        }
        const next = getNextNodeId(node);
        if (next) await executarNo(next, fluxoData, sock, remoteJid, userNum);
    }

    // 3. MENU (COM BOTÕES 🔘)
    else if (node.name === 'menu') {
        const titulo = node.data.question || "Opções:";
        let opcoes = [];
        Object.keys(node.data).forEach(key => {
            if (key.startsWith('opcao')) opcoes.push({ id: parseInt(key.replace('opcao','')), text: node.data[key] });
        });
        opcoes.sort((a,b) => a.id - b.id);

        console.log(`[ENGINE] 📋 Preparando Menu...`);
        await sock.sendPresenceUpdate('composing', remoteJid);
        await delay(1000);

        // --- VERIFICA SE DEVE ENVIAR COMO BOTÃO ---
        // A chavinha no seu painel geralmente salva como 'buttons' ou 'buttons-active'
        const usaBotao = node.data.buttons || node.data['buttons-active'];

        if (usaBotao && opcoes.length <= 3) {
            // MODO BOTÃO (Interactive Buttons - Máximo 3 opções por limitação do WhatsApp)
            console.log(`[ENGINE] 🔘 Enviando como BOTÕES.`);
            
            const buttons = opcoes.map(op => ({
                name: "quick_reply",
                buttonParamsJson: JSON.stringify({
                    display_text: op.text,
                    id: String(op.id) // O ID aqui vira o texto que o bot lê depois
                })
            }));

            const msgInteractive = {
                viewOnceMessage: {
                    message: {
                        interactiveMessage: {
                            body: { text: titulo },
                            footer: { text: "Escolha uma opção:" },
                            header: { title: "", subtitle: "", hasMediaAttachment: false },
                            nativeFlowMessage: {
                                buttons: buttons
                            }
                        }
                    }
                }
            };

            await sock.sendMessage(remoteJid, msgInteractive);

        } else {
            // MODO TEXTO (Se não tiver marcado botão, ou se tiver mais de 3 opções)
            console.log(`[ENGINE] 📝 Enviando como TEXTO.`);
            
            let textoMenu = `*${titulo}*\n\n`;
            opcoes.forEach(op => textoMenu += `*${op.id}.* ${op.text}\n`);
            
            await sock.sendMessage(remoteJid, { text: textoMenu });
        }
    }

    // 4. HORÁRIO
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
        
        if (next) await executarNo(next, fluxoData, sock, remoteJid, userNum);
        else console.log(`[ENGINE] ⚠️ ERRO: Sem conexão na saída ${saida} do Horário.`);
    }

    else if (node.name === 'finalizar') {
        console.log(`[ENGINE] 🛑 Fim.`);
        await sessions.limparSessao(userNum);
    }
}

module.exports = { processarMensagem };