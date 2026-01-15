// ============================================================
// ARQUIVO: index.js (V16.0 - FINAL CLEAN)
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

// --- MÓDULOS INTERNOS ---
const whatsapp = require('./modulos/whatsapp');
const timeout = require('./modulos/timeout');

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
    secret: 'segredo_calixto_v16_final', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } 
}));
app.use(flash());

// --- MIDDLEWARE DE AUTENTICAÇÃO E CONTROLE SAAS ---
async function isAuth(req, res, next) {
    if (!req.session.usuario) return res.redirect('/login');

    try {
        const user = await prisma.usuario.findUnique({ where: { id: req.session.userId } });

        if (!user) {
            req.session.destroy();
            return res.redirect('/login');
        }

        // 1. BLOQUEIO MANUAL
        if (user.bloqueado) {
            req.session.destroy();
            return res.render('login', { message: null, erro: 'Conta suspensa. Entre em contato com o administrador.' });
        }

        // 2. DATA DE EXPIRAÇÃO
        if (user.role !== 'ADMIN' && user.expiraEm && new Date() > new Date(user.expiraEm)) {
            return res.render('login', { message: null, erro: 'Seu período de acesso expirou. Realize a renovação.' });
        }

        req.session.usuario = user; 
        next();
    } catch (e) {
        res.redirect('/login');
    }
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// --- ROTAS PÚBLICAS ---

// CORREÇÃO: Landing Page sempre aparece (mesmo logado)
app.get('/', (req, res) => {
    // Passamos o usuário para a view saber se mostra "Login" ou "Painel"
    res.render('landing', { usuario: req.session.usuario || null }); 
});

app.get('/login', (req, res) => { 
    if (req.session.usuario) return res.redirect('/dashboard'); 
    res.render('login', { message: req.flash('error'), erro: null }); 
});

app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const user = await prisma.usuario.findUnique({ where: { email } });
        
        if (!user || !bcrypt.compareSync(senha, user.senha)) {
            return res.render('login', { message: 'Credenciais inválidas.', erro: null });
        }

        if (user.bloqueado) {
            return res.render('login', { message: null, erro: 'Conta bloqueada.' });
        }

        if (user.role !== 'ADMIN' && user.expiraEm && new Date() > new Date(user.expiraEm)) {
            return res.render('login', { message: null, erro: 'Acesso expirado.' });
        }

        if (user.role !== 'ADMIN' && user.ativo === false) {
            return res.render('login', { message: null, erro: 'Conta aguardando ativação.' });
        }

        req.session.usuario = user; 
        req.session.userId = user.id; 
        req.session.role = user.role;
        res.redirect('/dashboard');
    } catch (e) { 
        res.render('login', { message: 'Erro interno no servidor.', erro: null }); 
    }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.get('/registro', (req, res) => { res.render('registro', { message: req.flash('error') }); });

app.post('/registro', async (req, res) => {
    const { nome, email, senha } = req.body;
    try {
        const existe = await prisma.usuario.findUnique({ where: { email } });
        if (existe) { req.flash('error', 'Este e-mail já está cadastrado.'); return res.redirect('/registro'); }
        
        const hash = bcrypt.hashSync(senha, 10);
        const totalUsers = await prisma.usuario.count();
        const role = totalUsers === 0 ? 'ADMIN' : 'CLIENTE';

        // TRIAL DE 7 DIAS
        const dataTrial = new Date();
        dataTrial.setDate(dataTrial.getDate() + 7);

        const novoUsuario = await prisma.usuario.create({ 
            data: { 
                nome, 
                email, 
                senha: hash, 
                role, 
                ativo: role === 'ADMIN', 
                plano: 'ESSENTIAL',
                expiraEm: role === 'ADMIN' ? null : dataTrial 
            } 
        });

        if (novoUsuario.ativo) { 
            req.session.usuario = novoUsuario; 
            req.session.userId = novoUsuario.id; 
            req.session.role = novoUsuario.role; 
            res.redirect('/dashboard'); 
        } 
        else { 
            res.render('login', { message: null, erro: 'Cadastro realizado! Ative sua conta para iniciar.' }); 
        }
    } catch (e) { 
        req.flash('error', 'Erro ao processar registro.'); 
        res.redirect('/registro'); 
    }
});

// --- DASHBOARD ---
app.get('/dashboard', isAuth, async (req, res) => {
    try {
        let clientes;
        if (req.session.role === 'ADMIN') {
            clientes = await prisma.cliente.findMany({ orderBy: { criadoEm: 'desc' }, include: { dono: true } });
        } else {
            clientes = await prisma.cliente.findMany({ where: { donoId: req.session.userId }, orderBy: { criadoEm: 'desc' } });
        }
        
        const clientesComStatus = clientes.map(c => ({ ...c, status: c.status || 'OFFLINE' }));
        const userFresh = await prisma.usuario.findUnique({ where: { id: req.session.userId } });
        req.session.usuario = userFresh;
        
        res.render('dashboard', { clientes: clientesComStatus, usuario: req.session.usuario });
    } catch (error) { 
        res.status(500).send("Erro ao carregar dashboard"); 
    }
});

// --- API: CLIENTES ---
app.post('/api/clientes', isAuth, async (req, res) => {
    try {
        const user = await prisma.usuario.findUnique({ where: { id: req.session.userId }, include: { clientes: true } });
        const regras = PLANOS[user.plano] || PLANOS['ESSENTIAL'];
        
        if (user.role !== 'ADMIN' && user.clientes.length >= regras.maxBots) {
            return res.status(403).json({ error: `Limite do seu plano atingido (${regras.maxBots} bot).` });
        }

        await prisma.cliente.create({ 
            data: { 
                nome: req.body.nome, 
                numero: req.body.numero, 
                donoId: req.session.userId, 
                status: 'OFFLINE' 
            } 
        });
        
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro ao criar cliente" }); }
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

app.delete('/api/clientes/:id', isAuth, async (req, res) => {
    try {
        const cliente = await prisma.cliente.findUnique({ where: { id: req.params.id } });
        if (!cliente) return res.status(404).json({ error: 'Não encontrado' });
        if (req.session.role !== 'ADMIN' && cliente.donoId !== req.session.userId) return res.status(403).json({});

        const sessao = whatsapp.sessoes.get(req.params.id);
        if(sessao) { 
            try { sessao.end(undefined); } catch(e){} 
            whatsapp.sessoes.delete(req.params.id); 
        }
        
        const sessionName = `${cliente.nome}-${cliente.id}`;
        const sessionPath = path.join(__dirname, 'sessions', sessionName);
        
        if (fs.existsSync(sessionPath)) {
            try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (err) {}
        }

        await prisma.cliente.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro ao excluir" }); }
});

app.post('/api/status', isAuth, async (req, res) => {
    try {
        const { clienteId, status } = req.body;
        const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
        if (!cliente) return res.status(404).json({});
        if (req.session.role !== 'ADMIN' && cliente.donoId !== req.session.userId) return res.status(403).json({});

        await prisma.cliente.update({ where: { id: clienteId }, data: { status: status } });
        io.emit('status', { clienteId, status });

        if (status === 'ONLINE') {
            const session = whatsapp.sessoes.get(clienteId);
            if (!session) {
                const clienteAtualizado = await prisma.cliente.findUnique({ where: { id: clienteId } });
                whatsapp.iniciarWhatsApp(clienteAtualizado, io);
            }
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

// ============================================================
// --- ADMIN ROUTES (CONTROLE TOTAL V16) ---
// ============================================================

app.get('/api/admin/usuarios', isAuth, async (req, res) => {
    if (req.session.usuario.email !== 'vitorpedrocalixto@gmail.com') return res.status(403).json({});
    const usuarios = await prisma.usuario.findMany({ 
        orderBy: { criadoEm: 'desc' }, 
        select: { 
            id: true, nome: true, email: true, plano: true, ativo: true, bloqueado: true, expiraEm: true,
            clientes: { select: { id: true, nome: true, status: true } }
        } 
    });
    res.json(usuarios);
});

app.post('/api/admin/usuarios/bloqueio', isAuth, async (req, res) => {
    if (req.session.usuario.email !== 'vitorpedrocalixto@gmail.com') return res.status(403).json({ error: "Acesso negado" });
    try {
        const { idUsuario, bloquear } = req.body;
        await prisma.usuario.update({
            where: { id: idUsuario },
            data: { bloqueado: bloquear }
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro ao atualizar status" }); }
});

app.post('/api/admin/usuarios/renovar', isAuth, async (req, res) => {
    if (req.session.usuario.email !== 'vitorpedrocalixto@gmail.com') return res.status(403).json({ error: "Acesso negado" });
    try {
        const { idUsuario, diasAdicionais, vitalicio } = req.body;
        
        if (vitalicio) {
            await prisma.usuario.update({
                where: { id: idUsuario },
                data: { expiraEm: null, bloqueado: false }
            });
        } else {
            const usuario = await prisma.usuario.findUnique({ where: { id: idUsuario } });
            let novaData = usuario.expiraEm ? new Date(usuario.expiraEm) : new Date();
            if (novaData < new Date()) novaData = new Date();

            novaData.setDate(novaData.getDate() + parseInt(diasAdicionais));
            await prisma.usuario.update({
                where: { id: idUsuario },
                data: { expiraEm: novaData, bloqueado: false }
            });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro ao renovar" }); }
});

app.post('/api/admin/usuarios/definir-data', isAuth, async (req, res) => {
    if (req.session.usuario.email !== 'vitorpedrocalixto@gmail.com') return res.status(403).json({});
    try {
        const { idUsuario, novaData } = req.body;
        const dataAjustada = new Date(novaData);
        dataAjustada.setHours(23, 59, 59);

        await prisma.usuario.update({
            where: { id: idUsuario },
            data: { expiraEm: dataAjustada, bloqueado: false }
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({}); }
});

app.delete('/api/admin/usuarios/:id', isAuth, async (req, res) => {
    if (req.session.usuario.email !== 'vitorpedrocalixto@gmail.com') return res.status(403).json({});
    try {
        const idUsuario = req.params.id;
        const clientes = await prisma.cliente.findMany({ where: { donoId: idUsuario } });
        for (const cliente of clientes) {
             const sessionName = `${cliente.nome}-${cliente.id}`;
             const sessionPath = path.join(__dirname, 'sessions', sessionName);
             const sessaoAtiva = whatsapp.sessoes.get(cliente.id);
             if(sessaoAtiva) { try { sessaoAtiva.end(undefined); } catch(e){} }
             if (fs.existsSync(sessionPath)) {
                 try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch(e){}
             }
        }
        await prisma.cliente.deleteMany({ where: { donoId: idUsuario } });
        await prisma.usuario.delete({ where: { id: idUsuario } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro ao excluir usuário" }); }
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

// ============================================================
// INICIALIZAÇÃO E AUTO-START
// ============================================================

server.listen(PORT, async () => {
    console.log(`🚀 CALIXTO OMNISYSTEM V16 ONLINE NA PORTA ${PORT}`);
    timeout.iniciar(); 

    try {
        const clientesParaIniciar = await prisma.cliente.findMany({ where: { status: 'ONLINE' } });
        for (const cliente of clientesParaIniciar) {
            try {
                await whatsapp.iniciarWhatsApp(cliente, io);
                await new Promise(r => setTimeout(r, 2000));
            } catch (e) {
                await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'OFFLINE' } });
            }
        }
    } catch (e) { console.error('[BOOT] Erro:', e); }
});