// ============================================================
// ARQUIVO: index.js (V19.1 - CONTRACT SYSTEM FINAL)
// ============================================================

const PLANOS = {
    'ESSENTIAL': { maxBots: 1, permissoes: { midia: false, transferencia: false, agendamento: false, audioIA: false, contratos: false } },
    'ADVANCED': { maxBots: 3, permissoes: { midia: true, transferencia: true, agendamento: true, audioIA: false, contratos: false } },
    'SIGNATURE': { maxBots: 10, permissoes: { midia: true, transferencia: true, agendamento: true, audioIA: true, contratos: true } }
};

require('dotenv').config();
const rateLimit = require('express-rate-limit');
const helmet = require('helmet'); 
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs'); 
const multer = require('multer'); 
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs'); 
const session = require('express-session'); 
const flash = require('connect-flash'); 

const whatsapp = require('./modulos/whatsapp');
const timeout = require('./modulos/timeout');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// ...

// --- SEGURANÇA 1: HELMET (Esconde que é Express) ---
// contentSecurityPolicy: false é necessário para não bloquear os scripts do Quill/CDN que usamos
app.use(helmet({ contentSecurityPolicy: false })); 

// --- SEGURANÇA 2: RATE LIMIT (Anti-Força Bruta) ---
// Limita cada IP a 100 requisições a cada 15 minutos
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 300, // Limite generoso para uso normal
    message: "Muitas requisições deste IP, tente novamente mais tarde."
});
app.use(limiter);

// Se quiser ser MAIS rígido apenas no Login (Recomendado):
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10, // Só 10 tentativas de login por 15 min
    message: "Muitas tentativas de login. Bloqueado por 15 min."
});
// Aplique na rota POST /login lá embaixo: app.post('/login', loginLimiter, async ...

// ==========================================
// FUNÇÃO DE SEGURANÇA (ANTI-HACKER) 🛡️
// ==========================================
function limparTexto(texto) {
    if (!texto) return "";
    
    // 1. Limita o tamanho (evita travamento do servidor)
    // Ninguém tem um nome com mais de 100 letras.
    let textoSeguro = texto.substring(0, 100);

    // 2. Remove tags HTML/Scripts (Anti-XSS)
    // Substitui < e > por nada.
    textoSeguro = textoSeguro.replace(/</g, "").replace(/>/g, "");

    // 3. (Opcional) Remove caracteres especiais perigosos, mantendo apenas texto e números
    // Isso é radical, mas ultra seguro.
    // textoSeguro = textoSeguro.replace(/[^a-zA-Z0-9 áàhwâãéèêíïóôõöúçñÁÀÂÃÉÈÍÏÓÔÕÖÚÇÑ]/g, "");

    return textoSeguro;
}

// --- SISTEMA DE CONFIGURAÇÃO (MANUTENÇÃO) ---
const CONFIG_FILE = path.join(__dirname, 'system_config.json');

if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ maintenance: false }));
}

function getSystemConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE)); } catch (e) { return { maintenance: false }; }
}

function setSystemConfig(newConfig) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig));
}

// --- CONFIGURAÇÕES DO EXPRESS ---
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- CONFIGURAÇÃO DE SESSÃO BLINDADA ---
app.use(session({
    secret: 'segredo_calixto_v19_contracts', 
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000, // 24 horas
        httpOnly: true, // O JavaScript do navegador não consegue ler o cookie (Anti-XSS)
        sameSite: 'lax', // Protege contra CSRF (Links maliciosos de outros sites)
        secure: process.env.NODE_ENV === 'production' // Se estiver na VPS com HTTPS, vira true automaticamente
    } 
}));
app.use(flash());

// --- MIDDLEWARE DE MANUTENÇÃO ---
app.use((req, res, next) => {
    const config = getSystemConfig();
    if (!config.maintenance) return next();
    if (req.path.startsWith('/login') || req.path.startsWith('/uploads') || req.path === '/api/login' || req.path === '/registro' || req.path === '/logout' || req.path === '/termos' || req.path === '/privacidade') { 
        return next();
    }
    if (req.session.usuario && req.session.role === 'ADMIN') {
        res.locals.maintenanceMode = true; 
        return next();
    }
    return res.render('manutencao');
});

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
async function isAuth(req, res, next) {
    if (req.session.usuario) {
        try {
            const user = await prisma.usuario.findUnique({ where: { id: req.session.userId } });
            if (!user || user.bloqueado || !user.ativo) {
                req.session.destroy();
                return res.redirect('/login');
            }
            if (user.role !== 'ADMIN' && user.expiraEm && new Date() > new Date(user.expiraEm)) {
                req.session.destroy();
                return res.render('login', { message: null, erro: 'Plano expirado.' });
            }
            req.session.usuario = user; 
            return next();
        } catch (e) { return res.redirect('/login'); }
    }
    res.redirect('/login');
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'public/uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, "_"))
});

// --- SEGURANÇA 3: FILTRO DE UPLOAD ---
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Limite de 5MB por arquivo
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'image/jpeg', 'image/png', 'image/webp', // Imagens
            'audio/mpeg', 'audio/ogg', 'audio/mp4',  // Áudios
            'application/pdf'                        // PDFs
        ];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de arquivo não permitido (Apenas Imagens, Áudio e PDF).'));
        }
    }
});

// ================= ROTAS =================

app.get('/', (req, res) => { res.render('landing', { usuario: req.session.usuario || null }); });
app.get('/login', (req, res) => { if (req.session.usuario) return res.redirect('/dashboard'); res.render('login', { message: req.flash('error'), erro: null }); });

app.post('/login', loginLimiter, async (req, res) => {
    const email = req.body.email?.trim();
    const senha = req.body.senha?.trim();
    try {
        const user = await prisma.usuario.findUnique({ where: { email } });
        if (!user || !bcrypt.compareSync(senha, user.senha)) return res.render('login', { message: 'Credenciais inválidas.', erro: null });
        if (user.bloqueado) return res.render('login', { message: null, erro: 'Conta bloqueada.' });
        if (user.role !== 'ADMIN' && !user.ativo) return res.render('login', { message: null, erro: 'Aguarde aprovação.' });
        if (user.role !== 'ADMIN' && user.expiraEm && new Date() > new Date(user.expiraEm)) return res.render('login', { message: null, erro: 'Assinatura expirada.' });

        req.session.usuario = user; 
        req.session.userId = user.id; 
        req.session.role = user.role;
        res.redirect('/dashboard');
    } catch (e) { res.render('login', { message: 'Erro servidor.', erro: null }); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/registro', (req, res) => { res.render('registro', { message: req.flash('error') }); });

app.post('/registro', async (req, res) => {
    try {
        const { nome, email, senha, termos } = req.body;
        if (!termos) return res.render('registro', { message: 'Erro: Você precisa aceitar os Termos de Uso.' });
        const userExists = await prisma.usuario.findUnique({ where: { email } });
        if (userExists) return res.render('registro', { message: 'E-mail já cadastrado.' });
        const ipCliente = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const hashedPassword = await bcrypt.hash(senha, 10);
        await prisma.usuario.create({
            data: { nome, email, senha: hashedPassword, termsAccepted: true, termsAcceptedAt: new Date(), signupIp: String(ipCliente), plano: 'ESSENTIAL', ativo: false }
        });
        res.redirect('/login');
    } catch (error) { res.render('registro', { message: 'Erro interno ao criar conta.' }); }
});

app.get('/dashboard', isAuth, async (req, res) => {
    try {
        let clientes;
        if (req.session.role === 'ADMIN') {
            clientes = await prisma.cliente.findMany({ orderBy: { criadoEm: 'desc' }, include: { dono: true } });
        } else {
            clientes = await prisma.cliente.findMany({ where: { donoId: req.session.userId }, orderBy: { criadoEm: 'desc' } });
        }
        const sysConfig = getSystemConfig();
        const userFresh = await prisma.usuario.findUnique({ where: { id: req.session.userId } });
        const permissoes = PLANOS[userFresh.plano]?.permissoes || PLANOS['ESSENTIAL'].permissoes;
        res.render('dashboard', { 
            clientes: clientes.map(c => ({ ...c, status: c.status || 'OFFLINE' })), 
            usuario: userFresh, permissoes, systemMaintenance: sysConfig.maintenance 
        });
    } catch (error) { res.status(500).send("Erro dashboard"); }
});

// ================= API DE CONTRATOS (V19.1) =================

// 1. Rota para o EDITOR preencher o dropdown
app.get('/api/clientes/:id/contratos', isAuth, async (req, res) => {
    try {
        const clienteId = req.params.id;
        
        // Verifica se o usuário é dono deste cliente
        const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
        if (!cliente || (cliente.donoId !== req.session.userId && req.session.role !== 'ADMIN')) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const contratos = await prisma.contratoTemplate.findMany({
            where: { clienteId: clienteId },
            select: { id: true, nome: true }, // Só precisamos disso para o Select
            orderBy: { criadoEm: 'desc' }
        });
        
        res.json(contratos);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Erro ao buscar contratos' });
    }
});

// 2. Rota para a VIEW do Dashboard (Gerenciador de Contratos)
app.get('/dashboard/contratos', isAuth, async (req, res) => {
    try {
        const user = await prisma.usuario.findUnique({ where: { id: req.session.userId }, include: { clientes: true } });
        const permissoes = PLANOS[user.plano]?.permissoes || PLANOS['ESSENTIAL'].permissoes;

        // Se o plano não permite contratos, chuta de volta
        if (!permissoes.contratos && user.role !== 'ADMIN') {
            return res.redirect('/dashboard');
        }

        // Busca todos os contratos de todos os clientes deste usuário
        const contratos = await prisma.contratoTemplate.findMany({
            where: { cliente: { donoId: user.id } },
            include: { cliente: true },
            orderBy: { criadoEm: 'desc' }
        });

        res.render('contratos', { usuario: user, contratos, clientes: user.clientes });
    } catch (e) {
        console.error(e);
        res.status(500).send("Erro ao carregar contratos");
    }
});

// 3. Rota para CRIAR um novo contrato (POST)
app.post('/api/contratos', isAuth, async (req, res) => {
    try {
        const { nome, conteudo, clienteId } = req.body;
        
        // Validação de segurança
        const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
        if (!cliente || (cliente.donoId !== req.session.userId && req.session.role !== 'ADMIN')) {
            return res.status(403).json({ error: 'Acesso negado a este cliente' });
        }

        await prisma.contratoTemplate.create({
            data: { nome, conteudo, clienteId }
        });

        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Erro ao salvar contrato' });
    }
});

// 4. Rota para ATUALIZAR um contrato (PUT) - *** ADICIONADO AQUI ***
app.put('/api/contratos/:id', isAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, conteudo, clienteId } = req.body;

        // Validação de segurança extra (para garantir que o usuário é dono do contrato)
        const contrato = await prisma.contratoTemplate.findUnique({ where: { id }, include: { cliente: true } });
        if (!contrato || (contrato.cliente.donoId !== req.session.userId && req.session.role !== 'ADMIN')) {
             return res.status(403).json({ error: 'Acesso negado' });
        }

        await prisma.contratoTemplate.update({
            where: { id: id },
            data: {
                nome,
                conteudo,
                clienteId
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Erro ao atualizar contrato:", error);
        res.status(500).json({ success: false });
    }
});

// 5. Rota para DELETAR um contrato
app.delete('/api/contratos/:id', isAuth, async (req, res) => {
    try {
        const contrato = await prisma.contratoTemplate.findUnique({ 
            where: { id: req.params.id },
            include: { cliente: true }
        });

        if (!contrato || (contrato.cliente.donoId !== req.session.userId && req.session.role !== 'ADMIN')) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        await prisma.contratoTemplate.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao excluir' });
    }
});


// ================= API CLIENTES (BLINDADA) =================

app.post('/api/clientes', isAuth, async (req, res) => {
    try {
        const user = await prisma.usuario.findUnique({ where: { id: req.session.userId }, include: { clientes: true } });
        const regras = PLANOS[user.plano] || PLANOS['ESSENTIAL'];
        if (user.role !== 'ADMIN' && user.clientes.length >= regras.maxBots) return res.status(403).json({ error: 'Limite de bots atingido.' });
        const novoBot = await prisma.cliente.create({ data: { nome: req.body.nome, numero: req.body.numero, donoId: req.session.userId, status: 'OFFLINE' } });
        res.json({ success: true, id: novoBot.id });
    } catch (e) { res.status(500).json({ error: "Erro criar" }); }
});

// --- EXCLUSÃO BLINDADA: Mata a sessão antes de apagar a pasta ---
app.delete('/api/clientes/:id', isAuth, async (req, res) => {
    try {
        const botId = req.params.id;
        
        // 1. Mata a conexão na memória RAM
        if (whatsapp.sessoes && whatsapp.sessoes.has(botId)) {
            const sessao = whatsapp.sessoes.get(botId);
            try { sessao.end(undefined); } catch (e) {}
            whatsapp.sessoes.delete(botId);
        }

        // 2. Aguarda o Windows soltar os arquivos
        await new Promise(r => setTimeout(r, 1000));

        // 3. Tenta apagar a pasta de arquivos físico
        const paths = [
            path.join(__dirname, 'public', 'sessions', botId),
            path.join(__dirname, 'sessions', botId)
        ];

        paths.forEach(p => {
            if (fs.existsSync(p)) {
                try { fs.rmSync(p, { recursive: true, force: true }); } catch (err) { console.error("Erro ao apagar pasta:", err.message); }
            }
        });

        // 4. Apaga do Banco
        await prisma.contratoTemplate.deleteMany({ where: { clienteId: botId } }); // Limpa contratos antes
        await prisma.cliente.delete({ where: { id: botId } });
        
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro ao excluir" }); }
});

app.post('/api/status', isAuth, async (req, res) => {
    try {
        const { clienteId, status } = req.body;
        await prisma.cliente.update({ where: { id: clienteId }, data: { status: status } });
        io.emit('status', { clienteId, status });
        if (status === 'ONLINE') {
            const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
            whatsapp.iniciarWhatsApp(cliente, io);
        } else {
            const sessao = whatsapp.sessoes.get(clienteId);
            if(sessao) { try { sessao.end(undefined); } catch(e){} whatsapp.sessoes.delete(clienteId); }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({}); }
});

app.get('/editor/:id', isAuth, async (req, res) => {
    const cliente = await prisma.cliente.findUnique({ where: { id: req.params.id } });
    if (!cliente || (cliente.donoId !== req.session.userId && req.session.role !== 'ADMIN')) return res.redirect('/dashboard');
    res.render('editor', { cliente, fluxo: cliente.fluxoJson });
});

app.post('/api/clientes/:id/fluxo', isAuth, async (req, res) => {
    await prisma.cliente.update({ where: { id: req.params.id }, data: { fluxoJson: req.body.fluxo } });
    res.json({ success: true });
});

app.post('/upload', isAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Sem arquivo' });
    res.json({ url: `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}` });
});

// --- ADMIN API ---
app.post('/api/admin/maintenance', isAuth, (req, res) => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({});
    const currentConfig = getSystemConfig();
    const newState = !currentConfig.maintenance;
    setSystemConfig({ maintenance: newState });
    res.json({ success: true, maintenance: newState });
});

app.get('/api/admin/usuarios', isAuth, async (req, res) => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({});
    const usuarios = await prisma.usuario.findMany({ 
        orderBy: { criadoEm: 'desc' }, 
        select: { id: true, nome: true, email: true, plano: true, ativo: true, bloqueado: true, expiraEm: true, termsAccepted: true, termsAcceptedAt: true, signupIp: true, clientes: { select: { nome: true, status: true } } } 
    });
    res.json(usuarios);
});

app.post('/api/admin/aprovar', isAuth, async (req, res) => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({});
    await prisma.usuario.update({ where: { id: req.body.idUsuario }, data: { ativo: true } });
    res.json({ status: 'ok' });
});

app.post('/api/admin/usuarios/bloqueio', isAuth, async (req, res) => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({});
    await prisma.usuario.update({ where: { id: req.body.idUsuario }, data: { bloqueado: req.body.bloquear } });
    res.json({ success: true });
});

app.post('/api/admin/usuarios/definir-data', isAuth, async (req, res) => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({});
    const dataAjustada = new Date(req.body.novaData); dataAjustada.setHours(23, 59, 59);
    await prisma.usuario.update({ where: { id: req.body.idUsuario }, data: { expiraEm: dataAjustada, bloqueado: false } });
    res.json({ success: true });
});

app.post('/api/admin/usuarios/renovar', isAuth, async (req, res) => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({});
    const { idUsuario, diasAdicionais, vitalicio } = req.body;
    let novaData = null;
    if (!vitalicio) {
        const user = await prisma.usuario.findUnique({ where: { id: idUsuario } });
        const baseData = (user.expiraEm && new Date(user.expiraEm) > new Date()) ? new Date(user.expiraEm) : new Date();
        baseData.setDate(baseData.getDate() + diasAdicionais);
        novaData = baseData;
    }
    await prisma.usuario.update({ where: { id: idUsuario }, data: { expiraEm: novaData, bloqueado: false } });
    res.json({ success: true });
});

app.delete('/api/admin/usuarios/:id', isAuth, async (req, res) => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({});
    try {
        const idUsuario = req.params.id;
        const bots = await prisma.cliente.findMany({ where: { donoId: idUsuario } });
        for (const bot of bots) {
             if(whatsapp.sessoes.has(bot.id)) { try { whatsapp.sessoes.get(bot.id).end(undefined); } catch(e){} }
        }
        await prisma.cliente.deleteMany({ where: { donoId: idUsuario } });
        await prisma.usuario.delete({ where: { id: idUsuario } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro excluir" }); }
});

app.get('/termos', (req, res) => res.render('termos', { usuario: req.session.usuario || null }));
app.get('/privacidade', (req, res) => res.render('privacidade', { usuario: req.session.usuario || null }));

server.listen(PORT, async () => {
    console.log(`🚀 CALIXTO OMNISYSTEM V19.1 ONLINE NA PORTA ${PORT}`);
    timeout.iniciar(); 
    try {
        const clientesParaIniciar = await prisma.cliente.findMany({ where: { status: 'ONLINE' } });
        for (const cliente of clientesParaIniciar) {
            const dono = await prisma.usuario.findUnique({ where: { id: cliente.donoId } });
            if (dono && dono.ativo && !dono.bloqueado) {
                if (dono.role !== 'ADMIN' && dono.expiraEm && new Date() > new Date(dono.expiraEm)) continue;
                whatsapp.iniciarWhatsApp(cliente, io);
                await new Promise(r => setTimeout(r, 2000)); 
            } else {
                await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'OFFLINE' } });
            }
        }
    } catch (e) { console.error('[BOOT] Erro:', e); }
});