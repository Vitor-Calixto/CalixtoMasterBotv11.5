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
const atendimento = require('./atendimento'); // Conversas ao vivo (dashboard)

// Memória RAM Global: Guarda os Sockets ativos de todos os clientes
const sessoes = new Map();

// Avisos em tempo real só para o dono do bot e os administradores
const salasDoBot = (cliente) => ['admins', `usuario:${cliente.donoId}`];

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

// ----------------------------------------------------------------------------
// Pasta da sessão do WhatsApp (as chaves da conta ficam aqui)
// Fica FORA de "public": tudo em public é servido pela internet.
// A pasta usa só o ID do robô (nome com "/" ou ".." nunca vira caminho) e a pasta
// antiga (public/sessions/<nome>-<id>) é movida para cá sozinha, sem pedir novo pareamento.
// ----------------------------------------------------------------------------
const PASTA_SESSOES = path.join(__dirname, '..', 'storage', 'whatsapp');
const PASTA_SESSOES_ANTIGA = path.join(__dirname, '..', 'public', 'sessions');
const idSeguro = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');

function pastaDaSessao(cliente) {
    const destino = path.join(PASTA_SESSOES, idSeguro(cliente.id));
    fs.mkdirSync(PASTA_SESSOES, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(destino)) {
        try {
            const antiga = fs.existsSync(PASTA_SESSOES_ANTIGA)
                ? fs.readdirSync(PASTA_SESSOES_ANTIGA).find(n => n.endsWith('-' + cliente.id))
                : null;
            if (antiga) {
                fs.cpSync(path.join(PASTA_SESSOES_ANTIGA, antiga), destino, { recursive: true });
                fs.rmSync(path.join(PASTA_SESSOES_ANTIGA, antiga), { recursive: true, force: true });
                console.log(`[WHATSAPP] 🔒 Sessão de "${cliente.nome}" movida para fora da pasta pública.`);
            }
        } catch (e) { console.error('[WHATSAPP] Não consegui mover a sessão antiga:', e.message); }
    }
    return destino;
}

function apagarPastaDaSessao(cliente) {
    try { fs.rmSync(path.join(PASTA_SESSOES, idSeguro(cliente.id)), { recursive: true, force: true }); } catch (e) {}
    try {   // sobra de versões antigas
        if (fs.existsSync(PASTA_SESSOES_ANTIGA)) {
            for (const n of fs.readdirSync(PASTA_SESSOES_ANTIGA)) {
                if (n.endsWith('-' + cliente.id)) fs.rmSync(path.join(PASTA_SESSOES_ANTIGA, n), { recursive: true, force: true });
            }
        }
    } catch (e) {}
}

// Mensagens já tratadas (a Meta/WhatsApp às vezes entrega a mesma duas vezes ao reconectar)
const jaTratadas = new Set();
function primeiraVez(id) {
    if (!id) return true;
    if (jaTratadas.has(id)) return false;
    jaTratadas.add(id);
    if (jaTratadas.size > 2000) jaTratadas.delete(jaTratadas.values().next().value);
    return true;
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
        const pathAuth = pastaDaSessao(cliente);
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

        // 💬 Conversas ao vivo: tudo que SAI por este socket (bot, disparos, atendente)
        // é registrado e aparece em tempo real no dashboard. Falha no registro nunca barra o envio.
        const enviarOriginal = sock.sendMessage.bind(sock);
        sock.sendMessage = async (jid, conteudo, opcoes) => {
            const resultado = await enviarOriginal(jid, conteudo, opcoes);
            try { await atendimento.registrarSaida({ clienteId: cliente.id, jid, conteudo, resultado }); } catch (e) {}
            return resultado;
        };

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
                    
                    if (io) io.to(salasDoBot(cliente)).emit('pairingCode', { clienteId: cliente.id, code: codeFormatado });
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
              // Código 401 ou loggedOut significa que o usuário desconectou no celular
              const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
              // 440 = o mesmo número abriu em outro lugar: reconectar daria uma briga sem fim entre os dois
              const substituida = statusCode === DisconnectReason.connectionReplaced || statusCode === 440;
              const shouldReconnect = !isLoggedOut && !substituida;
              
              console.log(`[${cliente.nome}] 📉 Conexão perdida. Código: ${statusCode}. Reconectar? ${shouldReconnect}`);

              if (substituida) {
                  console.log(`[${cliente.nome}] ⚠️ Este WhatsApp foi aberto em outro lugar (conexão substituída). Não vou reconectar sozinho.`);
                  sessoes.delete(cliente.id);
                  try { await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'OFFLINE' } }); } catch (e) {}
                  if (io) io.to(salasDoBot(cliente)).emit('status', { clienteId: cliente.id, status: 'OFFLINE' });
              } else if (isLoggedOut) {
                  console.log(`[${cliente.nome}] 🚫 Sessão deslogada pelo aparelho.`);
                  await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'OFFLINE' } });
                  if(io) io.to(salasDoBot(cliente)).emit('status', { clienteId: cliente.id, status: 'OFFLINE' });
                  try { fs.rmSync(pathAuth, { recursive: true, force: true }); } catch (e) {}
                  
                  // SÓ DELETA A SESSÃO AQUI, SE FOR DESLOGAR PRA VALER
                  sessoes.delete(cliente.id); 
              } else if (shouldReconnect) {
                  // SE FOR RECONECTAR, NÃO DELETA! Deixa a função iniciarWhatsApp limpar o zumbi.
                  setTimeout(() => iniciarWhatsApp(cliente, io), 3000); 
              }

          } else if (connection === 'open') {
              sessoes.set(cliente.id, sock); 
              await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'ONLINE' } });
              if(io) io.to(salasDoBot(cliente)).emit('status', { clienteId: cliente.id, status: 'ONLINE' });
              console.log(`[${cliente.nome}] ✅ Conexão Estabelecida com sucesso!`);
          }
      });

//         // ====================================================================
//         // 🛡️ G. ESCUTADOR DE MENSAGENS E ROTEAMENTO (GATEKEEPER)
//         // ====================================================================
//         sock.ev.on('messages.upsert', async ({ messages, type }) => {
//             try {
//                 if (type !== 'notify') return; 
//                 const msg = messages[0];

//                 // Travas de Segurança (Impede loops e histórico)
//                 if (!msg.message || msg.key.fromMe) return;
//                 const msgTimestamp = msg.messageTimestamp * 1000;
//                 if (msgTimestamp < uptimeStart || (Date.now() - msgTimestamp) > 30000) return;

//                 const remoteJid = msg.key.remoteJid;
//                 if (isJidBroadcast(remoteJid) || isJidGroup(remoteJid)) return;

//                 const realMessage = unwrapMessage(msg.message);
//                 const texto = (realMessage.conversation || realMessage.extendedTextMessage?.text || realMessage.imageMessage?.caption || realMessage.videoMessage?.caption || "").trim();
                
//                 if (!texto) return;

//                 console.log(`[WPP RECEBIDO] De: ${remoteJid.split('@')[0]} | Msg: "${texto.substring(0, 30)}..."`);

//                 // ATALHO: Cancelamento direto de agendamentos
//                 if (texto.toUpperCase() === 'SIM') {
//                     const numeroLimpo = remoteJid.replace(/\D/g, '');
//                     const deleteResult = await prisma.lembrete.deleteMany({
//                         where: { 
//                             clienteId: cliente.id, 
//                             numero: { endsWith: numeroLimpo.slice(-8) }, 
//                             dataAgendada: { gte: new Date() } 
//                         }
//                     });

//                     if (deleteResult.count > 0) {
//                         await sock.sendMessage(remoteJid, { text: "✅ Sua consulta foi cancelada com sucesso. Agradecemos o aviso." });
//                         if(io) io.emit('atualizarAgenda');
//                     }
//                     return; // Encerra o fluxo aqui.
//                 }

//                 // 🚀 DESPACHANTE FINAL: Joga para o Cérebro V12 (Engine)
//                 await engine.processarMensagem(cliente.id, remoteJid, texto, sock, prisma, msg.pushName || "Cliente");

//             } catch (error) { 
//                 console.error(`[ERRO CRÍTICO WHATSAPP]:`, error.message); 
//             }
//         });

//         sessoes.set(cliente.id, sock);

//     } catch (errorGlobal) {
//         console.error(`[FALHA DE IGNIÇÃO] Não foi possível inicializar WhatsApp:`, errorGlobal);
//     }
// }
// ====================================================================
        // 🛡️ G. ESCUTADOR DE MENSAGENS E ROTEAMENTO (GATEKEEPER)
        // ====================================================================
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            for (const msg of messages) {
                try {
                    if (!msg.message) continue;
                    if (!primeiraVez(`${cliente.id}:${msg.key.id}`)) continue;

                    const fromMe = !!msg.key.fromMe;
                    const realMessage = unwrapMessage(msg.message);
                    const texto = (realMessage?.conversation || realMessage?.extendedTextMessage?.text || realMessage?.imageMessage?.caption || "").trim();

                    // 💬 Conversas ao vivo: registra tudo que chegou (inclusive mídia) ou foi digitado no celular.
                    // Fica ANTES dos filtros do bot, mas nunca interfere neles.
                    try {
                        const jidRegistro = msg.key.remoteJid;
                        if (jidRegistro && !isJidBroadcast(jidRegistro) && !isJidGroup(jidRegistro)) {
                            const desc = atendimento.descreverRecebida(realMessage);
                            if (desc && desc.texto) {
                                atendimento.registrarMensagem({
                                    clienteId: cliente.id, remoteJid: jidRegistro,
                                    nome: fromMe ? undefined : msg.pushName,
                                    fromMe, origem: fromMe ? 'CELULAR' : 'CLIENTE',
                                    texto: desc.texto, tipo: desc.tipo, waId: msg.key.id
                                });
                            }
                        }
                    } catch (e) { /* o registro nunca pode derrubar o bot */ }

                    // --- 🚀 FILTRO DE SEGURANÇA ---
                    if (fromMe && !texto.startsWith('#')) continue; // Gestor só passa se usar #
                    if (!fromMe && !texto) continue;                // Mensagem vazia de cliente é ignorada

                    const remoteJid = msg.key.remoteJid;
                    if (!remoteJid || isJidBroadcast(remoteJid) || isJidGroup(remoteJid)) continue;

                    console.log(`[WPP RECEBIDO] De: ${remoteJid.split('@')[0]} | Gestor? ${fromMe} | Msg: "${texto.slice(0, 80)}"`);

                    // 🚀 DESPACHANTE FINAL: Joga para o Cérebro V12 (Engine)
                    await engine.processarMensagem(cliente.id, remoteJid, texto, sock, prisma, msg.pushName || "Cliente", 'WHATSAPP', null, { fromMe });

                } catch (error) {
                    console.error(`[ERRO CRÍTICO WHATSAPP]:`, error.message);
                }
            }
        });

        sessoes.set(cliente.id, sock);

    } catch (errorGlobal) {
        console.error(`[FALHA DE IGNIÇÃO] Não foi possível inicializar WhatsApp:`, errorGlobal);
    }
}

// 📦 5. EXPORTAÇÃO
module.exports = { iniciarWhatsApp, sessoes, pastaDaSessao, apagarPastaDaSessao };