    // ==========================================
    // ARQUIVO: MODULOS/WHATSAPP.JS V20.0
    // ==========================================

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

async function conectarBot(clienteId) {
    try {
        // 1. Busca o cliente no banco para saber o nome da pasta
        const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
        if (!cliente) return console.error(`[ERRO] Cliente ${clienteId} não encontrado.`);

        // 2. 🛡️ TRAVA ANTI-DUPLICIDADE: Mata o robô antigo se ele já estiver rodando
        if (sessoes.has(clienteId)) {
            console.log(`[AVISO] Encerrando instância anterior do robô: ${cliente.nome}`);
            const sessaoAntiga = sessoes.get(clienteId);
            sessaoAntiga.ev.removeAllListeners(); 
            try { sessaoAntiga.end(undefined); } catch (e) {}
            sessoes.delete(clienteId);
        }

        // 3. Configura a pasta de autenticação física
        const authPath = path.join(__dirname, '..', 'public', 'sessions', `${cliente.nome}-${cliente.id}`);
        const { state, saveCreds } = await useMultiFileAuthState(authPath);

        // 4. Inicia o Socket do Baileys de verdade
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false, // Desativado para usar o Pairing Code do Dashboard
            logger: pino({ level: 'silent' }),
            browser: ["Ubuntu", "Chrome", "20.0.04"]
        });

        // Salva a sessão no Map global para controle
        sessoes.set(clienteId, sock);

        // 5. Gerenciamento de Conexão
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                // Se precisar de QR Code, você pode emitir via socket aqui
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(`[${cliente.nome}] Conexão fechada. Tentando reconectar? ${shouldReconnect}`);
                if (shouldReconnect) conectarBot(clienteId);
            } else if (connection === 'open') {
                console.log(`[${cliente.nome}] ✅ Conexão Estabelecida com Sucesso!`);
                await prisma.cliente.update({ where: { id: clienteId }, data: { status: 'ONLINE' } });
            }
        });

        // 6. Escuta de Mensagens (Envia para o seu engine.js)
        sock.ev.on('messages.upsert', async (m) => {
            if (m.type === 'notify') {
                for (const msg of m.messages) {
                    if (!msg.key.fromMe) {
                        await engine.processarMensagem(clienteId, sock, msg);
                    }
                }
            }
        });

        // 7. Salva as credenciais sempre que houver mudança
        sock.ev.on('creds.update', saveCreds);

        return sock;

    } catch (err) {
        console.error(`[ERRO CRÍTICO] Falha ao iniciar robô ${clienteId}:`, err);
    }
}

// 🕒 Trava de Tempo: Define o momento exato em que o servidor iniciou
const uptimeStart = Date.now();

function unwrapMessage(msg) {
    if (!msg) return null;
    if (msg.ephemeralMessage) return unwrapMessage(msg.ephemeralMessage.message);
    if (msg.viewOnceMessage) return unwrapMessage(msg.viewOnceMessage.message);
    if (msg.viewOnceMessageV2) return unwrapMessage(msg.viewOnceMessageV2.message);
    return msg;
}

async function iniciarWhatsApp(cliente, io) {
    if (typeof cliente === 'string') {
        cliente = await prisma.cliente.findUnique({ where: { id: cliente } });
    }

    if (!cliente || !cliente.id) {
        console.error("❌ Erro: Dados do cliente inválidos.");
        return;
    }

    // 1. Gestão de Memória: Limpa sessões fantasmas
    if (sessoes.has(cliente.id)) {
        const sessaoAntiga = sessoes.get(cliente.id);
        try { sessaoAntiga.end(undefined); } catch(e){}
        sessoes.delete(cliente.id);
    }

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
        generateHighQualityLinkPreview: false, // Otimização de performance
        syncFullHistory: false, // 🚫 NÃO baixa o passado
        shouldIgnoreJid: (jid) => jid?.includes('@broadcast') // 🚫 IGNORA STATUS e Listas de Transmissão
    });

    global.socks = global.socks || {};
    global.socks[cliente.id] = sock;

    // --- GERADOR DE PAREAMENTO DINÂMICO ---
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                if (sock.authState.creds.registered) return;
                const atual = await prisma.cliente.findUnique({ where: { id: cliente.id } });
                if (!atual || atual.status !== 'ONLINE') return;

                const phoneNumber = cliente.numero.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(phoneNumber);
                const codeFormatado = code?.match(/.{1,4}/g)?.join('-') || code;
                
                if (io) io.emit('pairingCode', { clienteId: cliente.id, code: codeFormatado });
                console.log(`[PAREAMENTO] Código para ${cliente.nome}: ${codeFormatado}`);
            } catch (erro) { console.error(`Erro código:`, erro.message); }
        }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            sessoes.delete(cliente.id);
            if (statusCode === 401) {
                await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'OFFLINE' } });
                if(io) io.emit('status', { clienteId: cliente.id, status: 'OFFLINE' });
            } else {
                setTimeout(() => iniciarWhatsApp(cliente, io), 3000);
            }
        } else if (connection === 'open') {
            sessoes.set(cliente.id, sock);
            await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'ONLINE' } });
            if(io) io.emit('status', { clienteId: cliente.id, status: 'ONLINE' });
            console.log(`[${cliente.nome}] ✅ Conexão Estabelecida.`);
        }
    });

    // ==========================================
    // 🛡️ ESCUTADOR DE MENSAGENS BLINDADO
    // ==========================================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify') return;
            const msg = messages[0];

            // 1️⃣ TRAVA: Ignora se a mensagem não tem conteúdo ou se foi enviada pelo próprio robô (ANTI-LOOP)
            if (!msg.message || msg.key.fromMe) return;

            // 2️⃣ TRAVA: Ignora mensagens antigas (Enviadas antes do servidor ligar ou há mais de 25s)
            const msgTimestamp = msg.messageTimestamp * 1000;
            if (msgTimestamp < uptimeStart || (Date.now() - msgTimestamp) > 25000) return;

            const remoteJid = msg.key.remoteJid;
            
            // 3️⃣ TRAVA: Ignora Status e Grupos (Se configurado para chat privado)
            if (remoteJid.includes('@broadcast') || remoteJid.includes('@g.us')) return;

            const realMessage = unwrapMessage(msg.message);
            const texto = (realMessage.conversation || realMessage.extendedTextMessage?.text || "").trim();
            if (!texto) return;

            // ⚙️ LOG DE RECEBIMENTO
            console.log(`[RECEBIDO] De: ${remoteJid} | Conteúdo: ${texto.substring(0, 20)}...`);

            // 🗑️ LÓGICA DE CANCELAMENTO (PRIORITÁRIA)
            if (texto.toUpperCase() === 'SIM') {
                const numeroLimpo = remoteJid.replace(/[^0-9]/g, '');
                const deleteResult = await prisma.lembrete.deleteMany({
                    where: { numero: numeroLimpo, dataAgendada: { gte: new Date() } }
                });

                if (deleteResult.count > 0) {
                    await sock.sendMessage(remoteJid, { text: "✅ Agendamentos cancelados com sucesso." });
                    if(io) io.emit('atualizarAgenda');
                } else {
                    await sock.sendMessage(remoteJid, { text: "⚠️ Não encontrei agendamentos pendentes." });
                }
                return;
            }

            // 🤖 MOTOR DE FLUXO (CHAMANDO O ENGINE)
            // Os comandos #RESET e #BOT já são tratados dentro do engine.js conforme seu backup.
            await engine.processarMensagem(cliente.id, remoteJid, texto, sock, prisma, msg.pushName || "Cliente");

        } catch (error) { 
            console.error(`[ERRO CRÍTICO MSG]: ${error.message}`); 
        }
    });

    sessoes.set(cliente.id, sock);
}

module.exports = { iniciarWhatsApp, sessoes };