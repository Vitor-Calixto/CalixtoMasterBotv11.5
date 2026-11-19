// ============================================================
// ARQUIVO: modulos/fluxos.js
// BIBLIOTECA DE FLUXOS: modelos salvos, duplicar, exportar e enviar
// (aplicar em outro bot, enviar a outro usuário, link de compartilhamento)
// ============================================================
const crypto = require('crypto');

const LIMITE_BIBLIOTECA = 100;   // fluxos aceitos por usuário
const LIMITE_PENDENTES = 20;     // fluxos recebidos aguardando aceite
const LIMITE_NOS = 500;          // blocos por fluxo
const LIMITE_BYTES = 5 * 1024 * 1024;

// ------------------------------------------------------------
// Utilitários
// ------------------------------------------------------------
function limparTexto(texto, max) {
    return String(texto ?? '').replace(/[<>]/g, '').trim().substring(0, max);
}

// Confere se o JSON tem o formato exportado pelo Drawflow e não é abusivo.
function validarFluxo(fluxo) {
    if (!fluxo || typeof fluxo !== 'object' || Array.isArray(fluxo)) {
        return { erro: 'Fluxo inválido.' };
    }
    const data = fluxo.drawflow && fluxo.drawflow.Home && fluxo.drawflow.Home.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { erro: 'Fluxo inválido: não encontrei o desenho (drawflow.Home.data).' };
    }
    const nos = Object.values(data);
    if (nos.length === 0) return { erro: 'O fluxo está vazio. Monte ao menos um bloco antes de enviar.' };
    if (nos.length > LIMITE_NOS) return { erro: `O fluxo passa do limite de ${LIMITE_NOS} blocos.` };
    if (nos.some(n => !n || typeof n !== 'object' || typeof n.name !== 'string')) {
        return { erro: 'Fluxo inválido: há blocos sem nome.' };
    }
    if (Buffer.byteLength(JSON.stringify(fluxo)) > LIMITE_BYTES) {
        return { erro: 'O fluxo é grande demais (máximo 5 MB).' };
    }
    return { fluxo, totalNos: nos.length };
}

// Antes de um fluxo cruzar de um usuário para outro (envio direto ou link),
// removemos o HTML guardado em cada bloco. O editor recria o HTML a partir dos
// templates oficiais ao abrir (sanitizarJson), então ninguém consegue plantar
// código no editor de outra pessoa. O motor do bot não usa esse campo.
function limparParaTerceiros(fluxo) {
    const copia = JSON.parse(JSON.stringify(fluxo));
    copia.drawflow = { Home: copia.drawflow.Home };
    const data = copia.drawflow.Home.data;
    for (const id of Object.keys(data)) data[id].html = '';
    return copia;
}

function slug(texto) {
    return String(texto || 'fluxo')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        .toLowerCase().substring(0, 50) || 'fluxo';
}

const CAMPOS_LISTA = {
    id: true, nome: true, descricao: true, totalNos: true, recebidoDe: true,
    pendente: true, shareToken: true, criadoEm: true, atualizadoEm: true
};

// ------------------------------------------------------------
// Rotas
// ------------------------------------------------------------
module.exports = function registrarRotasFluxos(app, { prisma, isAuth }) {

    const seguro = (fn) => async (req, res) => {
        try { await fn(req, res); }
        catch (e) {
            console.error('[FLUXOS] Erro:', e);
            if (!res.headersSent) res.status(500).json({ success: false, error: 'Erro interno. Tente novamente.' });
        }
    };

    const buscarMeu = (req, id) =>
        prisma.fluxoModelo.findFirst({ where: { id: String(id), donoId: req.session.userId } });

    const contarAceitos = (donoId) =>
        prisma.fluxoModelo.count({ where: { donoId, pendente: false } });

    const urlCompartilhamento = (req, token) =>
        `${req.protocol}://${req.get('host')}/fluxo/compartilhado/${token}`;

    // Fluxo vindo de um modelo da biblioteca (modeloId) ou do desenho aberto no editor (fluxo).
    async function obterFluxoDaRequisicao(req) {
        const { modeloId, fluxo } = req.body || {};
        if (modeloId) {
            const m = await buscarMeu(req, modeloId);
            if (!m) return { erro: 'Fluxo não encontrado.', status: 404 };
            const v = validarFluxo(m.fluxoJson);
            if (v.erro) return { erro: v.erro, status: 400 };
            return { ...v, nome: m.nome, descricao: m.descricao };
        }
        const v = validarFluxo(fluxo);
        if (v.erro) return { erro: v.erro, status: 400 };
        return v;
    }

    // Quem abre um link sem estar logado volta para ele depois do login.
    function exigirLogin(req, res, next) {
        if (!req.session.userId) {
            req.session.returnTo = req.originalUrl;
            return res.redirect('/login');
        }
        return isAuth(req, res, next);
    }

    // ---------------- Páginas ----------------
    app.get('/dashboard/fluxos', isAuth, async (req, res) => {
        try {
            const uid = req.session.userId;
            const [modelos, clientes] = await Promise.all([
                prisma.fluxoModelo.findMany({
                    where: { donoId: uid },
                    orderBy: { atualizadoEm: 'desc' },
                    select: CAMPOS_LISTA
                }),
                prisma.cliente.findMany({
                    where: req.session.role === 'ADMIN' ? {} : { donoId: uid },
                    orderBy: { nome: 'asc' },
                    select: { id: true, nome: true }
                })
            ]);
            res.render('fluxos', {
                modelos, clientes,
                usuario: req.session.usuario,
                baseUrl: `${req.protocol}://${req.get('host')}`,
                limite: LIMITE_BIBLIOTECA
            });
        } catch (e) {
            console.error('[FLUXOS] Erro ao abrir a biblioteca:', e);
            res.status(500).send('Erro ao carregar a biblioteca de fluxos.');
        }
    });

    // Editor aberto sobre um modelo (mesma tela do editor dos bots)
    app.get('/dashboard/fluxos/:id/editor', isAuth, async (req, res) => {
        try {
            const m = await buscarMeu(req, req.params.id);
            if (!m || m.pendente) return res.redirect('/dashboard/fluxos');
            res.render('editor', { cliente: { id: m.id, nome: m.nome }, fluxo: m.fluxoJson || {}, modoModelo: true });
        } catch (e) {
            console.error('[FLUXOS] Erro ao abrir o editor do modelo:', e);
            res.redirect('/dashboard/fluxos');
        }
    });

    // Página aberta a partir de um link compartilhado
    app.get('/fluxo/compartilhado/:token', exigirLogin, async (req, res) => {
        try {
            const m = await prisma.fluxoModelo.findUnique({
                where: { shareToken: String(req.params.token) },
                include: { dono: { select: { nome: true } } }
            });
            const valido = m && !m.pendente;
            res.render('fluxo-compartilhado', {
                modelo: valido ? {
                    nome: m.nome, descricao: m.descricao, totalNos: m.totalNos,
                    donoNome: m.dono ? m.dono.nome : '',
                    meu: m.donoId === req.session.userId
                } : null,
                token: String(req.params.token)
            });
        } catch (e) {
            console.error('[FLUXOS] Erro no link compartilhado:', e);
            res.status(500).send('Erro ao abrir o link.');
        }
    });

    // ---------------- API: bots do usuário (lista para o "aplicar em bot") ----------------
    app.get('/api/fluxos/clientes', isAuth, seguro(async (req, res) => {
        const clientes = await prisma.cliente.findMany({
            where: req.session.role === 'ADMIN' ? {} : { donoId: req.session.userId },
            orderBy: { nome: 'asc' },
            select: { id: true, nome: true }
        });
        res.json({ success: true, clientes });
    }));

    // ---------------- API: biblioteca ----------------
    app.get('/api/fluxos', isAuth, seguro(async (req, res) => {
        const modelos = await prisma.fluxoModelo.findMany({
            where: { donoId: req.session.userId, pendente: false },
            orderBy: { atualizadoEm: 'desc' },
            select: CAMPOS_LISTA
        });
        res.json({ success: true, modelos });
    }));

    // Cria um modelo: em branco (só nome) ou a partir de um fluxo (editor / arquivo importado)
    app.post('/api/fluxos', isAuth, seguro(async (req, res) => {
        const uid = req.session.userId;
        const nome = limparTexto(req.body.nome, 100);
        if (!nome) return res.status(400).json({ success: false, error: 'Dê um nome ao fluxo.' });
        if (await contarAceitos(uid) >= LIMITE_BIBLIOTECA) {
            return res.status(400).json({ success: false, error: `Sua biblioteca chegou ao limite de ${LIMITE_BIBLIOTECA} fluxos.` });
        }

        let fluxoJson = {};
        let totalNos = 0;
        if (req.body.fluxo) {
            const v = validarFluxo(req.body.fluxo);
            if (v.erro) return res.status(400).json({ success: false, error: v.erro });
            fluxoJson = v.fluxo;
            totalNos = v.totalNos;
        }

        const modelo = await prisma.fluxoModelo.create({
            data: { nome, descricao: limparTexto(req.body.descricao, 300) || null, fluxoJson, totalNos, donoId: uid }
        });
        res.json({ success: true, id: modelo.id });
    }));

    // Ações de envio (rotas fixas antes das rotas com :id)
    app.post('/api/fluxos/enviar/cliente', isAuth, seguro(async (req, res) => {
        const uid = req.session.userId;
        const origem = await obterFluxoDaRequisicao(req);
        if (origem.erro) return res.status(origem.status || 400).json({ success: false, error: origem.erro });

        const cliente = await prisma.cliente.findUnique({ where: { id: String(req.body.clienteId || '') } });
        if (!cliente || (cliente.donoId !== uid && req.session.role !== 'ADMIN')) {
            return res.status(404).json({ success: false, error: 'Bot não encontrado.' });
        }

        // Guarda o fluxo que estava no bot, para dar para voltar atrás.
        let backupFeito = false;
        if (req.body.backup !== false && cliente.fluxoJson && !validarFluxo(cliente.fluxoJson).erro
            && await contarAceitos(uid) < LIMITE_BIBLIOTECA) {
            const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
            const anterior = validarFluxo(cliente.fluxoJson);
            await prisma.fluxoModelo.create({
                data: {
                    nome: limparTexto(`Backup - ${cliente.nome} - ${quando}`, 100),
                    descricao: 'Fluxo que estava no bot antes de ser substituído.',
                    fluxoJson: anterior.fluxo, totalNos: anterior.totalNos, donoId: uid
                }
            });
            backupFeito = true;
        }

        await prisma.cliente.update({ where: { id: cliente.id }, data: { fluxoJson: origem.fluxo } });
        res.json({ success: true, backupFeito, cliente: cliente.nome });
    }));

    app.post('/api/fluxos/enviar/usuario', isAuth, seguro(async (req, res) => {
        const uid = req.session.userId;
        const origem = await obterFluxoDaRequisicao(req);
        if (origem.erro) return res.status(origem.status || 400).json({ success: false, error: origem.erro });

        const email = String(req.body.email || '').trim();
        const naoAchou = { success: false, error: 'Não encontrei um usuário ativo com esse e-mail.' };
        if (!email) return res.status(400).json(naoAchou);

        const destino = await prisma.usuario.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
        if (!destino || destino.id === uid || destino.bloqueado || !destino.ativo) return res.status(404).json(naoAchou);

        const pendentes = await prisma.fluxoModelo.count({ where: { donoId: destino.id, pendente: true } });
        if (pendentes >= LIMITE_PENDENTES) {
            return res.status(429).json({ success: false, error: 'A caixa de entrada desse usuário está cheia. Tente mais tarde.' });
        }

        await prisma.fluxoModelo.create({
            data: {
                nome: limparTexto(req.body.nome || origem.nome || 'Fluxo recebido', 100),
                descricao: limparTexto(req.body.descricao || origem.descricao, 300) || null,
                fluxoJson: limparParaTerceiros(origem.fluxo),
                totalNos: origem.totalNos,
                donoId: destino.id,
                recebidoDe: limparTexto(req.session.usuario ? req.session.usuario.nome : 'Outro usuário', 100),
                pendente: true
            }
        });
        res.json({ success: true, destinatario: destino.nome });
    }));

    app.post('/api/fluxos/enviar/link', isAuth, seguro(async (req, res) => {
        const uid = req.session.userId;
        let modelo;

        if (req.body.modeloId) {
            modelo = await buscarMeu(req, req.body.modeloId);
            if (!modelo) return res.status(404).json({ success: false, error: 'Fluxo não encontrado.' });
            if (modelo.pendente) return res.status(400).json({ success: false, error: 'Aceite o fluxo recebido antes de compartilhar.' });
            const v = validarFluxo(modelo.fluxoJson);
            if (v.erro) return res.status(400).json({ success: false, error: v.erro });
        } else {
            // Fluxo vindo direto do editor: guardamos uma cópia na biblioteca para manter o link ativo.
            const origem = await obterFluxoDaRequisicao(req);
            if (origem.erro) return res.status(origem.status || 400).json({ success: false, error: origem.erro });
            if (await contarAceitos(uid) >= LIMITE_BIBLIOTECA) {
                return res.status(400).json({ success: false, error: `Sua biblioteca chegou ao limite de ${LIMITE_BIBLIOTECA} fluxos.` });
            }
            modelo = await prisma.fluxoModelo.create({
                data: {
                    nome: limparTexto(req.body.nome, 100) || 'Fluxo compartilhado',
                    descricao: limparTexto(req.body.descricao, 300) || null,
                    fluxoJson: origem.fluxo, totalNos: origem.totalNos, donoId: uid
                }
            });
        }

        if (!modelo.shareToken) {
            modelo = await prisma.fluxoModelo.update({
                where: { id: modelo.id },
                data: { shareToken: crypto.randomBytes(16).toString('base64url') }
            });
        }
        res.json({ success: true, id: modelo.id, url: urlCompartilhamento(req, modelo.shareToken) });
    }));

    app.post('/api/fluxos/link/:token/adicionar', isAuth, seguro(async (req, res) => {
        const uid = req.session.userId;
        const m = await prisma.fluxoModelo.findUnique({
            where: { shareToken: String(req.params.token) },
            include: { dono: { select: { nome: true } } }
        });
        if (!m || m.pendente) return res.status(404).json({ success: false, error: 'Link inválido ou desativado.' });
        if (m.donoId === uid) return res.status(400).json({ success: false, error: 'Este fluxo já está na sua biblioteca.' });

        const v = validarFluxo(m.fluxoJson);
        if (v.erro) return res.status(400).json({ success: false, error: v.erro });
        if (await contarAceitos(uid) >= LIMITE_BIBLIOTECA) {
            return res.status(400).json({ success: false, error: `Sua biblioteca chegou ao limite de ${LIMITE_BIBLIOTECA} fluxos.` });
        }

        const novo = await prisma.fluxoModelo.create({
            data: {
                nome: m.nome, descricao: m.descricao,
                fluxoJson: limparParaTerceiros(v.fluxo), totalNos: v.totalNos,
                donoId: uid, recebidoDe: m.dono ? m.dono.nome : null
            }
        });
        res.json({ success: true, id: novo.id });
    }));

    // ---------------- API: um modelo ----------------
    app.get('/api/fluxos/:id', isAuth, seguro(async (req, res) => {
        const m = await buscarMeu(req, req.params.id);
        if (!m) return res.status(404).json({ success: false, error: 'Fluxo não encontrado.' });
        res.json({ success: true, id: m.id, nome: m.nome, descricao: m.descricao, fluxo: m.fluxoJson });
    }));

    app.get('/api/fluxos/:id/exportar', isAuth, seguro(async (req, res) => {
        const m = await buscarMeu(req, req.params.id);
        if (!m) return res.status(404).json({ success: false, error: 'Fluxo não encontrado.' });
        const v = validarFluxo(m.fluxoJson);
        if (v.erro) return res.status(400).json({ success: false, error: v.erro });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${slug(m.nome)}.json"`);
        res.send(JSON.stringify(m.fluxoJson, null, 2));
    }));

    app.put('/api/fluxos/:id', isAuth, seguro(async (req, res) => {
        const m = await buscarMeu(req, req.params.id);
        if (!m) return res.status(404).json({ success: false, error: 'Fluxo não encontrado.' });
        const nome = limparTexto(req.body.nome, 100);
        if (!nome) return res.status(400).json({ success: false, error: 'Dê um nome ao fluxo.' });
        await prisma.fluxoModelo.update({
            where: { id: m.id },
            data: { nome, descricao: limparTexto(req.body.descricao, 300) || null }
        });
        res.json({ success: true });
    }));

    // Salva o desenho vindo do editor
    app.post('/api/fluxos/:id/fluxo', isAuth, seguro(async (req, res) => {
        const m = await buscarMeu(req, req.params.id);
        if (!m) return res.status(404).json({ success: false, error: 'Fluxo não encontrado.' });
        const v = validarFluxo(req.body.fluxo);
        if (v.erro) return res.status(400).json({ success: false, error: v.erro });
        await prisma.fluxoModelo.update({ where: { id: m.id }, data: { fluxoJson: v.fluxo, totalNos: v.totalNos } });
        res.json({ success: true });
    }));

    app.post('/api/fluxos/:id/duplicar', isAuth, seguro(async (req, res) => {
        const uid = req.session.userId;
        const m = await buscarMeu(req, req.params.id);
        if (!m) return res.status(404).json({ success: false, error: 'Fluxo não encontrado.' });
        if (await contarAceitos(uid) >= LIMITE_BIBLIOTECA) {
            return res.status(400).json({ success: false, error: `Sua biblioteca chegou ao limite de ${LIMITE_BIBLIOTECA} fluxos.` });
        }
        const copia = await prisma.fluxoModelo.create({
            data: {
                nome: limparTexto(`Cópia de ${m.nome}`, 100), descricao: m.descricao,
                fluxoJson: m.fluxoJson, totalNos: m.totalNos, donoId: uid
            }
        });
        res.json({ success: true, id: copia.id });
    }));

    app.post('/api/fluxos/:id/aceitar', isAuth, seguro(async (req, res) => {
        const uid = req.session.userId;
        const m = await buscarMeu(req, req.params.id);
        if (!m || !m.pendente) return res.status(404).json({ success: false, error: 'Fluxo não encontrado.' });
        if (await contarAceitos(uid) >= LIMITE_BIBLIOTECA) {
            return res.status(400).json({ success: false, error: `Sua biblioteca chegou ao limite de ${LIMITE_BIBLIOTECA} fluxos.` });
        }
        await prisma.fluxoModelo.update({ where: { id: m.id }, data: { pendente: false } });
        res.json({ success: true });
    }));

    app.delete('/api/fluxos/:id/link', isAuth, seguro(async (req, res) => {
        const m = await buscarMeu(req, req.params.id);
        if (!m) return res.status(404).json({ success: false, error: 'Fluxo não encontrado.' });
        await prisma.fluxoModelo.update({ where: { id: m.id }, data: { shareToken: null } });
        res.json({ success: true });
    }));

    app.delete('/api/fluxos/:id', isAuth, seguro(async (req, res) => {
        const m = await buscarMeu(req, req.params.id);
        if (!m) return res.status(404).json({ success: false, error: 'Fluxo não encontrado.' });
        await prisma.fluxoModelo.delete({ where: { id: m.id } });
        res.json({ success: true });
    }));
};
