// ============================================================
// ARQUIVO: modulos/engine.js (V18.0 - FINAL CORRIGIDO)
// ============================================================
const sessions = require('./sessions');
const path = require('path');
const fs = require('fs');

// Função auxiliar para pausa (delay visual simulando digitação)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Normalização de texto (Remove acentos e deixa minúsculo)
function normalizar(texto) {
    if (!texto) return "";
    return texto.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

// Calcula tempo de "Digitando..."
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

// Detecta tipo de arquivo
function getMimeType(ext) {
    const types = {
        '.pdf': 'application/pdf', '.txt': 'text/plain', '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.csv': 'text/csv', '.mp4': 'video/mp4', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png'
    };
    return types[ext] || 'application/octet-stream';
}

// Calcula tempo de vida da sessão
function getTTL(node) {
    if (node.name === 'espera') {
        return parseInt(node.data.time) || 60; 
    }
    if (node.data && node.data['timeout-active'] && node.data.timeout) {
        const parsed = parseInt(node.data.timeout);
        if (!isNaN(parsed) && parsed > 0) return parsed * 60; 
    }
    return null; 
}

// ============================================================
// 1. PROCESSADOR DE MENSAGENS
// ============================================================
async function processarMensagem(clienteId, remoteJid, textoMsg, sock, prisma, nomePerfil = "Cliente") {
    const userNum = remoteJid.replace(/\D/g, ''); 

    // --- 1. BUSCA O CLIENTE NO BANCO ---
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    
    // SE NÃO EXISTIR OU ESTIVER "OFFLINE", O BOT FINGE DE MORTO
    if (!cliente || cliente.status !== 'ONLINE') {
        return; 
    }

    // --- COMANDOS ESPECIAIS ---
    if (textoMsg.trim().toUpperCase() === '#RESET') {
        await sessions.limparSessao(userNum);
        await sock.sendMessage(remoteJid, { text: "🔄 Sessão reiniciada!" });
        return;
    }

    if (textoMsg.trim().toUpperCase() === '#VOLTAR' || textoMsg.trim().toUpperCase() === '#BOT') {
        await sessions.setPausado(userNum, false); 
        await sessions.limparSessao(userNum);      
        await sock.sendMessage(remoteJid, { text: "🤖 *O Bot assumiu novamente!* \nEnvie 'Oi' para ver o menu." });
        return;
    }

    if (await sessions.isPausado(userNum)) {
        return; 
    }

    // --- LÓGICA DO ROBÔ ---
    // Cliente já foi buscado acima, verifica fluxo
    if (!cliente.fluxoJson) return;

    const fluxoData = cliente.fluxoJson.drawflow?.Home?.data;
    if (!fluxoData) return;

    let estadoAtualId = await sessions.getEtapaUsuario(userNum);
    let proximoId = null;

    if (!estadoAtualId) {
        const startNode = Object.values(fluxoData).find(n => n.name === 'inicio');
        if (startNode) proximoId = getNextNodeId(startNode);
    } 
    else {
        const noAtual = fluxoData[estadoAtualId];
        if (!noAtual) {
            await sessions.limparSessao(userNum);
            return processarMensagem(clienteId, remoteJid, textoMsg, sock, prisma, nomePerfil);
        }

        if (noAtual.name === 'espera') {
             proximoId = getNextNodeId(noAtual);
        }
        else if (noAtual.name === 'menu') {
            const entradaRaw = textoMsg.trim(); 
            const entradaNorm = normalizar(entradaRaw);
            let connectionKey = null;
            
            if (!isNaN(entradaRaw) && parseInt(entradaRaw) > 0) {
                connectionKey = `output_${entradaRaw}`;
            } else {
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
            proximoId = getNextNodeId(noAtual);
        }
    }

    if (proximoId) {
        await executarNo(proximoId, fluxoData, sock, remoteJid, userNum, clienteId);
    }
}

// ============================================================
// 2. EXECUTOR DE NÓS
// ============================================================
async function executarNo(nodeId, fluxoData, sock, remoteJid, userNum, clienteId) {
    const node = fluxoData[nodeId];
    if (!node) return;

    console.log(`[ENGINE] 🚀 Executando: ${node.name} (${nodeId})`);
    
    const ttl = getTTL(node);
    await sessions.setEtapaUsuario(userNum, nodeId, ttl, clienteId, remoteJid);

    // --- TIPO: ESPERA ---
    if (node.name === 'espera') {
        const tempo = parseInt(node.data.time) || 60;
        console.log(`[ENGINE] ⏳ Pausando fluxo por ${tempo} segundos...`);
        return;
    }

    // --- TIPO: MENSAGEM ---
    else if (node.name === 'mensagem') {
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

    // --- TIPO: MÍDIA / ÁUDIO (CORREÇÃO DE CAMINHO) ---
    else if (node.name === 'midia' || node.name === 'audio') {
        try {
            const urlRaw = node.data.url; 
            console.log(`[DEBUG MÍDIA] URL do Fluxo: ${urlRaw}`);

            if (urlRaw) {
                // Remove o domínio para pegar apenas o nome do arquivo
                let fileName = "";
                if (urlRaw.includes('uploads/')) {
                    fileName = urlRaw.split('uploads/')[1]; 
                } else {
                    fileName = path.basename(urlRaw);
                }

                // Caminho absoluto para a pasta public/uploads
                // Ajuste '../public' conforme a estrutura do seu projeto se necessário
                const filePath = path.resolve(__dirname, '..', 'public', 'uploads', fileName);
                console.log(`[DEBUG MÍDIA] Caminho Físico: ${filePath}`);

                if (fs.existsSync(filePath)) {
                    const fileBuffer = fs.readFileSync(filePath);
                    const ext = path.extname(filePath).toLowerCase();

                    if (node.name === 'audio') {
                        await sock.sendMessage(remoteJid, { 
                            audio: fileBuffer, 
                            mimetype: 'audio/mp4', 
                            ptt: node.data.ptt !== false 
                        });
                    } 
                    else {
                        if (['.mp4', '.avi', '.mov'].includes(ext)) {
                            await sock.sendMessage(remoteJid, { video: fileBuffer, caption: node.data.caption || '', gifPlayback: false });
                        } else if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
                            await sock.sendMessage(remoteJid, { image: fileBuffer, caption: node.data.caption || '' });
                        } else {
                            await sock.sendMessage(remoteJid, { document: fileBuffer, mimetype: getMimeType(ext), fileName: fileName, caption: node.data.caption || '' });
                        }
                    }
                    console.log('[DEBUG MÍDIA] ✅ Enviado!');
                } else {
                    console.error(`[ERRO MÍDIA] ❌ Arquivo não existe: ${filePath}`);
                    await sock.sendMessage(remoteJid, { text: '⚠️ Erro: Mídia não encontrada no servidor.' });
                }
            } else {
                console.error('[ERRO MÍDIA] URL vazia no fluxo.');
            }
        } catch (error) {
            console.error('[ERRO CRÍTICO MÍDIA]', error);
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

    // --- TIPO: TRANSFERIR ---
    else if (node.name === 'transferir') {
        const setor = node.data.fila || "Geral";
        console.log(`[ENGINE] 👤 Transferindo ${userNum} para HUMANO.`);

        await sock.sendMessage(remoteJid, { 
            text: `⏳ *Aguarde um momento.*\n\nEstamos transferindo seu atendimento para o setor *${setor}*.\nUm atendente falará com você em breve.` 
        });

        await sessions.setPausado(userNum, true);

        const numeroAdminRaw = node.data.notificacao;
        if (numeroAdminRaw && numeroAdminRaw.length > 10) {
            try {
                const numeroLimpo = numeroAdminRaw.replace(/\D/g, '');
                const adminJid = numeroLimpo.includes('@') ? numeroLimpo : numeroLimpo + '@s.whatsapp.net';
                const textoNotificacao = `🔔 *NOVO TRANSBORDO*\n📱 Cliente: +${userNum}\n📂 Setor: ${setor}\n👉 Digite #VOLTAR no chat do cliente para reativar o robô.`;
                await sock.sendMessage(adminJid, { text: textoNotificacao });
            } catch (erro) {
                console.error(`[ENGINE] ❌ Erro notificação:`, erro.message);
            }
        }
        return; 
    }

    // --- TIPO: FINALIZAR ---
    else if (node.name === 'finalizar') {
        console.log(`[ENGINE] 🛑 Fim.`);
        await sessions.limparSessao(userNum);
    }
}

// ============================================================
// 3. EXECUTOR DE TIMEOUT
// ============================================================
async function executarTimeout(userNum, clienteId, remoteJid, nodeId, prisma, sock) {
    console.log(`[TIMEOUT] ⏰ Disparado para: ${userNum}`);
    
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente || !cliente.fluxoJson) return;
    const fluxoData = cliente.fluxoJson.drawflow?.Home?.data;
    const node = fluxoData[nodeId];
    
    if (!node) {
        await sessions.limparSessao(userNum);
        return;
    }

    if (node.name === 'espera') {
        console.log(`[TIMEOUT] ✅ Retomando após espera...`);
        const nextId = getNextNodeId(node, 'output_1');
        if (nextId) await executarNo(nextId, fluxoData, sock, remoteJid, userNum, clienteId);
        else await sessions.limparSessao(userNum);
        return;
    }

    if (!node.data['timeout-active']) {
        await sessions.limparSessao(userNum);
        return;
    }

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