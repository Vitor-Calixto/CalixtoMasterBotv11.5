// ============================================================================
// 🟢 CALIXTO OMNISYSTEM - MÓDULO DE COMUNICAÇÃO WHATSAPP (BAILEYS V20)
// ============================================================================

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    isJidBroadcast,
    isJidGroup
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

// 🔌 2. INSTÂNCIAS E VARIÁVEIS GLOBAIS
// ----------------------------------------------------------------------------
const prisma = new PrismaClient();
const engine = require('./engine'); // O Cérebro V12 que processa os fluxos

// Memória RAM Global: Guarda os Sockets ativos de todos os clientes
const sessoes = new Map();

// Trava Temporal: Impede que o bot responda mensagens antigas ao reiniciar
const uptimeStart = Date.now();


// ============================================================================
// 🛠️ 3. FUNÇÕES UTILITÁRIAS
// ============================================================================

/**
 * Função: unwrapMessage
 * Objetivo: Desempacotar mensagens complexas do WhatsApp (View Once, Temporárias).
 * Retorno: O objeto de mensagem contendo o texto real que o bot consegue ler.
 * * @param {Object} msg - O objeto de mensagem cru vindo do Baileys
 * @returns {Object|null} - A mensagem limpa ou null
 */
function unwrapMessage(msg) {
    if (!msg) return null;
    if (msg.ephemeralMessage) return unwrapMessage(msg.ephemeralMessage.message);
    if (msg.viewOnceMessage) return unwrapMessage(msg.viewOnceMessage.message);
    if (msg.viewOnceMessageV2) return unwrapMessage(msg.viewOnceMessageV2.message);
    
    return msg;
}


// ============================================================================
// 🚀 4. MOTOR PRINCIPAL (INICIALIZAÇÃO DO WHATSAPP)
// ============================================================================

/**
 * Função: iniciarWhatsApp
 * Objetivo: Criar a conexão com o WhatsApp, gerenciar credenciais, pareamento 
 * e escutar mensagens recebidas para rotear ao motor principal.
 * * @param {Object|string} clienteDado - O ID do cliente ou o objeto do cliente
 * @param {Object} io - A instância do Socket.io para comunicação com o Dashboard
 */
async function iniciarWhatsApp(clienteDado, io) {
    try {
        // --- A. VALIDAÇÃO DO CLIENTE ---
        let clienteId = typeof clienteDado === 'string' ? clienteDado : clienteDado.id;
        const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
        
        if (!cliente || cliente.status === 'OFFLINE') {
            console.log(`[WHATSAPP] Ignorando inicialização para cliente ${clienteId} (Offline/Deletado).`);
            return;
        }

        console.log(`\n🚀 [${cliente.nome}] Iniciando Adaptador WhatsApp (Protocolo V20)...`);

        // --- B. ANTI-DUPLICIDADE (LIMPEZA DE SOCKETS ZUMBIS) ---
        if (sessoes.has(cliente.id)) {
            console.log(`[${cliente.nome}] 🧹 Limpando socket zumbi anterior...`);
            const sessaoAntiga = sessoes.get(cliente.id);
            sessaoAntiga.ev.removeAllListeners();
            try { sessaoAntiga.end(undefined); } catch(e){}
            sessoes.delete(cliente.id);
        }

        // --- C. GESTÃO DE CHAVES E SESSÃO ---
        const sessionsDir = path.join(__dirname, '..', 'public', 'sessions');
        if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
        
        const pathAuth = path.join(sessionsDir, `${cliente.nome}-${cliente.id}`);
        const { state, saveCreds } = await useMultiFileAuthState(pathAuth);
        const { version } = await fetchLatestBaileysVersion();

        // --- D. CRIAÇÃO DO SOCKET BAILEYS ---
        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }), 
            printQRInTerminal: false, // Forçamos o uso do Pairing Code
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            browser: ["Ubuntu", "Chrome", "20.0.04"], 
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false, 
            shouldIgnoreJid: (jid) => isJidBroadcast(jid) || isJidGroup(jid) 
        });

        // --- E. SISTEMA DE PAREAMENTO (PAIRING CODE) ---
        if (!sock.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    if (sock.authState.creds.registered) return; 
                    
                    const checkStatus = await prisma.cliente.findUnique({ where: { id: cliente.id } });
                    if (!checkStatus || checkStatus.status !== 'ONLINE') return;

                    const phoneNumber = cliente.numero.replace(/\D/g, ''); 
                    const code = await sock.requestPairingCode(phoneNumber);
                    const codeFormatado = code?.match(/.{1,4}/g)?.join('-') || code;
                    
                    if (io) io.emit('pairingCode', { clienteId: cliente.id, code: codeFormatado });
                    console.log(`[PAREAMENTO] 🔑 Código gerado para ${cliente.nome}: ${codeFormatado}`);
                } catch (erro) { 
                    console.error(`[PAREAMENTO] ❌ Erro ao gerar código:`, erro.message); 
                }
            }, 5000); 
        }

        // --- F. MONITORAMENTO DE CONEXÃO ---
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                sessoes.delete(cliente.id);
                console.log(`[${cliente.nome}] 📉 Conexão perdida. Código: ${statusCode}. Reconectar? ${shouldReconnect}`);

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log(`[${cliente.nome}] 🚫 Sessão deslogada pelo aparelho.`);
                    await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'OFFLINE' } });
                    if(io) io.emit('status', { clienteId: cliente.id, status: 'OFFLINE' });
                    try { fs.rmSync(pathAuth, { recursive: true, force: true }); } catch (e) {}
                } else if (shouldReconnect) {
                    setTimeout(() => iniciarWhatsApp(cliente, io), 3000); // Backoff de reconexão
                }

            } else if (connection === 'open') {
                sessoes.set(cliente.id, sock); 
                await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'ONLINE' } });
                if(io) io.emit('status', { clienteId: cliente.id, status: 'ONLINE' });
                console.log(`[${cliente.nome}] ✅ Conexão Estabelecida com sucesso!`);
            }
        });


        // ====================================================================
        // 🛡️ G. ESCUTADOR DE MENSAGENS E ROTEAMENTO (GATEKEEPER)
        // ====================================================================
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            try {
                if (type !== 'notify') return; 
                const msg = messages[0];

                // Travas de Segurança (Impede loops e histórico)
                if (!msg.message || msg.key.fromMe) return;
                const msgTimestamp = msg.messageTimestamp * 1000;
                if (msgTimestamp < uptimeStart || (Date.now() - msgTimestamp) > 30000) return;

                const remoteJid = msg.key.remoteJid;
                if (isJidBroadcast(remoteJid) || isJidGroup(remoteJid)) return;

                const realMessage = unwrapMessage(msg.message);
                const texto = (realMessage.conversation || realMessage.extendedTextMessage?.text || realMessage.imageMessage?.caption || realMessage.videoMessage?.caption || "").trim();
                
                if (!texto) return;

                console.log(`[WPP RECEBIDO] De: ${remoteJid.split('@')[0]} | Msg: "${texto.substring(0, 30)}..."`);

                // ATALHO: Cancelamento direto de agendamentos
                if (texto.toUpperCase() === 'SIM') {
                    const numeroLimpo = remoteJid.replace(/\D/g, '');
                    const deleteResult = await prisma.lembrete.deleteMany({
                        where: { 
                            clienteId: cliente.id, 
                            numero: { endsWith: numeroLimpo.slice(-8) }, 
                            dataAgendada: { gte: new Date() } 
                        }
                    });

                    if (deleteResult.count > 0) {
                        await sock.sendMessage(remoteJid, { text: "✅ Sua consulta foi cancelada com sucesso. Agradecemos o aviso." });
                        if(io) io.emit('atualizarAgenda');
                    }
                    return; // Encerra o fluxo aqui.
                }

                // 🚀 DESPACHANTE FINAL: Joga para o Cérebro V12 (Engine)
                await engine.processarMensagem(cliente.id, remoteJid, texto, sock, prisma, msg.pushName || "Cliente");

            } catch (error) { 
                console.error(`[ERRO CRÍTICO WHATSAPP]:`, error.message); 
            }
        });

        sessoes.set(cliente.id, sock);

    } catch (errorGlobal) {
        console.error(`[FALHA DE IGNIÇÃO] Não foi possível inicializar WhatsApp:`, errorGlobal);
    }
}

// 📦 5. EXPORTAÇÃO
module.exports = { iniciarWhatsApp, sessoes };