// ============================================================
// ARQUIVO: modulos/whatsapp.js (V5.7 - CORREÇÃO DO DESLIGAMENTO)
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
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const engine = require('./engine'); 

const STARTUP_TIME = Math.floor(Date.now() / 1000); 
const sessoes = new Map();

function unwrapMessage(msg) {
    if (!msg) return null;
    if (msg.ephemeralMessage) return unwrapMessage(msg.ephemeralMessage.message);
    if (msg.viewOnceMessage) return unwrapMessage(msg.viewOnceMessage.message);
    if (msg.viewOnceMessageV2) return unwrapMessage(msg.viewOnceMessageV2.message);
    return msg;
}

async function iniciarWhatsApp(cliente, io) {
    if (sessoes.has(cliente.id)) return; 

    // Verifica se cliente ainda existe
    const checkStatus = await prisma.cliente.findUnique({ where: { id: cliente.id } });
    if (!checkStatus) return;

    // --- SEGURANÇA EXTRA: Se estiver marcado como OFFLINE no banco, NÃO inicia ---
    // Isso impede que loops antigos ressuscitem o bot
    if (checkStatus.status === 'OFFLINE') {
        console.log(`[${cliente.nome}] 🛑 Status é OFFLINE. Abortando conexão.`);
        return;
    }

    console.log(`[SISTEMA] 🔗 Conectando: ${cliente.nome}...`);

    const sessionsDir = path.join(__dirname, '..', 'sessions');
    const pathAuth = path.join(sessionsDir, `${cliente.nome}-${cliente.id}`);

    if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
    if (!fs.existsSync(pathAuth)) fs.mkdirSync(pathAuth, { recursive: true });

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
        browser: ["Calixto System", "Chrome", "10.0"], 
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
                if (!current || current.status !== 'ONLINE') return;

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
            
            // 1. Buscamos o status ATUAL no banco de dados
            // Isso é o segredo. Se você clicou em desligar, lá estará 'OFFLINE'
            const clienteAtualizado = await prisma.cliente.findUnique({ where: { id: cliente.id } });

            if (statusCode === DisconnectReason.loggedOut) {
                console.log(`[${cliente.nome}] ❌ LOGOUT (Desconectado pelo celular).`);
                try { fs.rmSync(pathAuth, { recursive: true, force: true }); } catch(e){}
                
                await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'OFFLINE' } });
                if(io) io.emit('status', { clienteId: cliente.id, status: 'OFFLINE' });
            
            } else {
                // SE NÃO FOI LOGOUT, VERIFICAMOS SE DEVEMOS RECONECTAR
                if (clienteAtualizado && clienteAtualizado.status === 'ONLINE') {
                    console.log(`[${cliente.nome}] ⚠️ Queda acidental. Reconectando em 3s...`);
                    setTimeout(() => iniciarWhatsApp(cliente, io), 3000);
                } else {
                    console.log(`[${cliente.nome}] 🛑 Conexão encerrada manualmente (OFFLINE). Não reconectando.`);
                    // AQUI O BOT MORRE E NÃO VOLTA MAIS
                }
            }

        } else if (connection === 'open') {
            console.log(`[${cliente.nome}] 🟢 CONECTADO!`);
            sessoes.set(cliente.id, sock);
            
            await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'ONLINE' } });
            if(io) io.emit('status', { clienteId: cliente.id, status: 'ONLINE' });
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid.includes('@g.us')) return;

            const messageTimestamp = typeof msg.messageTimestamp === "number" ? msg.messageTimestamp : msg.messageTimestamp.low; 
            if (messageTimestamp <= STARTUP_TIME) return;

            const remoteJid = msg.key.remoteJid;
            const realMessage = unwrapMessage(msg.message);
            const nomePerfil = msg.pushName || "Cliente";

            let texto = "";
            if (realMessage.conversation) texto = realMessage.conversation;
            else if (realMessage.extendedTextMessage?.text) texto = realMessage.extendedTextMessage.text;
            else if (realMessage.buttonsResponseMessage?.selectedButtonId) texto = realMessage.buttonsResponseMessage.selectedButtonId;
            else if (realMessage.listResponseMessage?.singleSelectReply?.selectedRowId) texto = realMessage.listResponseMessage.singleSelectReply.selectedRowId;
            else if (realMessage.interactiveResponseMessage) {
                const native = realMessage.interactiveResponseMessage.nativeFlowResponseMessage;
                const body = realMessage.interactiveResponseMessage.body;
                if (native) {
                    try { const params = JSON.parse(native.paramsJson); texto = params.id || ""; } catch (e) { texto = "" }
                } else if (body) { texto = body.text; }
            }

            if (!texto && realMessage.audioMessage) texto = "#AUDIO";
            if (!texto && realMessage.imageMessage) texto = "#IMAGEM";
            if (!texto && realMessage.documentMessage) texto = "#ARQUIVO";
            if (!texto && realMessage.videoMessage) texto = "#VIDEO";

            if (texto) {
               await engine.processarMensagem(cliente.id, remoteJid, texto, sock, prisma, nomePerfil);
            }
        } catch (error) {
            console.error(`Erro msg: ${error.message}`);
        }
    });

    sessoes.set(cliente.id, sock);
}

module.exports = { iniciarWhatsApp, sessoes };