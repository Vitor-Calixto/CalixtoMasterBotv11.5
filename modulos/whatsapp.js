// ============================================================
// ARQUIVO: modulos/whatsapp.js
// DESCRIÇÃO: V39 - SLOW MOTION (MAC OS + 10s DELAY)
// ============================================================

const { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    delay,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');
const { getEtapaUsuario, setEtapaUsuario, isPausado } = require('./sessions');
const { executarPasso } = require('./engine');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const sessionMap = new Map();

async function salvarMensagem(prisma, clienteId, remoteJid, nome, texto, fromMe) {
    try {
        let contato = await prisma.contato.findUnique({ where: { remoteJid } });
        if (!contato) {
            contato = await prisma.contato.create({ data: { remoteJid, nome: nome || "User", clienteId } });
        }
        await prisma.mensagem.create({ data: { texto, fromMe, contatoId: contato.id } });
    } catch (e) {}
}

async function iniciarCliente(cliente, io, prisma) {
    const id = cliente.id;
    if (!cliente.numero) return;
    const numeroLimpo = cliente.numero.replace(/\D/g, '');

    console.log(`\n[SISTEMA] 🐢 Iniciando (Modo Lento) para: ${cliente.nome}`);
    
    const sessionPath = `./sessions/${id}`;
    if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    // TRAVA DE SEGURANÇA
    let isCleaning = false;

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        mobile: false,
        logger: pino({ level: "silent" }),
        // MUDANÇA: Usar macOS para variar a impressão digital
        browser: Browsers.macOS('Chrome'), 
        // AUMENTO DE TIMEOUTS PARA REDES LENTAS/4G
        connectTimeoutMs: 90000, 
        keepAliveIntervalMs: 10000, // Pinga a cada 10s para não cair
        retryRequestDelayMs: 5000,
        syncFullHistory: false,
        shouldIgnoreJid: jid => jid.endsWith('@g.us') || jid === 'status@broadcast'
    });

    global.sessoes[id] = sock; 
    sessionMap.set(id, sock);

    sock.ev.on('creds.update', async (creds) => {
        if (isCleaning) return;
        try { await saveCreds(creds); } catch (e) {}
    });

    // --- CÓDIGO DE PAREAMENTO (COM DELAY LONGO) ---
    if (!sock.authState.creds.registered) {
        
        // Espera 10 SEGUNDOS antes de pedir. É muito tempo, mas garante estabilidade.
        setTimeout(async () => {
            if (isCleaning) return;
            try {
                console.log(`[${cliente.nome}] ...Aguardando estabilização da rede (10s)...`);
                
                // Verifica se o socket ainda está vivo antes de pedir
                if(global.sessoes[id]) {
                    console.log(`[${cliente.nome}] 📞 Solicitando código agora...`);
                    const code = await sock.requestPairingCode(numeroLimpo);
                    
                    console.log(`------------------------------------------------`);
                    console.log(`🔐 CÓDIGO: ${code}`);
                    console.log(`------------------------------------------------`);
                    
                    io.emit('pairingCode', { clienteId: id, code: code });
                }
            } catch (err) {
                console.error(`[ERRO] O WhatsApp recusou: ${err.message}`);
                // Se der erro 428 aqui, é porque precisa esperar mais tempo ou trocar IP
            }
        }, 10000); // <--- 10.000ms = 10 segundos
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error)?.output?.statusCode;
            console.log(`[${cliente.nome}] 🔴 Caiu (Erro: ${statusCode})`);

            // 401: Logout | 428: Precondition Required (Bloqueio temporário)
            // 515: Restart Required (Erro comum, tenta de novo)
            
            if (statusCode === 401) {
                console.log(`[${cliente.nome}] ⛔ Sessão Inválida. Limpando.`);
                isCleaning = true;
                limparTudo(id, sessionPath, prisma, io);
                return;
            }

            if (statusCode === 428) {
                console.log(`[${cliente.nome}] ⚠️ Bloqueio temporário (428). Esperando 30s antes de tentar de novo...`);
                // Não limpamos a sessão, apenas esperamos mais tempo
                sessionMap.delete(id);
                setTimeout(() => iniciarCliente(cliente, io, prisma), 30000); 
                return;
            }

            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                // Reconexão padrão
                setTimeout(() => iniciarCliente(cliente, io, prisma), 5000);
            } else {
                sessionMap.delete(id);
            }

        } else if (connection === 'open') {
            console.log(`[${cliente.nome}] 🟢 CONECTADO (ESTÁVEL)`);
            isCleaning = false;
            try { await prisma.cliente.update({ where: { id }, data: { status: 'ONLINE' } }); } catch (e) {}
            io.emit('status', { clienteId: id, status: 'ONLINE' });
        }
    });

    // --- MENSAGENS (MANTIDO COMPACTO) ---
    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
            const usuarioId = msg.key.remoteJid;
            const isMe = msg.key.fromMe; 
            const texto = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
            await salvarMensagem(prisma, id, usuarioId, msg.pushName, texto, isMe);

            if (isMe) {
                if (texto === '!reset') { setEtapaUsuario(usuarioId, null); await sock.sendMessage(usuarioId, {text: '♻️ Reset.'}); }
                return;
            }
            const check = await prisma.cliente.findUnique({ where: { id } });
            if (!check || check.status !== 'ONLINE') return;
            if (isPausado(usuarioId)) return;
            const fluxo = check.fluxoJson;
            if (!fluxo || !fluxo.drawflow) return;
            let etapaAtual = getEtapaUsuario(usuarioId);
            let processando = true;
            let proximoId = etapaAtual;
            let inputUsuario = texto;

            while (processando) {
                const resultado = await executarPasso(proximoId, fluxo, proximoId ? inputUsuario : "");
                if (!resultado) { processando = false; break; }
                if (['texto', 'imagem', 'video', 'audio', 'midia'].includes(resultado.tipo)) {
                    await sock.sendPresenceUpdate(resultado.tipo === 'audio' ? 'recording' : 'composing', usuarioId);
                    await delay(1000);
                    if (resultado.tipo === 'texto') await sock.sendMessage(usuarioId, { text: resultado.mensagem });
                    else if (resultado.url) {
                        const fileName = path.basename(decodeURIComponent(resultado.url));
                        const caminhoAbsoluto = path.join(process.cwd(), 'public', 'uploads', fileName);
                        if(fs.existsSync(caminhoAbsoluto)) {
                             const buffer = fs.readFileSync(caminhoAbsoluto);
                             const mime = path.extname(caminhoAbsoluto) === '.mp3' ? 'audio/mpeg' : 'audio/mp4';
                             if(resultado.tipo === 'audio') await sock.sendMessage(usuarioId, { audio: buffer, mimetype: mime, ptt: resultado.ptt });
                             else if(resultado.tipo === 'video') await sock.sendMessage(usuarioId, { video: buffer, caption: resultado.caption });
                             else await sock.sendMessage(usuarioId, { image: buffer, caption: resultado.caption });
                        }
                    }
                    await sock.sendPresenceUpdate('paused', usuarioId);
                }
                if (resultado.parar) {
                    if (resultado.idAtual) { setEtapaUsuario(usuarioId, resultado.idAtual); processando = false; }
                    else if (resultado.manterNoAtual) { setEtapaUsuario(usuarioId, proximoId || resultado.idAtual); processando = false; }
                    else {
                        if (resultado.proximoId) { proximoId = resultado.proximoId; inputUsuario = ""; setEtapaUsuario(usuarioId, proximoId); await delay(500); }
                        else { setEtapaUsuario(usuarioId, null); processando = false; }
                    }
                } else {
                    proximoId = resultado.proximoId; inputUsuario = ""; 
                    if (!proximoId) processando = false; else await delay(100); 
                }
            }
        } catch (erro) { console.error(`Erro:`, erro.message); }
    });
}

// Função auxiliar de limpeza
async function limparTudo(id, sessionPath, prisma, io) {
    if(global.sessoes[id]) delete global.sessoes[id];
    sessionMap.delete(id);
    try { await prisma.cliente.update({ where: { id }, data: { status: 'OFFLINE' } }); } catch(e) {}
    try { io.emit('status', { clienteId: id, status: 'OFFLINE' }); } catch(e) {}
    setTimeout(() => {
        try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch(e) {}
    }, 1000);
}

module.exports = { sessionMap, iniciarCliente, deletarSessao: (id) => { if(global.sessoes[id]) delete global.sessoes[id]; sessionMap.delete(id); try { fs.rmSync(`./sessions/${id}`, { recursive: true, force: true }); } catch (e) {} } };