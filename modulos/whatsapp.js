// ============================================================
// ARQUIVO: modulos/whatsapp.js (V5.6 - BLINDADO CONTRA ENOENT)
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
const path = require('path'); // Importante para Windows
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
    // Se já existe sessão, não mata ela a menos que seja estritamente necessário
    // A lógica de "Mute" do engine.js cuida do resto
    if (sessoes.has(cliente.id)) {
        return; 
    }

    const checkStatus = await prisma.cliente.findUnique({ where: { id: cliente.id } });
    if (!checkStatus) { // Se o cliente não existe mais, aborta
        return;
    }
    // NOTA: Removemos a checagem '&& !checkStatus.ativo' para garantir que ele conecte 
    // mesmo que esteja marcado como OFFLINE no banco (para o modo Mute funcionar)

    console.log(`[SISTEMA] 🔗 Conectando: ${cliente.nome}...`);

    // --- CORREÇÃO DE CAMINHO PARA WINDOWS ---
    const sessionsDir = path.join(__dirname, '..', 'sessions');
    const pathAuth = path.join(sessionsDir, `${cliente.nome}-${cliente.id}`);

    // Garante que a pasta 'sessions' existe
    if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
    }
    
    // Garante que a pasta do cliente existe
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
        browser: ["Windows", "Chrome", "1.0.0"], 
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000, 
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        syncFullHistory: false 
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                // Verifica novamente se o cliente ainda quer conectar
                const current = await prisma.cliente.findUnique({ where: { id: cliente.id } });
                
                // Só gera código se o status no banco for ONLINE (Para evitar spam em bot desligado)
                if (!current || current.status !== 'ONLINE') return;

                const phoneNumber = cliente.numero.replace(/[^0-9]/g, '');
                if (sock.ws.isClosed || sock.authState.creds.registered) return;
                
                console.log(`[${cliente.nome}] ⏳ Gerando código...`);
                const code = await sock.requestPairingCode(phoneNumber);
                const codeFormatado = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(`[${cliente.nome}] 🔢 CÓDIGO: ${codeFormatado}`);
                
                if (io) io.emit('pairingCode', { clienteId: cliente.id, code: codeFormatado });
            } catch (erro) {
                // console.error(`Erro ao gerar código para ${cliente.nome}:`, erro.message);
            }
        }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            sessoes.delete(cliente.id);
            
            // SE FOR LOGOUT (Desconexão pelo Celular)
            if (statusCode === DisconnectReason.loggedOut) {
                console.log(`[${cliente.nome}] ❌ LOGOUT (Desconectado pelo celular).`);
                try {
                    // Tenta apagar a pasta com segurança
                    fs.rmSync(pathAuth, { recursive: true, force: true });
                } catch(e){
                    console.error(`Erro ao apagar pasta de sessão: ${e.message}`);
                }
                
                // Marca como OFFLINE no banco para o usuário saber
                await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'OFFLINE' } });
                if(io) io.emit('status', { clienteId: cliente.id, status: 'OFFLINE' });
            
            } else {
                // SE FOR QUEDA (Erro 515, Internet, etc)
                // console.log(`[${cliente.nome}] ⚠️ Queda (${statusCode}). Reconectando...`);
                
                // Reconexão agressiva (mas segura)
                setTimeout(() => iniciarWhatsApp(cliente, io), 3000);
            }

        } else if (connection === 'open') {
            console.log(`[${cliente.nome}] 🟢 CONECTADO!`);
            sessoes.set(cliente.id, sock);
            
            // Garante que o status visual fique verde
            await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'ONLINE' } });
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

            // BARREIRA DE BOOT (Ignora mensagens antigas)
            const messageTimestamp = typeof msg.messageTimestamp === "number" 
                ? msg.messageTimestamp 
                : msg.messageTimestamp.low; 
            
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