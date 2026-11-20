// ============================================================
// ARQUIVO: modulos/usuarios.js
// CONTAS E ASSINATURAS
//  - login, cadastro, troca obrigatória de senha (senha provisória "mudar@123")
//  - esqueci a senha (link por e-mail, remetente configurado pelo admin)
//  - painel do administrador: criar, aprovar, bloquear, validade, senha, excluir
//  - assinatura: quem vence perde o acesso e tem os bots desligados
// ============================================================
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const email = require('./email');

// O dono do sistema é sempre administrador, mesmo que o banco diga outra coisa.
// Para mais de um admin: ADMIN_EMAILS=a@x.com,b@y.com no .env
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || 'vitorpedrocalixto@gmail.com')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

const SENHA_PROVISORIA = 'mudar@123';
const PLANOS_VALIDOS = ['ESSENTIAL', 'ADVANCED', 'SIGNATURE'];
const PERIODOS = [
    { id: '30', dias: 30, rotulo: '30 dias' },
    { id: '60', dias: 60, rotulo: '60 dias' },
    { id: '90', dias: 90, rotulo: '90 dias' },
    { id: '120', dias: 120, rotulo: '120 dias' },
    { id: '365', dias: 365, rotulo: 'Anual' },
    { id: 'vitalicio', dias: null, rotulo: 'Vitalício' }
];
const DIA = 24 * 60 * 60 * 1000;

// O que cada plano libera por padrão (o admin pode abrir exceções por usuário).
// Mantém o comportamento anterior: limite de bots e contratos vêm do plano; o resto era liberado para todos.
const PLANOS_PADRAO = {
    ESSENTIAL: { maxBots: 2, contratos: false, conversas: true, disparo: true, agenda: true },
    ADVANCED:  { maxBots: 3, contratos: false, conversas: true, disparo: true, agenda: true },
    SIGNATURE: { maxBots: 10, contratos: true, conversas: true, disparo: true, agenda: true }
};
const PERMISSOES = [
    { id: 'contratos', rotulo: 'Contratos em PDF', descricao: 'Criar modelos e enviar contratos pelo robô.' },
    { id: 'conversas', rotulo: 'Conversas ao vivo', descricao: 'Acompanhar e assumir as conversas pelo painel.' },
    { id: 'disparo', rotulo: 'Disparo em massa', descricao: 'Enviar mensagens para vários contatos de uma vez.' },
    { id: 'agenda', rotulo: 'Agenda', descricao: 'Ver e gerenciar os agendamentos.' }
];
const LIMITE_BOTS_ADMIN = 999;
const VALIDADE_LINK_RESET = 60 * 60 * 1000; // 1 hora

let prisma = null, io = null, whatsapp = null;

// ------------------------------------------------------------
// Regras
// ------------------------------------------------------------
const normalizarEmail = (e) => String(e || '').trim().toLowerCase().substring(0, 150);
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const limpar = (t, max = 100) => String(t ?? '').replace(/[<>]/g, '').trim().substring(0, max);
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const ehAdmin = (u) => !!u && (u.role === 'ADMIN' || ADMIN_EMAILS.includes(normalizarEmail(u.email)));

function validarSenha(senha, confirmar) {
    senha = String(senha || '');
    if (senha.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
    if (senha.length > 100) return 'A senha pode ter no máximo 100 caracteres.';
    if (senha === SENHA_PROVISORIA) return 'Essa é a senha provisória. Escolha uma senha diferente.';
    if (confirmar !== undefined && senha !== String(confirmar || '')) return 'As duas senhas não são iguais.';
    return null;
}

function fimDoDia(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

// Nova data de validade. Por padrão soma ao tempo que ainda resta (renovação);
// com aPartirDeHoje, conta a partir de hoje.
function calcularValidade(usuario, periodoId, aPartirDeHoje) {
    const p = PERIODOS.find(x => x.id === String(periodoId));
    if (!p) return { erro: 'Escolha um período válido.' };
    if (p.dias === null) return { expiraEm: null, periodo: p.id };
    const agora = new Date();
    const atual = usuario && usuario.expiraEm ? new Date(usuario.expiraEm) : null;
    const base = (!aPartirDeHoje && atual && atual > agora) ? atual : agora;
    return { expiraEm: fimDoDia(new Date(base.getTime() + p.dias * DIA)), periodo: p.id };
}

function statusDe(u) {
    if (ehAdmin(u)) return { codigo: 'admin', rotulo: 'Administrador', dias: null };
    if (u.bloqueado) return { codigo: 'bloqueado', rotulo: 'Bloqueado', dias: null };
    if (!u.ativo) return { codigo: 'pendente', rotulo: 'Aguardando aprovação', dias: null };
    if (!u.expiraEm) return { codigo: 'vitalicio', rotulo: 'Vitalício', dias: null };
    const dias = Math.ceil((new Date(u.expiraEm).getTime() - Date.now()) / DIA);
    if (dias <= 0) return { codigo: 'vencido', rotulo: 'Vencido', dias };
    if (dias <= 7) return { codigo: 'vencendo', rotulo: dias === 1 ? 'Vence amanhã' : `Vence em ${dias} dias`, dias };
    return { codigo: 'ativo', rotulo: 'Ativo', dias };
}

// Permissões efetivas: padrão do plano + exceções do usuário. Admin pode tudo.
function permissoesDe(u) {
    const base = PLANOS_PADRAO[u && u.plano] || PLANOS_PADRAO.ESSENTIAL;
    if (ehAdmin(u)) {
        const tudo = { maxBots: LIMITE_BOTS_ADMIN };
        PERMISSOES.forEach(p => { tudo[p.id] = true; });
        return tudo;
    }
    const exc = (u && u.permissoes && typeof u.permissoes === 'object') ? u.permissoes : {};
    const efetivas = { ...base };
    PERMISSOES.forEach(p => { if (typeof exc[p.id] === 'boolean') efetivas[p.id] = exc[p.id]; });
    if (Number.isInteger(exc.maxBots) && exc.maxBots >= 0) efetivas.maxBots = exc.maxBots;
    return efetivas;
}

// Bloqueia uma área se o usuário não tiver a permissão (usar depois do isAuth)
function exigirPermissao(chave) {
    return (req, res, next) => {
        const u = req.session && req.session.usuario;
        if (u && permissoesDe(u)[chave]) return next();
        const item = PERMISSOES.find(p => p.id === chave);
        const msg = `Seu plano não inclui ${item ? item.rotulo : 'este recurso'}. Fale com o suporte para liberar.`;
        if (req.originalUrl.startsWith('/api/') || req.xhr || (req.get('accept') || '').includes('application/json')) {
            return res.status(403).json({ success: false, error: msg });
        }
        return res.redirect('/dashboard?sem-permissao=' + encodeURIComponent(chave));
    };
}

const vencido = (u) => !ehAdmin(u) && !!u.expiraEm && new Date(u.expiraEm) < new Date();
const dataBR = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

function paraLista(u) {
    return {
        id: u.id, nome: u.nome, email: u.email, plano: u.plano, role: ehAdmin(u) ? 'ADMIN' : u.role,
        ativo: u.ativo, bloqueado: u.bloqueado, expiraEm: u.expiraEm, periodo: u.periodo || null,
        trocarSenha: !!u.trocarSenha, ultimoLogin: u.ultimoLogin || null, criadoEm: u.criadoEm,
        excecoes: (u.permissoes && typeof u.permissoes === 'object') ? u.permissoes : {},
        permissoes: permissoesDe(u),
        termsAccepted: u.termsAccepted, signupIp: u.signupIp || null,
        bots: (u.clientes || []).map(c => ({ id: c.id, nome: c.nome, status: c.status, plataforma: c.plataforma })),
        status: statusDe(u)
    };
}

async function buscarPorEmail(e) {
    return prisma.usuario.findFirst({ where: { email: { equals: normalizarEmail(e), mode: 'insensitive' } } });
}

// ------------------------------------------------------------
// Bots de quem venceu ou foi bloqueado são desligados
// ------------------------------------------------------------
async function desligarBotsDe(usuarioId) {
    const bots = await prisma.cliente.findMany({ where: { donoId: usuarioId, status: 'ONLINE' } });
    for (const b of bots) {
        await prisma.cliente.update({ where: { id: b.id }, data: { status: 'OFFLINE' } });
        if (whatsapp && whatsapp.sessoes.has(b.id)) {
            try { whatsapp.sessoes.get(b.id).end(undefined); } catch (e) {}
            whatsapp.sessoes.delete(b.id);
        }
        if (io) io.to(['admins', `usuario:${b.donoId}`]).emit('status', { clienteId: b.id, status: 'OFFLINE' });
    }
    return bots.length;
}

async function desligarBotsVencidos() {
    if (!prisma) return;
    try {
        const usuarios = await prisma.usuario.findMany({
            where: { OR: [{ expiraEm: { lt: new Date() } }, { bloqueado: true }] },
            select: { id: true, email: true, role: true, nome: true }
        });
        for (const u of usuarios) {
            if (ehAdmin(u)) continue;
            const n = await desligarBotsDe(u.id);
            if (n) console.log(`[ASSINATURA] ⏹️ ${n} bot(s) de ${u.nome} desligado(s): assinatura vencida ou conta bloqueada.`);
        }
    } catch (e) {
        console.error('[ASSINATURA] Falha ao desligar bots vencidos:', e.message);
    }
}

// ------------------------------------------------------------
// Sessão
// ------------------------------------------------------------
function encerrarSessao(req, res, aviso) {
    const destino = '/login' + (aviso ? `?aviso=${aviso}` : '');
    if (req.session && typeof req.session.destroy === 'function') {
        return req.session.destroy(() => res.redirect(destino));
    }
    return res.redirect(destino);
}

const semSegredos = (u) => { const { senha, resetToken, resetExpires, ...resto } = u; return resto; };

async function isAuth(req, res, next) {
    if (!req.session || !req.session.userId) return res.redirect('/login');
    let user;
    try {
        user = await prisma.usuario.findUnique({ where: { id: req.session.userId } });
    } catch (e) {
        console.error('[AUTH] Falha ao ler o usuário:', e.message);
        return res.redirect('/login');
    }
    if (!user) return encerrarSessao(req, res);

    const admin = ehAdmin(user);
    if (admin && (user.role !== 'ADMIN' || !user.ativo || user.bloqueado)) {
        user = await prisma.usuario.update({ where: { id: user.id }, data: { role: 'ADMIN', ativo: true, bloqueado: false } });
    }
    if (!admin) {
        if (user.bloqueado) return encerrarSessao(req, res, 'bloqueado');
        if (!user.ativo) return encerrarSessao(req, res, 'pendente');
        if (vencido(user)) return encerrarSessao(req, res, 'vencida');
    }
    // Senha trocada ou acesso alterado pelo admin: derruba sessões antigas
    if ((req.session.versaoSessao ?? 0) !== (user.versaoSessao ?? 0)) return encerrarSessao(req, res, 'sessao');

    req.session.usuario = semSegredos(user);
    req.session.role = admin ? 'ADMIN' : user.role;
    res.locals.ehAdmin = admin;
    res.locals.assinatura = statusDe(user);
    res.locals.permissoes = permissoesDe(user);

    if (user.trocarSenha && req.path !== '/trocar-senha') {
        if (req.path.startsWith('/api/')) return res.status(403).json({ success: false, error: 'Crie sua nova senha antes de continuar.' });
        return res.redirect('/trocar-senha');
    }
    return next();
}

function soAdmin(req, res, next) {
    if (req.session.role === 'ADMIN') return next();
    if (req.path.startsWith('/api/') || req.originalUrl.startsWith('/api/')) return res.status(403).json({ success: false, error: 'Apenas o administrador pode fazer isso.' });
    return res.redirect('/dashboard');
}

// ------------------------------------------------------------
// Login e cadastro (chamados pelas rotas do index.js)
// ------------------------------------------------------------
const AVISOS_LOGIN = {
    cadastro: { tipo: 'ok', texto: 'Conta criada! Assim que o administrador aprovar, você já pode entrar.' },
    'senha-alterada': { tipo: 'ok', texto: 'Senha alterada. Entre com a nova senha.' },
    vencida: { tipo: 'erro', texto: 'Sua assinatura venceu. Fale com o suporte para renovar.' },
    bloqueado: { tipo: 'erro', texto: 'Sua conta está bloqueada. Fale com o suporte.' },
    pendente: { tipo: 'erro', texto: 'Sua conta ainda está aguardando aprovação.' },
    sessao: { tipo: 'info', texto: 'Seu acesso foi atualizado. Entre novamente.' }
};

function renderLogin(res, extras = {}) {
    return res.render('login', { message: null, erro: null, aviso: null, email: '', ...extras });
}

function telaLogin(req, res) {
    if (req.session.userId) return res.redirect('/dashboard');
    const a = AVISOS_LOGIN[String(req.query.aviso || '')];
    const flash = typeof req.flash === 'function' ? req.flash('error') : [];
    return renderLogin(res, { aviso: a || null, erro: flash && flash.length ? flash[0] : null });
}

async function fazerLogin(req, res) {
    const emailDigitado = normalizarEmail(req.body.email);
    const senha = String(req.body.senha || '');
    try {
        const user = await buscarPorEmail(emailDigitado);
        const confere = (s) => { try { return !!s && bcrypt.compareSync(s, user.senha); } catch (e) { return false; } };
        const senhaOk = !!user && (confere(senha) || (senha.trim() !== senha && confere(senha.trim())));
        if (!senhaOk) return renderLogin(res, { erro: 'E-mail ou senha incorretos.', email: emailDigitado });

        const admin = ehAdmin(user);
        if (!admin) {
            if (user.bloqueado) return renderLogin(res, { erro: AVISOS_LOGIN.bloqueado.texto, email: emailDigitado });
            if (!user.ativo) return renderLogin(res, { erro: AVISOS_LOGIN.pendente.texto, email: emailDigitado });
            if (vencido(user)) return renderLogin(res, { erro: `Sua assinatura venceu em ${dataBR(user.expiraEm)}. Fale com o suporte para renovar.`, email: emailDigitado });
        }

        const precisaTrocar = !!user.trocarSenha || senha.trim() === SENHA_PROVISORIA;
        const atualizado = await prisma.usuario.update({
            where: { id: user.id },
            data: {
                ultimoLogin: new Date(),
                ...(precisaTrocar ? { trocarSenha: true } : {}),
                ...(admin ? { role: 'ADMIN', ativo: true, bloqueado: false } : {})
            }
        });

        const voltarPara = req.session.returnTo;
        req.session.regenerate((err) => {
            if (err) { console.error('[LOGIN] Falha na sessão:', err); return renderLogin(res, { erro: 'Erro no servidor. Tente de novo.' }); }
            req.session.userId = atualizado.id;
            req.session.role = admin ? 'ADMIN' : atualizado.role;
            req.session.usuario = semSegredos(atualizado);
            req.session.versaoSessao = atualizado.versaoSessao ?? 0;
            if (precisaTrocar) return res.redirect('/trocar-senha');
            const destino = typeof voltarPara === 'string' && voltarPara.startsWith('/fluxo/compartilhado/') ? voltarPara : '/dashboard';
            req.session.save(() => res.redirect(destino));
        });
    } catch (e) {
        console.error('[LOGIN] Erro:', e);
        return renderLogin(res, { erro: 'Erro no servidor. Tente de novo em instantes.', email: emailDigitado });
    }
}

function telaCadastro(req, res) {
    if (req.session.userId) return res.redirect('/dashboard');
    return res.render('registro', { message: null, dados: {} });
}

async function fazerCadastro(req, res) {
    const nome = limpar(req.body.nome, 100);
    const emailNovo = normalizarEmail(req.body.email);
    const dados = { nome, email: emailNovo };
    const erro = (m) => res.render('registro', { message: m, dados });
    try {
        if (nome.length < 2) return erro('Digite seu nome.');
        if (!emailValido(emailNovo)) return erro('Digite um e-mail válido.');
        const problema = validarSenha(req.body.senha, req.body.confirmar);
        if (problema) return erro(problema);
        if (!req.body.termos) return erro('Para criar a conta, aceite os Termos de Uso e a Política de Privacidade.');
        if (await buscarPorEmail(emailNovo)) return erro('Já existe uma conta com esse e-mail. Entre ou use "Esqueci minha senha".');

        const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        let admin = ADMIN_EMAILS.includes(emailNovo);
        if (admin && await prisma.usuario.count({ where: { role: 'ADMIN' } }) > 0) {
            // Ninguém cria pelo cadastro público uma conta com e-mail de administrador já em uso
            return erro('Não é possível criar uma conta com este e-mail.');
        }
        await prisma.usuario.create({
            data: {
                nome, email: emailNovo, senha: await bcrypt.hash(String(req.body.senha), 10),
                termsAccepted: true, termsAcceptedAt: new Date(), signupIp: ip.substring(0, 60),
                plano: 'ESSENTIAL', ativo: admin, role: admin ? 'ADMIN' : 'CLIENTE'
            }
        });
        return res.redirect('/login?aviso=cadastro');
    } catch (e) {
        console.error('[CADASTRO] Erro:', e);
        if (e && e.code === 'P2002') return erro('Já existe uma conta com esse e-mail.');
        return erro('Não foi possível criar a conta agora. Tente de novo em instantes.');
    }
}

// ------------------------------------------------------------
// Rotas
// ------------------------------------------------------------
function registrarRotas(app) {
    const limitarSenha = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false,
        handler: (req, res) => res.status(429).render('senha', { modo: 'esqueci', erro: 'Muitas tentativas. Espere 15 minutos e tente de novo.', ok: null, token: null }) });

    const seguro = (fn) => async (req, res) => {
        try { await fn(req, res); }
        catch (e) {
            console.error('[USUARIOS] Erro:', e);
            if (!res.headersSent) res.status(500).json({ success: false, error: 'Erro no servidor. Tente de novo.' });
        }
    };

    // ---------- trocar senha (obrigatória ou voluntária) ----------
    app.get('/trocar-senha', isAuth, (req, res) => {
        const obrigatoria = !!req.session.usuario.trocarSenha;
        res.render('senha', { modo: 'trocar', obrigatoria, erro: null, ok: null, token: null, nome: req.session.usuario.nome });
    });

    app.post('/trocar-senha', isAuth, async (req, res) => {
        const user = await prisma.usuario.findUnique({ where: { id: req.session.userId } });
        const obrigatoria = !!user.trocarSenha;
        const tela = (erro) => res.render('senha', { modo: 'trocar', obrigatoria, erro, ok: null, token: null, nome: user.nome });
        if (!obrigatoria && !bcrypt.compareSync(String(req.body.atual || ''), user.senha)) return tela('A senha atual está incorreta.');
        const problema = validarSenha(req.body.senha, req.body.confirmar);
        if (problema) return tela(problema);
        if (bcrypt.compareSync(String(req.body.senha), user.senha)) return tela('A nova senha precisa ser diferente da atual.');
        const atualizado = await prisma.usuario.update({
            where: { id: user.id },
            data: { senha: await bcrypt.hash(String(req.body.senha), 10), trocarSenha: false, resetToken: null, resetExpires: null, versaoSessao: { increment: 1 } }
        });
        req.session.versaoSessao = atualizado.versaoSessao;
        req.session.usuario = semSegredos(atualizado);
        req.session.save(() => res.redirect('/dashboard'));
    });

    // ---------- esqueci a senha ----------
    app.get('/esqueci-senha', (req, res) => {
        res.render('senha', { modo: 'esqueci', erro: null, ok: null, token: null, emailConfigurado: email.emailConfigurado() });
    });

    app.post('/esqueci-senha', limitarSenha, async (req, res) => {
        const tela = (extras) => res.render('senha', { modo: 'esqueci', erro: null, ok: null, token: null, emailConfigurado: email.emailConfigurado(), ...extras });
        const emailPedido = normalizarEmail(req.body.email);
        if (!emailValido(emailPedido)) return tela({ erro: 'Digite um e-mail válido.' });
        if (!email.emailConfigurado()) return tela({ erro: 'A recuperação por e-mail ainda não está disponível. Fale com o suporte para redefinir sua senha.' });

        const respostaPadrao = 'Se existir uma conta com esse e-mail, enviamos um link para criar uma nova senha. Confira também a caixa de spam.';
        try {
            const user = await buscarPorEmail(emailPedido);
            if (user && !user.bloqueado) {
                const token = crypto.randomBytes(32).toString('base64url');
                await prisma.usuario.update({ where: { id: user.id }, data: { resetToken: hashToken(token), resetExpires: new Date(Date.now() + VALIDADE_LINK_RESET) } });
                await email.enviarRedefinicao({ para: user.email, nome: user.nome, link: `${email.urlDoSite(req)}/redefinir-senha/${token}` });
            }
        } catch (e) {
            console.error('[ESQUECI SENHA] Falha ao enviar:', e.message);
            return tela({ erro: 'Não conseguimos enviar o e-mail agora. Tente de novo em alguns minutos ou fale com o suporte.' });
        }
        return tela({ ok: respostaPadrao });
    });

    const buscarPorToken = async (token) => {
        if (!token || String(token).length < 20) return null;
        return prisma.usuario.findFirst({ where: { resetToken: hashToken(token), resetExpires: { gt: new Date() } } });
    };

    app.get('/redefinir-senha/:token', async (req, res) => {
        const user = await buscarPorToken(req.params.token);
        res.render('senha', { modo: 'redefinir', token: user ? req.params.token : null, erro: user ? null : 'Este link expirou ou já foi usado. Peça um novo em "Esqueci minha senha".', ok: null, nome: user ? user.nome : '' });
    });

    app.post('/redefinir-senha/:token', limitarSenha, async (req, res) => {
        const user = await buscarPorToken(req.params.token);
        if (!user) return res.render('senha', { modo: 'redefinir', token: null, erro: 'Este link expirou ou já foi usado. Peça um novo em "Esqueci minha senha".', ok: null, nome: '' });
        const problema = validarSenha(req.body.senha, req.body.confirmar);
        if (problema) return res.render('senha', { modo: 'redefinir', token: req.params.token, erro: problema, ok: null, nome: user.nome });
        await prisma.usuario.update({
            where: { id: user.id },
            data: { senha: await bcrypt.hash(String(req.body.senha), 10), trocarSenha: false, resetToken: null, resetExpires: null, versaoSessao: { increment: 1 } }
        });
        return res.redirect('/login?aviso=senha-alterada');
    });

    // ---------- páginas do administrador ----------
    app.get('/admin', isAuth, soAdmin, (req, res) => res.redirect('/admin/usuarios'));
    app.get('/admin/usuarios', isAuth, soAdmin, async (req, res) => {
        const lista = await prisma.usuario.findMany({ orderBy: { criadoEm: 'desc' }, include: { clientes: { select: { id: true, nome: true, status: true, plataforma: true } } } });
        res.render('admin-usuarios', { usuarios: lista.map(paraLista), periodos: PERIODOS, planos: PLANOS_VALIDOS, emailConfigurado: email.emailConfigurado(), senhaProvisoria: SENHA_PROVISORIA });
    });

    app.get('/admin/usuarios/:id', isAuth, soAdmin, async (req, res) => {
        const u = await prisma.usuario.findUnique({ where: { id: String(req.params.id) }, include: { clientes: { select: { id: true, nome: true, status: true, plataforma: true } } } });
        if (!u) return res.redirect('/admin/usuarios');
        res.render('admin-usuario', { perfil: paraLista(u), euMesmo: u.id === req.session.userId, periodos: PERIODOS, planos: PLANOS_VALIDOS, emailConfigurado: email.emailConfigurado(), senhaProvisoria: SENHA_PROVISORIA, listaPermissoes: PERMISSOES, planosPadrao: PLANOS_PADRAO });
    });

    app.get('/admin/configuracoes', isAuth, soAdmin, (req, res) => {
        const c = email.configEmail();
        res.render('admin-config', {
            config: { host: c.host, porta: c.porta, seguro: c.seguro, usuario: c.usuario, temSenha: !!c.senha, nomeRemetente: c.nomeRemetente, emailRemetente: c.emailRemetente },
            siteUrl: email.lerConfig().siteUrl || `${req.protocol}://${req.get('host')}`,
            adminEmail: req.session.usuario.email,
            instagram: dadosInstagram(req), falta: req.query.falta === 'instagram'
        });
    });

    // App da Meta da plataforma (Instagram em um clique para todos os clientes)
    function dadosInstagram(req) {
        const ig = email.lerConfig().instagram || {};
        const base = String(process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
        return {
            appId: ig.appId || '', temSecret: !!ig.appSecret, verifyToken: ig.verifyToken || '',
            igAppId: ig.igAppId || '', temIgSecret: !!ig.igAppSecret,
            webhookUrl: `${base}/instagram/webhook`, callbackUrl: `${base}/instagram/auth/callback`,
            configurado: !!(ig.appId && ig.appSecret),
            loginInstagram: !!(ig.igAppId && ig.igAppSecret),
            liberado: ig.liberado === true
        };
    }

    // ---------- API do administrador ----------
    const A = '/api/admin/contas';
    const carregar = async (req, res) => {
        const u = await prisma.usuario.findUnique({ where: { id: String(req.params.id) } });
        if (!u) { res.status(404).json({ success: false, error: 'Usuário não encontrado.' }); return null; }
        return u;
    };
    const protegerAdmin = (req, res, u, acao) => {
        if (ehAdmin(u)) { res.status(400).json({ success: false, error: `Não é possível ${acao} uma conta de administrador.` }); return true; }
        return false;
    };

    app.get(`${A}/resumo`, isAuth, soAdmin, seguro(async (req, res) => {
        const lista = await prisma.usuario.findMany({ select: { id: true, email: true, role: true, ativo: true, bloqueado: true, expiraEm: true } });
        const r = { total: 0, pendente: 0, ativo: 0, vencendo: 0, vencido: 0, bloqueado: 0 };
        lista.forEach(u => {
            const s = statusDe(u).codigo; if (s === 'admin') return;
            r.total++;
            if (s === 'vitalicio') r.ativo++; else if (r[s] !== undefined) r[s]++;
            if (s === 'vencendo') r.ativo++;
        });
        res.json({ success: true, resumo: r });
    }));

    app.get(A, isAuth, soAdmin, seguro(async (req, res) => {
        const lista = await prisma.usuario.findMany({ orderBy: { criadoEm: 'desc' }, include: { clientes: { select: { id: true, nome: true, status: true, plataforma: true } } } });
        res.json({ success: true, usuarios: lista.map(paraLista) });
    }));

    app.post(A, isAuth, soAdmin, seguro(async (req, res) => {
        const nome = limpar(req.body.nome, 100);
        const emailNovo = normalizarEmail(req.body.email);
        const plano = PLANOS_VALIDOS.includes(req.body.plano) ? req.body.plano : 'ESSENTIAL';
        if (nome.length < 2) return res.status(400).json({ success: false, error: 'Digite o nome.' });
        if (!emailValido(emailNovo)) return res.status(400).json({ success: false, error: 'Digite um e-mail válido.' });
        if (await buscarPorEmail(emailNovo)) return res.status(400).json({ success: false, error: 'Já existe uma conta com esse e-mail.' });
        const validade = calcularValidade(null, req.body.periodo || '30', true);
        if (validade.erro) return res.status(400).json({ success: false, error: validade.erro });

        const novo = await prisma.usuario.create({
            data: {
                nome, email: emailNovo, plano, senha: await bcrypt.hash(SENHA_PROVISORIA, 10), trocarSenha: true,
                ativo: true, role: 'CLIENTE', expiraEm: validade.expiraEm, periodo: validade.periodo,
                termsAccepted: false
            }
        });

        let emailEnviado = false, avisoEmail = null;
        if (req.body.enviarEmail) {
            try {
                await email.enviarBoasVindas({ para: novo.email, nome: novo.nome, link: `${email.urlDoSite(req)}/login`, senhaProvisoria: SENHA_PROVISORIA });
                emailEnviado = true;
            } catch (e) { avisoEmail = 'A conta foi criada, mas o e-mail de boas-vindas não foi enviado: ' + e.message; }
        }
        res.json({ success: true, id: novo.id, emailEnviado, avisoEmail });
    }));

    app.put(`${A}/:id`, isAuth, soAdmin, seguro(async (req, res) => {
        const u = await carregar(req, res); if (!u) return;
        const nome = limpar(req.body.nome, 100);
        const emailNovo = normalizarEmail(req.body.email);
        if (nome.length < 2) return res.status(400).json({ success: false, error: 'Digite o nome.' });
        if (!emailValido(emailNovo)) return res.status(400).json({ success: false, error: 'Digite um e-mail válido.' });
        if (ehAdmin(u) && emailNovo !== normalizarEmail(u.email)) return res.status(400).json({ success: false, error: 'O e-mail do administrador não pode ser alterado por aqui.' });
        const outro = await buscarPorEmail(emailNovo);
        if (outro && outro.id !== u.id) return res.status(400).json({ success: false, error: 'Outra conta já usa esse e-mail.' });
        const plano = PLANOS_VALIDOS.includes(req.body.plano) ? req.body.plano : u.plano;
        await prisma.usuario.update({ where: { id: u.id }, data: { nome, email: emailNovo, plano } });
        res.json({ success: true });
    }));

    // Exceções ao plano. Para cada item: true (liberar), false (bloquear) ou null (seguir o plano).
    app.post(`${A}/:id/permissoes`, isAuth, soAdmin, seguro(async (req, res) => {
        const u = await carregar(req, res); if (!u) return;
        if (ehAdmin(u)) return res.status(400).json({ success: false, error: 'O administrador já tem acesso a tudo.' });
        const b = req.body || {};
        const exc = {};
        for (const p of PERMISSOES) {
            if (b[p.id] === true || b[p.id] === false) exc[p.id] = b[p.id];
        }
        if (b.maxBots !== null && b.maxBots !== undefined && b.maxBots !== '') {
            const n = Number(b.maxBots);
            if (!Number.isInteger(n) || n < 0 || n > 100) return res.status(400).json({ success: false, error: 'O limite de bots precisa ser um número de 0 a 100.' });
            exc.maxBots = n;
        }
        const plano = PLANOS_VALIDOS.includes(b.plano) ? b.plano : u.plano;
        await prisma.usuario.update({ where: { id: u.id }, data: { permissoes: Object.keys(exc).length ? exc : null, plano } });
        res.json({ success: true, permissoes: permissoesDe({ ...u, plano, permissoes: exc }) });
    }));

    app.post(`${A}/:id/aprovar`, isAuth, soAdmin, seguro(async (req, res) => {
        const u = await carregar(req, res); if (!u) return;
        const v = calcularValidade(null, req.body.periodo || '30', true);
        if (v.erro) return res.status(400).json({ success: false, error: v.erro });
        await prisma.usuario.update({ where: { id: u.id }, data: { ativo: true, bloqueado: false, expiraEm: v.expiraEm, periodo: v.periodo } });
        res.json({ success: true, expiraEm: v.expiraEm });
    }));

    app.post(`${A}/:id/bloqueio`, isAuth, soAdmin, seguro(async (req, res) => {
        const u = await carregar(req, res); if (!u) return;
        const bloquear = req.body.bloquear === true;
        if (bloquear && protegerAdmin(req, res, u, 'bloquear')) return;
        await prisma.usuario.update({ where: { id: u.id }, data: { bloqueado: bloquear, ...(bloquear ? { versaoSessao: { increment: 1 } } : {}) } });
        if (bloquear) await desligarBotsDe(u.id);
        res.json({ success: true, bloqueado: bloquear });
    }));

    app.post(`${A}/:id/validade`, isAuth, soAdmin, seguro(async (req, res) => {
        const u = await carregar(req, res); if (!u) return;
        let data;
        if (req.body.data) {
            const d = new Date(String(req.body.data) + 'T12:00:00');
            if (isNaN(d.getTime())) return res.status(400).json({ success: false, error: 'Data inválida.' });
            data = { expiraEm: fimDoDia(d), periodo: null };
        } else {
            const v = calcularValidade(u, req.body.periodo, req.body.aPartirDeHoje === true);
            if (v.erro) return res.status(400).json({ success: false, error: v.erro });
            data = v;
        }
        // Dar validade a uma conta pendente também a libera
        await prisma.usuario.update({ where: { id: u.id }, data: { expiraEm: data.expiraEm, periodo: data.periodo, ativo: true } });
        res.json({ success: true, expiraEm: data.expiraEm });
    }));

    app.post(`${A}/:id/senha`, isAuth, soAdmin, seguro(async (req, res) => {
        const u = await carregar(req, res); if (!u) return;
        const problema = validarSenha(req.body.senha);
        if (problema) return res.status(400).json({ success: false, error: problema });
        const exigirTroca = req.body.exigirTroca === true;
        await prisma.usuario.update({
            where: { id: u.id },
            data: { senha: await bcrypt.hash(String(req.body.senha), 10), trocarSenha: exigirTroca, resetToken: null, resetExpires: null, versaoSessao: { increment: 1 } }
        });
        if (u.id === req.session.userId) req.session.versaoSessao = (u.versaoSessao ?? 0) + 1;
        res.json({ success: true });
    }));

    app.post(`${A}/:id/exigir-troca`, isAuth, soAdmin, seguro(async (req, res) => {
        const u = await carregar(req, res); if (!u) return;
        if (u.id === req.session.userId) return res.status(400).json({ success: false, error: 'Para trocar a sua própria senha, use "Alterar minha senha".' });
        await prisma.usuario.update({
            where: { id: u.id },
            data: { senha: await bcrypt.hash(SENHA_PROVISORIA, 10), trocarSenha: true, resetToken: null, resetExpires: null, versaoSessao: { increment: 1 } }
        });
        res.json({ success: true });
    }));

    app.post(`${A}/:id/cancelar-troca`, isAuth, soAdmin, seguro(async (req, res) => {
        const u = await carregar(req, res); if (!u) return;
        await prisma.usuario.update({ where: { id: u.id }, data: { trocarSenha: false } });
        res.json({ success: true });
    }));

    app.post(`${A}/:id/enviar-link`, isAuth, soAdmin, seguro(async (req, res) => {
        const u = await carregar(req, res); if (!u) return;
        if (!email.emailConfigurado()) return res.status(400).json({ success: false, error: 'Configure o envio de e-mails em Configurações antes.' });
        const token = crypto.randomBytes(32).toString('base64url');
        await prisma.usuario.update({ where: { id: u.id }, data: { resetToken: hashToken(token), resetExpires: new Date(Date.now() + VALIDADE_LINK_RESET) } });
        try {
            await email.enviarRedefinicao({ para: u.email, nome: u.nome, link: `${email.urlDoSite(req)}/redefinir-senha/${token}` });
        } catch (e) {
            return res.status(502).json({ success: false, error: 'O e-mail não foi enviado: ' + e.message });
        }
        res.json({ success: true });
    }));

    app.delete(`${A}/:id`, isAuth, soAdmin, seguro(async (req, res) => {
        const u = await carregar(req, res); if (!u) return;
        if (protegerAdmin(req, res, u, 'excluir')) return;
        const bots = await prisma.cliente.findMany({ where: { donoId: u.id }, select: { id: true } });
        for (const b of bots) {
            if (whatsapp && whatsapp.sessoes.has(b.id)) {
                try { whatsapp.sessoes.get(b.id).end(undefined); } catch (e) {}
                whatsapp.sessoes.delete(b.id);
            }
        }
        const ids = bots.map(b => b.id);
        await prisma.$transaction([
            prisma.contratoTemplate.deleteMany({ where: { clienteId: { in: ids } } }),
            prisma.cliente.deleteMany({ where: { donoId: u.id } }),
            prisma.usuario.delete({ where: { id: u.id } })
        ]);
        res.json({ success: true });
    }));

    // ---------- configuração do e-mail ----------
    app.post('/api/admin/config-email', isAuth, soAdmin, seguro(async (req, res) => {
        const b = req.body || {};
        const atual = email.configEmail();
        const host = limpar(b.host, 120);
        const usuarioSmtp = limpar(b.usuario, 150);
        const emailRemetente = normalizarEmail(b.emailRemetente || usuarioSmtp);
        if (!host || !usuarioSmtp) return res.status(400).json({ success: false, error: 'Preencha o servidor e o usuário do e-mail.' });
        if (emailRemetente && !emailValido(emailRemetente)) return res.status(400).json({ success: false, error: 'O e-mail do remetente não é válido.' });
        let siteUrl = String(b.siteUrl || '').trim().replace(/\/+$/, '');
        if (siteUrl && !/^https?:\/\/[^\s/]+/.test(siteUrl)) return res.status(400).json({ success: false, error: 'O endereço do site precisa começar com http:// ou https://' });
        const senhaNova = typeof b.senha === 'string' && b.senha.trim() ? b.senha.trim() : atual.senha;
        if (!senhaNova) return res.status(400).json({ success: false, error: 'Digite a senha do e-mail (no Gmail, a senha de app).' });
        email.salvarConfig({
            email: {
                host, porta: Number(b.porta) || 465, seguro: b.seguro !== false, usuario: usuarioSmtp, senha: senhaNova,
                nomeRemetente: limpar(b.nomeRemetente, 80) || 'Calixto OmniSystem', emailRemetente
            },
            siteUrl
        });
        res.json({ success: true });
    }));

    // ---------- configuração do app da Meta (Instagram) ----------
    app.post('/api/admin/config-instagram', isAuth, soAdmin, seguro(async (req, res) => {
        const b = req.body || {};
        const atual = email.lerConfig().instagram || {};
        const appId = String(b.appId || '').trim();
        if (!/^\d{6,25}$/.test(appId)) return res.status(400).json({ success: false, error: 'O App ID tem só números (veja em Configurações > Básico no app da Meta).' });
        const segredoNovo = typeof b.appSecret === 'string' ? b.appSecret.trim() : '';
        if (segredoNovo && !/^[a-f0-9]{32}$/i.test(segredoNovo)) return res.status(400).json({ success: false, error: 'O App Secret tem 32 letras e números. Copie de novo do painel da Meta.' });
        const appSecret = segredoNovo || atual.appSecret;
        if (!appSecret) return res.status(400).json({ success: false, error: 'Cole o App Secret do aplicativo.' });
        // Login do Instagram (opcional, recomendado): ID e chave do "Instagram" dentro do mesmo app
        const igAppId = String(b.igAppId || '').trim();
        let igAppSecret = '';
        if (igAppId) {
            if (!/^\d{6,25}$/.test(igAppId)) return res.status(400).json({ success: false, error: 'O ID do app do Instagram tem só números (veja em Instagram > Configuração da API com login do Instagram).' });
            const igNovo = typeof b.igAppSecret === 'string' ? b.igAppSecret.trim() : '';
            if (igNovo && !/^[a-f0-9]{32}$/i.test(igNovo)) return res.status(400).json({ success: false, error: 'A chave secreta do app do Instagram tem 32 letras e números. Copie de novo do painel da Meta.' });
            igAppSecret = igNovo || (atual.igAppId ? atual.igAppSecret : '') || '';
            if (!igAppSecret) return res.status(400).json({ success: false, error: 'Cole a chave secreta do app do Instagram.' });
        }
        const verifyToken = (b.novoToken || !atual.verifyToken) ? crypto.randomBytes(24).toString('hex') : atual.verifyToken;
        email.salvarConfig({ instagram: { appId, appSecret, verifyToken, igAppId, igAppSecret, liberado: atual.liberado === true } });
        res.json({ success: true, verifyToken, tokenNovo: verifyToken !== atual.verifyToken });
    }));

    // Mostrar ou ocultar o Instagram para os clientes (o admin sempre vê)
    app.post('/api/admin/config-instagram/liberar', isAuth, soAdmin, seguro(async (req, res) => {
        const atual = email.lerConfig().instagram || {};
        const liberado = req.body && req.body.liberado === true;
        email.salvarConfig({ instagram: { ...atual, liberado } });
        res.json({ success: true, liberado });
    }));

    app.post('/api/admin/config-email/teste', isAuth, soAdmin, seguro(async (req, res) => {
        const para = normalizarEmail(req.body.para || req.session.usuario.email);
        if (!emailValido(para)) return res.status(400).json({ success: false, error: 'Digite um e-mail válido para o teste.' });
        try { await email.enviarTeste({ para }); }
        catch (e) { return res.status(502).json({ success: false, error: 'Falhou: ' + e.message }); }
        res.json({ success: true, para });
    }));
}

function init(deps) {
    prisma = deps.prisma; io = deps.io; whatsapp = deps.whatsapp;
    setInterval(desligarBotsVencidos, 15 * 60 * 1000).unref();
}

module.exports = {
    init, registrarRotas, isAuth, soAdmin, ehAdmin, statusDe,
    permissoesDe, exigirPermissao, PERMISSOES, PLANOS_PADRAO,
    telaLogin, fazerLogin, telaCadastro, fazerCadastro,
    desligarBotsVencidos, calcularValidade, validarSenha,
    SENHA_PROVISORIA, PERIODOS
};
