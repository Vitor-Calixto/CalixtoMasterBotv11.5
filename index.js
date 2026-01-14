// ============================================================
// ARQUIVO: index.js (V14.3 - CRIAÇÃO OFFLINE)
// ============================================================

// 1. REGRAS DOS PLANOS
const PLANOS = {
    'ESSENTIAL': { 
        maxBots: 1, 
        permissoes: { midia: false, transferencia: false, agendamento: false, audioIA: false, contratos: false }
    },
    'ADVANCED': { 
        maxBots: 3, 
        permissoes: { midia: true, transferencia: true, agendamento: true, audioIA: false, contratos: false }
    },
    'SIGNATURE': { 
        maxBots: 10, 
        permissoes: { midia: true, transferencia: true, agendamento: true, audioIA: true, contratos: true }
    }
};

require('dotenv').config();
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

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: 'segredo_calixto_v14', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } 
}));
app.use(flash());

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

function isAuth(req, res, next) {
    if (req.session.usuario) return next(); 
    res.redirect('/login'); 
}

// --- ROTAS PÚBLICAS ---
app.get('/', (req, res) => { if (req.session.usuario) return res.redirect('/dashboard'); res.render('landing'); });
app.get('/login', (req, res) => { if (req.session.usuario) return res.redirect('/dashboard'); res.render('login', { message: req.flash('error'), erro: null }); });

app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const user = await prisma.usuario.findUnique({ where: { email } });
        if (!user || !bcrypt.compareSync(senha, user.senha)) return res.render('login', { message: 'Dados inválidos.', erro: null });
        if (user.role !== 'ADMIN' && user.ativo === false) return res.render('login', { message: null, erro: 'Conta em análise.' });
        req.session.usuario = user; req.session.userId = user.id; req.session.role = user.role;
        res.redirect('/dashboard');
    } catch (e) { res.render('login', { message: 'Erro interno.', erro: null }); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.get('/registro', (req, res) => { res.render('registro', { message: req.flash('error') }); });

app.post('/registro', async (req, res) => {
    const { nome, email, senha } = req.body;
    try {
        const existe = await prisma.usuario.findUnique({ where: { email } });
        if (existe) { req.flash('error', 'E-mail já em uso.'); return res.redirect('/registro'); }
        const hash = bcrypt.hashSync(senha, 10);
        const totalUsers = await prisma.usuario.count();
        const role = totalUsers === 0 ? 'ADMIN' : 'CLIENTE';
        const novoUsuario = await prisma.usuario.create({ data: { nome, email, senha: hash, role, ativo: role === 'ADMIN', plano: 'ESSENTIAL' } });
        if (novoUsuario.ativo) { req.session.usuario = novoUsuario; req.session.userId = novoUsuario.id; req.session.role = novoUsuario.role; res.redirect('/dashboard'); } 
        else { res.render('login', { message: null, erro: 'Conta criada! Aguarde liberação.' }); }
    } catch (e) { req.flash('error', 'Erro ao criar conta.'); res.redirect('/registro'); }
});

// --- DASHBOARD ---
app.get('/dashboard', isAuth, async (req, res) => {
    try {
        let clientes;
        if (req.session.role === 'ADMIN') clientes = await prisma.cliente.findMany({ orderBy: { criadoEm: 'desc' }, include: { dono: true } });
        else clientes = await prisma.cliente.findMany({ where: { donoId: req.session.userId }, orderBy: { criadoEm: 'desc' } });
        
        const clientesComStatus = clientes.map(c => ({ ...c, status: c.status || 'OFFLINE' }));
        const userFresh = await prisma.usuario.findUnique({ where: { id: req.session.userId } });
        req.session.usuario = userFresh;
        res.render('dashboard', { clientes: clientesComStatus, usuario: req.session.usuario });
    } catch (error) { res.status(500).send("Erro no dashboard"); }
});

// --- API: CLIENTES (MODIFICADO: CRIA OFFLINE) ---
app.post('/api/clientes', isAuth, async (req, res) => {
    try {
        const user = await prisma.usuario.findUnique({ where: { id: req.session.userId }, include: { clientes: true } });
        const regras = PLANOS[user.plano] || PLANOS['ESSENTIAL'];
        if (user.role !== 'ADMIN' && user.clientes.length >= regras.maxBots) return res.status(403).json({ error: `Limite do plano atingido.` });

        // CRIA COMO OFFLINE (O BOT NÃO INICIA AINDA)
        await prisma.cliente.create({ 
            data: { 
                nome: req.body.nome, 
                numero: req.body.numero, 
                donoId: req.session.userId, 
                status: 'OFFLINE' 
            } 
        });
        
        // NÃO CHAMAMOS O WHATSAPP AQUI. 
        // O USUÁRIO DEVE LIGAR NO DASHBOARD PARA INICIAR.
        
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro ao criar" }); }
});

app.put('/api/clientes/:id', isAuth, async (req, res) => {
    try {
        const cliente = await prisma.cliente.findUnique({ where: { id: req.params.id } });
        if (!cliente) return res.status(404).json({});
        if (req.session.role !== 'ADMIN' && cliente.donoId !== req.session.userId) return res.status(403).json({});
        await prisma.cliente.update({ where: { id: req.params.id }, data: { nome: req.body.nome, numero: req.body.numero } });
        res.json({ status: 'ok' });
    } catch (e) { res.status(500).json({}); }
});

// --- EXCLUSÃO ---
app.delete('/api/clientes/:id', isAuth, async (req, res) => {
    try {
        const cliente = await prisma.cliente.findUnique({ where: { id: req.params.id } });
        if (!cliente) return res.status(404).json({ error: 'Não encontrado' });
        if (req.session.role !== 'ADMIN' && cliente.donoId !== req.session.userId) return res.status(403).json({});

        const session = whatsapp.sessoes.get(req.params.id);
        if(session) { 
            try { session.end(undefined); } catch(e){} 
            whatsapp.sessoes.delete(req.params.id); 
        }
        
        const sessionName = `${cliente.nome}-${cliente.id}`;
        const sessionPath = path.join(__dirname, 'sessions', sessionName);
        
        if (fs.existsSync(sessionPath)) {
            try {
                fs.rmSync(sessionPath, { recursive: true, force: true });
                console.log(`[SISTEMA] 🗑️ Pasta da sessão apagada: ${sessionName}`);
            } catch (err) { console.error(`[ERRO] Falha ao apagar pasta: ${err.message}`); }
        }

        await prisma.cliente.delete({ where: { id: req.params.id } });
        res.json({ success: true });

    } catch (e) { console.error(e); res.status(500).json({ error: "Erro ao excluir" }); }
});

// --- STATUS (LIGA/DESLIGA O BOT) ---
app.post('/api/status', isAuth, async (req, res) => {
    try {
        const { clienteId, status } = req.body;
        const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
        if (!cliente) return res.status(404).json({});
        if (req.session.role !== 'ADMIN' && cliente.donoId !== req.session.userId) return res.status(403).json({});

        await prisma.cliente.update({ where: { id: clienteId }, data: { status: status } });
        console.log(`[SISTEMA] 🔄 Status ${cliente.nome}: ${status}`);
        io.emit('status', { clienteId, status });

        // SE O USUÁRIO LIGOU ('ONLINE'), INICIAMOS O WHATSAPP SE ELE NÃO ESTIVER RODANDO
        const session = whatsapp.sessoes.get(clienteId);
        if (status === 'ONLINE') {
            // Se não tem sessão ativa, inicia do zero
            if (!session) {
                const clienteAtualizado = await prisma.cliente.findUnique({ where: { id: clienteId } });
                whatsapp.iniciarWhatsApp(clienteAtualizado, io);
            }
            // Se já tem sessão, o engine.js apenas libera o tráfego (Mute desligado)
        }
        
        res.json({ success: true });
    } catch (e) { res.status(500).json({}); }
});

// --- EDITOR & UPLOAD ---
app.get('/editor/:id', isAuth, async (req, res) => {
    const cliente = await prisma.cliente.findUnique({ where: { id: req.params.id } });
    res.render('editor', { cliente, fluxo: cliente.fluxoJson });
});
app.post('/api/clientes/:id/fluxo', isAuth, async (req, res) => {
    await prisma.cliente.update({ where: { id: req.params.id }, data: { fluxoJson: req.body.fluxo } });
    res.json({ success: true });
});
app.post('/upload', isAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({});
    res.json({ url: `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}` });
});

// --- ADMIN ROUTES ---
app.get('/api/admin/usuarios', isAuth, async (req, res) => {
    if (req.session.usuario.email !== 'vitorpedrocalixto@gmail.com') return res.status(403).json({});
    const usuarios = await prisma.usuario.findMany({ orderBy: { criadoEm: 'desc' }, select: { id: true, nome: true, email: true, plano: true, ativo: true, clientes: { select: { nome: true, status: true } } } });
    res.json(usuarios);
});
app.put('/api/admin/mudar-plano', isAuth, async (req, res) => {
    if (req.session.usuario.email !== 'vitorpedrocalixto@gmail.com') return res.status(403).json({});
    await prisma.usuario.update({ where: { id: req.body.idUsuario }, data: { plano: req.body.novoPlano } });
    res.json({ success: true });
});
app.post('/api/admin/aprovar', isAuth, async (req, res) => {
    if (req.session.usuario.email !== 'vitorpedrocalixto@gmail.com') return res.status(403).json({});
    await prisma.usuario.update({ where: { id: req.body.idUsuario }, data: { ativo: true } });
    res.json({ status: 'ok' });
});

// INICIALIZAÇÃO (CARREGA APENAS BOTS QUE JÁ ESTAVAM ONLINE)
// ============================================================
// FINAL DO ARQUIVO index.js (V14.4 - FORÇA OFFLINE NO BOOT)
// ============================================================

server.listen(PORT, async () => {
    console.log(`🚀 CALIXTO SYSTEM V14 ONLINE NA PORTA ${PORT}`);

    // --- MODO DE SEGURANÇA MÁXIMA ---
    // 1. Apaga qualquer status "ONLINE" mentiroso do banco de dados.
    // Assim, quando o sistema iniciar, TODOS os bots estarão OFFLINE.
    try {
        await prisma.cliente.updateMany({
            data: { status: 'OFFLINE' }
        });
        console.log('[BOOT] 🛡️ Todos os bots foram resetados para OFFLINE. Aguardando comando manual.');
    } catch (e) {
        console.error('[BOOT] Erro ao resetar status:', e);
    }

    // 2. (Opcional) Se quiser apagar as pastas de sessão automaticamente ao iniciar, descomente abaixo:
    // const sessionsDir = path.join(__dirname, 'sessions');
    // if (fs.existsSync(sessionsDir)) {
    //     fs.rmSync(sessionsDir, { recursive: true, force: true });
    //     console.log('[BOOT] 🧹 Pasta de sessões limpa.');
    // }
});