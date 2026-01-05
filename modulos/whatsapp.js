// ============================================================
// ARQUIVO: modulos/whatsapp.js (V5.5 - BARREIRA DE BOOT)
// ============================================================
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const engine = require('./engine'); 

// --- NOVO: MARCA A HORA QUE O SISTEMA LIGOU ---
const STARTUP_TIME = Math.floor(Date.now() / 1000); 

const sessoes = new Map();

// Função auxiliar para "desembrulhar" mensagens
function unwrapMessage(msg) {
    if (!msg) return null;
    if (msg.ephemeralMessage) return unwrapMessage(msg.ephemeralMessage.message);
    if (msg.viewOnceMessage) return unwrapMessage(msg.viewOnceMessage.message);
    if (msg.viewOnceMessageV2) return unwrapMessage(msg.viewOnceMessageV2.message);
    return msg;
}

async function iniciarWhatsApp(cliente, io) {
    if (sessoes.has(cliente.id)) {
        try { sessoes.get(cliente.id).end(undefined); sessoes.delete(cliente.id); } catch (e) {}
    }

    const checkStatus = await prisma.cliente.findUnique({ where: { id: cliente.id } });
    if (!checkStatus || !checkStatus.ativo) {
        console.log(`[${cliente.nome}] ⏹️ Bot desligado. Abortando.`);
        return;
    }

    console.log(`[SISTEMA] 🔗 Conectando: ${cliente.nome}...`);

    const pathAuth = `./sessions/${cliente.nome}-${cliente.id}`;
    if (!fs.existsSync(pathAuth)) {
        fs.mkdirSync(pathAuth, { recursive: true });
    }

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
        keepAliveIntervalMs: 10000,
        syncFullHistory: false 
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const current = await prisma.cliente.findUnique({ where: { id: cliente.id } });
                if (!current.ativo) return;
                const phoneNumber = cliente.numero.replace(/[^0-9]/g, '');
                if (sock.ws.isClosed || sock.authState.creds.registered) return;
                
                console.log(`[${cliente.nome}] ⏳ Gerando código...`);
                const code = await sock.requestPairingCode(phoneNumber);
                const codeFormatado = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(`[${cliente.nome}] 🔢 CÓDIGO: ${codeFormatado}`);
                
                if (io) io.emit('pairingCode', { clienteId: cliente.id, code: codeFormatado });
            } catch (erro) {}
        }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            sessoes.delete(cliente.id);
            
            if (statusCode === DisconnectReason.loggedOut) {
                console.log(`[${cliente.nome}] ❌ LOGOUT.`);
                try {
                    fs.rmSync(pathAuth, { recursive: true, force: true });
                    await prisma.cliente.update({ where: { id: cliente.id }, data: { ativo: false } });
                    if(io) io.emit('status', { clienteId: cliente.id, status: 'OFFLINE' });
                } catch(e){}
            } else {
                const dbCheck = await prisma.cliente.findUnique({ where: { id: cliente.id } });
                if (dbCheck && dbCheck.ativo) {
                    console.log(`[${cliente.nome}] ⚠️ Queda (${statusCode}). Reconectando...`);
                    setTimeout(() => iniciarWhatsApp(cliente, io), 3000);
                }
            }
        } else if (connection === 'open') {
            console.log(`[${cliente.nome}] 🟢 CONECTADO!`);
            sessoes.set(cliente.id, sock);
            await prisma.cliente.update({ where: { id: cliente.id }, data: { ativo: true } });
            if(io) io.emit('status', { clienteId: cliente.id, status: 'ONLINE' });
        }
    });

    // --- LEITURA DE MENSAGENS ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message) return;
            if (msg.key.fromMe) return;
            if (msg.key.remoteJid === 'status@broadcast') return;
            if (msg.key.remoteJid.includes('@g.us')) return; 

            // ============================================================
            // CORREÇÃO CRÍTICA: BARREIRA DE BOOT
            // ============================================================
            const messageTimestamp = typeof msg.messageTimestamp === "number" 
                ? msg.messageTimestamp 
                : msg.messageTimestamp.low; 
            
            // Se a mensagem foi enviada ANTES do sistema iniciar, IGNORE.
            // Isso mata qualquer histórico pendente, não importa se foi há 1 minuto ou 1 hora.
            if (messageTimestamp <= STARTUP_TIME) {
                // console.log(`[IGNORE] Mensagem pré-boot ignorada: ${msg.key.remoteJid}`);
                return;
            }
            // ============================================================

            const botId = sock.user?.id?.split(':')[0];
            const senderId = msg.key.remoteJid.split('@')[0];
            if (botId && botId === senderId) return;

            const remoteJid = msg.key.remoteJid;
            const realMessage = unwrapMessage(msg.message);

            let texto = "";

            if (realMessage.conversation) texto = realMessage.conversation;
            else if (realMessage.extendedTextMessage?.text) texto = realMessage.extendedTextMessage.text;
            
            else if (realMessage.buttonsResponseMessage?.selectedButtonId) {
                texto = realMessage.buttonsResponseMessage.selectedButtonId;
            }
            else if (realMessage.listResponseMessage?.singleSelectReply?.selectedRowId) {
                texto = realMessage.listResponseMessage.singleSelectReply.selectedRowId;
            }
            
            else if (realMessage.interactiveResponseMessage) {
                const native = realMessage.interactiveResponseMessage.nativeFlowResponseMessage;
                const body = realMessage.interactiveResponseMessage.body;
                
                if (native) {
                    try {
                        const params = JSON.parse(native.paramsJson);
                        texto = params.id || "";
                    } catch (e) { texto = "" }
                } 
                else if (body) {
                    texto = body.text; 
                }
            }

            if (!texto && realMessage.audioMessage) texto = "#AUDIO";
            if (!texto && realMessage.imageMessage) texto = "#IMAGEM";
            if (!texto && realMessage.documentMessage) texto = "#ARQUIVO";
            if (!texto && realMessage.videoMessage) texto = "#VIDEO";

            if (texto) {
                await engine.processarMensagem(cliente.id, remoteJid, texto, sock, prisma);
            }
        } catch (error) {
            console.error(`Erro msg: ${error.message}`);
        }
    });

    sessoes.set(cliente.id, sock);
}

module.exports = { iniciarWhatsApp, sessoes };