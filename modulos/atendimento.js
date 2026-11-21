// ============================================================
// ARQUIVO: modulos/atendimento.js
// CONVERSAS AO VIVO: registra as mensagens de cada número, transmite em tempo
// real para o dashboard (Socket.IO) e permite ASSUMIR a conversa (pausa o bot
// naquele contato e deixa o atendente responder pelo próprio dashboard).
//
// O "assumir" usa a mesma pausa que o engine já tinha (sessions.setPausado),
// a mesma do bloco "transferir" e dos comandos #PAUSE / #BOT.
// ============================================================
const { AsyncLocalStorage } = require('async_hooks');
const sessions = require('./sessions');

const RETENCAO_DIAS = 30;      // mensagens mais antigas que isso são apagadas
const MAX_TEXTO = 4000;        // limite de caracteres por mensagem
const LIMITE_LISTA = 200;      // conversas na lista lateral
const LIMITE_MENSAGENS = 60;   // mensagens por página de histórico

// Marca quem está enviando: o bot (padrão) ou o atendente pelo dashboard.
const contextoEnvio = new AsyncLocalStorage();

let prisma = null;
let io = null;

const sala = (clienteId) => `cliente:${clienteId}`;

// Mesma normalização do engine.js: é a chave da pausa no Redis.
const userNumDe = (remoteJid) => String(remoteJid).replace(/:[0-9]+/g, '').replace(/@lid/g, '@s.whatsapp.net');
// JID para gravar/enviar: tira só o sufixo de aparelho.
const jidLimpo = (remoteJid) => String(remoteJid).replace(/:[0-9]+@/, '@');
const ehGrupoOuStatus = (jid) => /@g\.us$|@broadcast$|^status@/.test(String(jid));

function formatarNumero(jid) {
    const j = String(jid);
    if (!j.endsWith('@s.whatsapp.net')) return 'Número oculto';
    const d = j.split('@')[0].replace(/\D/g, '');
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
        const ddd = d.slice(2, 4);
        const resto = d.slice(4);
        const corte = resto.length === 9 ? 5 : 4;
        return `+55 (${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
    }
    return '+' + d;
}

// ------------------------------------------------------------
// Descrição do que foi enviado/recebido (a conversa mostra texto)
// ------------------------------------------------------------
function descreverConteudo(c) {
    if (!c || typeof c !== 'object') return null;
    if (c.text != null) return { texto: String(c.text), tipo: 'texto' };
    if (c.image) return { texto: c.caption ? `📷 ${c.caption}` : '📷 Foto', tipo: 'imagem' };
    if (c.video) return { texto: c.caption ? `🎥 ${c.caption}` : '🎥 Vídeo', tipo: 'video' };
    if (c.audio) return { texto: '🎤 Áudio', tipo: 'audio' };
    if (c.document) return { texto: `📄 ${c.fileName || 'Documento'}`, tipo: 'documento' };
    if (c.sticker) return { texto: '💟 Figurinha', tipo: 'imagem' };
    if (c.location) return { texto: '📍 Localização', tipo: 'texto' };
    if (c.contacts) return { texto: '👤 Contato', tipo: 'texto' };
    if (c.poll) return { texto: '📊 Enquete', tipo: 'texto' };
    return null; // reação, apagar mensagem etc.
}

function descreverRecebida(m) {
    if (!m || typeof m !== 'object') return null;
    const texto = m.conversation || m.extendedTextMessage?.text;
    if (texto) return { texto: String(texto), tipo: 'texto' };
    if (m.imageMessage) return { texto: m.imageMessage.caption ? `📷 ${m.imageMessage.caption}` : '📷 Foto', tipo: 'imagem' };
    if (m.videoMessage) return { texto: m.videoMessage.caption ? `🎥 ${m.videoMessage.caption}` : '🎥 Vídeo', tipo: 'video' };
    if (m.audioMessage) return { texto: '🎤 Áudio', tipo: 'audio' };
    if (m.documentMessage) return { texto: `📄 ${m.documentMessage.fileName || 'Documento'}`, tipo: 'documento' };
    if (m.stickerMessage) return { texto: '💟 Figurinha', tipo: 'imagem' };
    if (m.locationMessage || m.liveLocationMessage) return { texto: '📍 Localização', tipo: 'texto' };
    if (m.contactMessage || m.contactsArrayMessage) return { texto: '👤 Contato', tipo: 'texto' };
    if (m.pollCreationMessage || m.pollCreationMessageV3) return { texto: '📊 Enquete', tipo: 'texto' };
    return null;
}

// ------------------------------------------------------------
// Gravação + transmissão
// ------------------------------------------------------------
const paraContato = (c) => ({
    id: c.id, remoteJid: c.remoteJid, nome: c.nome || null, numero: formatarNumero(c.remoteJid),
    ultimaMensagem: c.ultimaMensagem || '', ultimaEm: c.ultimaEm
});
const paraMensagem = (m) => ({
    id: m.id, texto: m.texto, tipo: m.tipo, fromMe: m.fromMe, origem: m.origem || (m.fromMe ? 'BOT' : 'CLIENTE'), criadoEm: m.criadoEm
});

function previa(texto, fromMe, origem, tipo) {
    if (tipo === 'sistema') return texto.substring(0, 120);
    const prefixo = fromMe ? (origem === 'BOT' ? '🤖 ' : 'Você: ') : '';
    return (prefixo + texto).replace(/\s+/g, ' ').substring(0, 120);
}

async function obterContato(clienteId, remoteJid, nome, dadosUltima) {
    const chave = { clienteId_remoteJid: { clienteId, remoteJid } };
    const atualizar = { ...dadosUltima, ...(nome ? { nome: String(nome).substring(0, 100) } : {}) };
    const criar = { clienteId, remoteJid, nome: nome ? String(nome).substring(0, 100) : null, ...dadosUltima };
    try {
        return await prisma.contato.upsert({ where: chave, create: criar, update: atualizar });
    } catch (e) {
        if (e && e.code === 'P2002') return prisma.contato.update({ where: chave, data: atualizar }); // corrida: já foi criado
        throw e;
    }
}

/**
 * Grava uma mensagem na conversa e avisa os dashboards abertos.
 * Nunca lança erro: o registro não pode derrubar o bot.
 * Devolve { contato, mensagem } ou null (ignorada/duplicada/erro).
 */
async function registrarMensagem({ clienteId, remoteJid, nome, texto, tipo = 'texto', fromMe = false, origem, waId }) {
    try {
        if (!prisma || !clienteId || !remoteJid || ehGrupoOuStatus(remoteJid)) return null;
        texto = String(texto ?? '').substring(0, MAX_TEXTO);
        if (!texto.trim()) return null;
        origem = origem || (fromMe ? 'BOT' : 'CLIENTE');

        const jid = jidLimpo(remoteJid);
        const agora = new Date();
        const contato = await obterContato(clienteId, jid, fromMe ? null : nome, {
            ultimaEm: agora, ultimaMensagem: previa(texto, fromMe, origem, tipo)
        });

        let mensagem;
        try {
            mensagem = await prisma.mensagem.create({
                data: { contatoId: contato.id, texto, tipo, fromMe: !!fromMe, origem, waId: waId || null, criadoEm: agora }
            });
        } catch (e) {
            if (e && e.code === 'P2002') return null; // mesma mensagem já gravada (eco do WhatsApp)
            throw e;
        }

        if (io) {
            io.to(sala(clienteId)).emit('conversa:mensagem', {
                clienteId, contato: paraContato(contato), mensagem: paraMensagem(mensagem)
            });
        }
        return { contato, mensagem };
    } catch (e) {
        console.error('[ATENDIMENTO] Falha ao registrar mensagem:', e.message);
        return null;
    }
}

/**
 * Chamado pelo wrapper do sock.sendMessage (whatsapp.js) a cada envio.
 * Quando o envio foi feito pelo atendente, devolve uma Promise (a rota espera
 * pelo resultado); para o bot, grava em segundo plano sem atrasar a resposta.
 */
function registrarSaida({ clienteId, jid, conteudo, resultado }) {
    const desc = descreverConteudo(conteudo);
    if (!desc || !desc.texto) return undefined;
    const ctx = contextoEnvio.getStore();
    const p = registrarMensagem({
        clienteId, remoteJid: jid, fromMe: true, origem: (ctx && ctx.origem) || 'BOT',
        texto: desc.texto, tipo: desc.tipo, waId: resultado && resultado.key && resultado.key.id
    });
    if (ctx) return p.then((r) => { ctx.resultado = r; });
    return undefined;
}

// Linha de aviso dentro da conversa ("Atendimento humano ativado" etc.)
async function registrarSistema(contato, texto) {
    const agora = new Date();
    const atualizado = await prisma.contato.update({
        where: { id: contato.id }, data: { ultimaEm: agora, ultimaMensagem: texto.substring(0, 120) }
    });
    const mensagem = await prisma.mensagem.create({
        data: { contatoId: contato.id, texto, tipo: 'sistema', fromMe: true, origem: 'SISTEMA', criadoEm: agora }
    });
    if (io) {
        io.to(sala(contato.clienteId)).emit('conversa:mensagem', {
            clienteId: contato.clienteId, contato: paraContato(atualizado), mensagem: paraMensagem(mensagem)
        });
    }
}

// Disparado pelo sessions.setPausado quando o estado muda (dashboard, #PAUSE, #BOT, bloco "transferir"...)
async function aoMudarPausa(userNum, humano, clienteId) {
    if (!prisma) return;
    try {
        const candidatos = [...new Set([userNum, userNum.replace('@s.whatsapp.net', '@lid')])];
        const contatos = await prisma.contato.findMany({ where: { remoteJid: { in: candidatos }, ...(clienteId ? { clienteId } : {}) } });
        for (const c of contatos) {
            await registrarSistema(c, humano
                ? '🙋 Atendimento humano ativado. O bot está pausado nesta conversa.'
                : '🤖 Bot reativado nesta conversa.');
            if (io) io.to(sala(c.clienteId)).emit('conversa:estado', { clienteId: c.clienteId, contatoId: c.id, humano });
        }
    } catch (e) {
        console.error('[ATENDIMENTO] Falha ao avisar mudança de pausa:', e.message);
    }
}

// ------------------------------------------------------------
// Permissão: dono do bot ou ADMIN
// ------------------------------------------------------------
async function podeVerCliente(sessao, clienteId) {
    if (!sessao || !sessao.userId || !clienteId) return null;
    const cliente = await prisma.cliente.findUnique({ where: { id: String(clienteId) } });
    if (!cliente) return null;
    if (cliente.donoId !== sessao.userId && sessao.role !== 'ADMIN') return null;
    return cliente;
}

// ------------------------------------------------------------
// Limpeza periódica (privacidade e tamanho do banco)
// ------------------------------------------------------------
async function limparAntigas() {
    if (!prisma) return;
    try {
        const limite = new Date(Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000);
        await prisma.mensagem.deleteMany({ where: { criadoEm: { lt: limite } } });
        await prisma.contato.deleteMany({ where: { ultimaEm: { lt: limite }, mensagens: { none: {} } } });
    } catch (e) {
        console.error('[ATENDIMENTO] Falha na limpeza de mensagens antigas:', e.message);
    }
}

// ------------------------------------------------------------
// Inicialização: conecta Prisma, Socket.IO e o aviso de pausa
// ------------------------------------------------------------
function init({ prisma: p, io: servidorIo, sessionMiddleware }) {
    prisma = p;
    io = servidorIo;

    // Compartilha a sessão do login com o Socket.IO (para saber quem está conectado)
    if (sessionMiddleware && io && io.engine && typeof io.engine.use === 'function') {
        io.engine.use(sessionMiddleware);
    }

    io.on('connection', (socket) => {
        // O dashboard só recebe as conversas de um bot depois de provar que é dono dele.
        socket.on('conversas:entrar', async (dados, ack) => {
            const responder = (r) => { if (typeof ack === 'function') ack(r); };
            try {
                const cliente = await podeVerCliente(socket.request.session, dados && dados.clienteId);
                if (!cliente) return responder({ ok: false });
                socket.join(sala(cliente.id));
                responder({ ok: true });
            } catch (e) { responder({ ok: false }); }
        });
        socket.on('conversas:sair', (dados) => {
            if (dados && dados.clienteId) socket.leave(sala(dados.clienteId));
        });
    });

    sessions.setOnPausaChange(aoMudarPausa);

    limparAntigas();
    setInterval(limparAntigas, 6 * 60 * 60 * 1000).unref();
}

// ------------------------------------------------------------
// Rotas
// ------------------------------------------------------------
function registrarRotas(app, { isAuth, getSock }) {

    const seguro = (fn) => async (req, res) => {
        try { await fn(req, res); }
        catch (e) {
            console.error('[ATENDIMENTO] Erro:', e);
            if (!res.headersSent) res.status(500).json({ success: false, error: 'Erro interno. Tente novamente.' });
        }
    };

    // Carrega bot + contato garantindo que o usuário pode ver aquele bot
    async function carregar(req, res) {
        const cliente = await podeVerCliente(req.session, req.params.clienteId);
        if (!cliente) { res.status(404).json({ success: false, error: 'Bot não encontrado.' }); return null; }
        let contato = null;
        if (req.params.contatoId) {
            contato = await prisma.contato.findFirst({ where: { id: String(req.params.contatoId), clienteId: cliente.id } });
            if (!contato) { res.status(404).json({ success: false, error: 'Conversa não encontrada.' }); return null; }
        }
        return { cliente, contato };
    }

    // Página (estilo WhatsApp)
    app.get('/dashboard/conversas/:clienteId', isAuth, async (req, res) => {
        try {
            const cliente = await podeVerCliente(req.session, req.params.clienteId);
            if (!cliente || cliente.plataforma === 'INSTAGRAM') return res.redirect('/dashboard');
            res.render('conversas', {
                cliente: { id: cliente.id, nome: cliente.nome, numero: cliente.numero || '', status: cliente.status },
                retencaoDias: RETENCAO_DIAS
            });
        } catch (e) {
            console.error('[ATENDIMENTO] Erro ao abrir conversas:', e);
            res.redirect('/dashboard');
        }
    });

    // Lista lateral
    app.get('/api/conversas/:clienteId', isAuth, seguro(async (req, res) => {
        const ctx = await carregar(req, res); if (!ctx) return;
        const contatos = await prisma.contato.findMany({
            where: { clienteId: ctx.cliente.id }, orderBy: { ultimaEm: 'desc' }, take: LIMITE_LISTA
        });
        const pausados = await sessions.dentroDoBot(ctx.cliente.id, () => sessions.pausadosEm(contatos.map(c => userNumDe(c.remoteJid))));
        res.json({
            success: true,
            status: ctx.cliente.status,
            conversas: contatos.map(c => ({ ...paraContato(c), humano: pausados.has(userNumDe(c.remoteJid)) }))
        });
    }));

    // Histórico de uma conversa (mais recentes primeiro na busca, devolvido em ordem cronológica)
    app.get('/api/conversas/:clienteId/:contatoId/mensagens', isAuth, seguro(async (req, res) => {
        const ctx = await carregar(req, res); if (!ctx) return;
        const antes = req.query.antes ? new Date(String(req.query.antes)) : null;
        const where = { contatoId: ctx.contato.id };
        if (antes && !isNaN(antes.getTime())) where.criadoEm = { lt: antes };
        const lote = await prisma.mensagem.findMany({ where, orderBy: { criadoEm: 'desc' }, take: LIMITE_MENSAGENS + 1 });
        const temMais = lote.length > LIMITE_MENSAGENS;
        const mensagens = lote.slice(0, LIMITE_MENSAGENS).reverse().map(paraMensagem);
        res.json({
            success: true, temMais, mensagens,
            humano: await sessions.dentroDoBot(ctx.cliente.id, () => sessions.isPausado(userNumDe(ctx.contato.remoteJid)))
        });
    }));

    // Liga/desliga "Assumir conversa" (= pausa/reativa o bot só nesse contato)
    app.post('/api/conversas/:clienteId/:contatoId/assumir', isAuth, seguro(async (req, res) => {
        const ctx = await carregar(req, res); if (!ctx) return;
        const ativo = req.body && req.body.ativo === true;
        await sessions.dentroDoBot(ctx.cliente.id, () => sessions.setPausado(userNumDe(ctx.contato.remoteJid), ativo));
        res.json({ success: true, humano: ativo });
    }));

    // Atendente responde pelo dashboard (só com a conversa assumida)
    app.post('/api/conversas/:clienteId/:contatoId/enviar', isAuth, seguro(async (req, res) => {
        const ctx = await carregar(req, res); if (!ctx) return;
        const texto = String((req.body && req.body.texto) ?? '').trim();
        if (!texto) return res.status(400).json({ success: false, error: 'Digite uma mensagem.' });
        if (texto.length > MAX_TEXTO) return res.status(400).json({ success: false, error: `A mensagem passa de ${MAX_TEXTO} caracteres.` });

        if (!(await sessions.dentroDoBot(ctx.cliente.id, () => sessions.isPausado(userNumDe(ctx.contato.remoteJid))))) {
            return res.status(409).json({ success: false, error: 'Ative "Assumir conversa" antes de responder, para o bot não responder junto.' });
        }
        const sock = ctx.cliente.status === 'ONLINE' ? getSock(ctx.cliente.id) : null;
        if (!sock) return res.status(409).json({ success: false, error: 'Este bot está desligado ou desconectado do WhatsApp.' });

        const store = { origem: 'HUMANO', resultado: null };
        try {
            await contextoEnvio.run(store, () => sock.sendMessage(ctx.contato.remoteJid, { text: texto }));
        } catch (e) {
            console.error('[ATENDIMENTO] Falha ao enviar pelo dashboard:', e.message);
            return res.status(502).json({ success: false, error: 'Não consegui enviar. Confira se o WhatsApp está conectado.' });
        }
        res.json({ success: true, mensagem: store.resultado ? paraMensagem(store.resultado.mensagem) : null });
    }));
}

module.exports = {
    init, registrarRotas, registrarMensagem, registrarSaida,
    descreverConteudo, descreverRecebida, limparAntigas
};
