// ============================================================
// ARQUIVO: modulos/whatsapp.js (V11.0 - BLINDAGEM TOTAL / AUTO-CLEAN)
// ============================================================
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    delay
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const engine = require('./engine');

const sessoes = new Map();

function unwrapMessage(msg) {
    if (!msg) return null;
    if (msg.ephemeralMessage) return unwrapMessage(msg.ephemeralMessage.message);
    if (msg.viewOnceMessage) return unwrapMessage(msg.viewOnceMessage.message);
    if (msg.viewOnceMessageV2) return unwrapMessage(msg.viewOnceMessageV2.message);
    return msg;
}

async function iniciarWhatsApp(cliente, io) {
    // 1. Mata qualquer resquício de sessão na memória RAM
    if (sessoes.has(cliente.id)) {
        const sessaoAntiga = sessoes.get(cliente.id);
        try { sessaoAntiga.end(undefined); } catch(e){}
        sessoes.delete(cliente.id);
    }

    // 2. Valida se deve ligar
    const check = await prisma.cliente.findUnique({ where: { id: cliente.id } });
    if (!check || check.status === 'OFFLINE') return;

    console.log(`[${cliente.nome}] 🐧 Iniciando motor Ubuntu...`);

    const sessionsDir = path.join(__dirname, '..', 'public', 'sessions');
    const pathAuth = path.join(sessionsDir, `${cliente.nome}-${cliente.id}`);

    if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(pathAuth);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }), 
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        browser: ["Ubuntu", "Chrome", "20.0.04"], 
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000, 
        defaultQueryTimeoutMs: 60000,
        syncFullHistory: false
    });

    // --- GERADOR DE CÓDIGO INTELIGENTE ---
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                if (sock.authState.creds.registered) return;
                const atual = await prisma.cliente.findUnique({ where: { id: cliente.id } });
                if (!atual || atual.status !== 'ONLINE') return;

                const phoneNumber = cliente.numero.replace(/[^0-9]/g, '');
                console.log(`[${cliente.nome}] 📞 Solicitando código para ${phoneNumber}...`);
                
                const code = await sock.requestPairingCode(phoneNumber);
                const codeFormatado = code?.match(/.{1,4}/g)?.join('-') || code;
                
                console.log(`\n✅ CÓDIGO: ${codeFormatado}\n`);
                if (io) io.emit('pairingCode', { clienteId: cliente.id, code: codeFormatado });

            } catch (erro) {
                console.error(`[${cliente.nome}] ❌ Erro ao gerar código:`, erro.message);
            }
        }, 5000); // Delay maior para estabilizar o socket
    }

    // --- SALVAMENTO BLINDADO ---
    sock.ev.on('creds.update', async () => {
        if (fs.existsSync(pathAuth)) await saveCreds();
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            sessoes.delete(cliente.id);
            console.log(`[${cliente.nome}] 🔴 Desconectado. Código: ${statusCode}`);
            
            // --- BLINDAGEM ANTI-LOOP (CÓDIGO 401) ---
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log(`[${cliente.nome}] 🗑️ Credenciais inválidas. Limpando pasta...`);
                
                await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'OFFLINE' } });
                if(io) io.emit('status', { clienteId: cliente.id, status: 'OFFLINE' });

                // Tenta apagar a pasta para que na próxima vez ele peça um novo código
                setTimeout(() => {
                    try { if (fs.existsSync(pathAuth)) fs.rmSync(pathAuth, { recursive: true, force: true }); } catch(e){}
                }, 2000);
            
            } else {
                // Reconexão apenas para quedas de internet
                const checkReconnect = await prisma.cliente.findUnique({ where: { id: cliente.id } });
                if (checkReconnect && checkReconnect.status === 'ONLINE') {
                    console.log(`[${cliente.nome}] 🔄 Tentando reconectar...`);
                    setTimeout(() => iniciarWhatsApp(cliente, io), 3000);
                }
            }

        } else if (connection === 'open') {
            console.log(`[${cliente.nome}] 🟢 CONECTADO COM SUCESSO!`);
            sessoes.set(cliente.id, sock);
            await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'ONLINE' } });
            if(io) io.emit('status', { clienteId: cliente.id, status: 'ONLINE' });
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message || msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) return;

            const remoteJid = msg.key.remoteJid;
            const realMessage = unwrapMessage(msg.message);
            const nomePerfil = msg.pushName || "Cliente";

            let texto = realMessage.conversation || realMessage.extendedTextMessage?.text || "";
            if (!texto && realMessage.documentMessage) texto = "#ARQUIVO";

            if (texto) {
                await engine.processarMensagem(cliente.id, remoteJid, texto, sock, prisma, nomePerfil);
            }
        } catch (error) { console.error(`Erro msg: ${error.message}`); }
    });

    sessoes.set(cliente.id, sock);
}

module.exports = { iniciarWhatsApp, sessoes };