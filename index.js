// ============================================================
// ARQUIVO: index.js (V17.0 - GOLD MASTER)
// ============================================================

// --- 1. CONFIGURAÇÃO DOS PLANOS ---
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
// Certifique-se que a pasta 'modulos' existe com esses arquivos
const whatsapp = require('./modulos/whatsapp');
const timeout = require('./modulos/timeout');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// --- CONFIGURAÇÕES DO EXPRESS ---
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: 'segredo_calixto_v17_gold_master', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 horas
}));
app.use(flash());

// --- MIDDLEWARE DE SEGURANÇA (IS AUTH) ---
async function isAuth(req, res, next) {
    if (req.session.usuario) {
        try {
            const user = await prisma.usuario.findUnique({ where: { id: req.session.userId } });
            
            // 1. Verifica se usuário ainda existe ou foi bloqueado/desativado
            if (!user || user.bloqueado || !user.ativo) {
                req.session.destroy();
                // Se for API pedindo JSON, retorna erro 401. Se for navegador, redireciona.
                if (req.headers.accept && req.headers.accept.includes('application/json')) {
                    return res.status(401).json({ error: 'Sessão inválida ou conta bloqueada' });
                }
                return res.redirect('/login');
            }

            // 2. Verifica Vencimento do Plano (Exceto Admin)
            if (user.role !== 'ADMIN' && user.expiraEm && new Date() > new Date(user.expiraEm)) {
                req.session.destroy();
                return res.render('login', { message: null, erro: 'Seu período de acesso expirou. Contate o suporte.' });
            }

            req.session.usuario = user; // Atualiza sessão com dados frescos do banco
            return next();
        } catch (e) {
            return res.redirect('/login');
        }
    }

    // PROTEÇÃO CONTRA ERRO "UNEXPECTED TOKEN <"
    // Se uma requisição API (fetch) tentar acessar sem logar, NÃO retorna HTML de login.
    if (req.headers.accept && req.headers.accept.includes('application/json') || req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Não autorizado' }); 
    }
    
    // Se for navegador normal, manda pro login
    res.redirect('/login');
}

// --- UPLOAD CONFIG ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'public/uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, "_"))
});
const upload = multer({ storage });

// ============================================================
// ROTAS PÚBLICAS (LANDING, LEGADO, LOGIN, REGISTRO)
// ============================================================

// 1. Landing Page Comercial (A Nova)
app.get('/', (req, res) => { 
    res.render('landing', { usuario: req.session.usuario || null }); 
});

// 2. Rota Secreta "Legado" (A Antiga Cyberpunk)
app.get('/legado', (req, res) => { 
    res.render('legado'); 
});

app.get('/login', (req, res) => { 
    if (req.session.usuario) return res.redirect('/dashboard'); 
    res.render('login', { message: req.flash('error'), erro: null }); 
});

app.post('/login', async (req, res) => {
    const email = req.body.email ? req.body.email.trim() : '';
    const senha = req.body.senha ? req.body.senha.trim() : '';

    try {
        const user = await prisma.usuario.findUnique({ where: { email } });
        
        if (!user || !bcrypt.compareSync(senha, user.senha)) {
            return res.render('login', { message: 'Credenciais inválidas.', erro: null });
        }

        if (user.bloqueado) {
            return res.render('login', { message: null, erro: 'Conta bloqueada pelo administrador.' });
        }

        // Se não for Admin e não estiver ativo (Aprovação Pendente)
        if (user.role !== 'ADMIN' && !user.ativo) {
            return res.render('login', { message: null, erro: 'Cadastro em análise. Aguarde a aprovação.' });
        }

        // Verifica validade no login
        if (user.role !== 'ADMIN' && user.expiraEm && new Date() > new Date(user.expiraEm)) {
            return res.render('login', { message: null, erro: 'Sua assinatura expirou.' });
        }

        // Sucesso
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
        const existe = await prisma.usuario.findUnique({ where: { email: email.trim() } });
        if (existe) { req.flash('error', 'E-mail já cadastrado.'); return res.redirect('/registro'); }
        
        const hash = bcrypt.hashSync(senha.trim(), 10);
        
        // CONTAGEM SEGURA: Define se é Admin ou Cliente
        const totalUsers = await prisma.usuario.count();
        const role = totalUsers === 0 ? 'ADMIN' : 'CLIENTE';
        const isAtivo = totalUsers === 0; // Só o primeiro nasce ativo

        // Trial de 7 dias para clientes
        const dataTrial = new Date();
        dataTrial.setDate(dataTrial.getDate() + 7);

        const novoUsuario = await prisma.usuario.create({ 
            data: { 
                nome: nome.trim(), 
                email: email.trim(), 
                senha: hash, 
                role: role, 
                ativo: isAtivo, 
                plano: 'ESSENTIAL',
                expiraEm: role === 'ADMIN' ? null : dataTrial 
            } 
        });

        if (novoUsuario.ativo) { 
            // Admin loga direto
            req.session.usuario = novoUsuario; 
            req.session.userId = novoUsuario.id; 
            req.session.role = novoUsuario.role; 
            res.redirect('/dashboard'); 
        } else { 
            // Cliente vai para tela de espera
            res.render('login', { message: null, erro: 'Cadastro realizado! Aguarde a aprovação do suporte.' }); 
        }
    } catch (e) { 
        req.flash('error', 'Erro ao processar registro.'); 
        res.redirect('/registro'); 
    }
});

// ============================================================
// ÁREA PRIVADA (DASHBOARD & API)
// ============================================================

app.get('/dashboard', isAuth, async (req, res) => {
    try {
        let clientes;
        // Admin vê todos os bots (para suporte/monitoramento)
        if (req.session.role === 'ADMIN') {
            clientes = await prisma.cliente.findMany({ orderBy: { criadoEm: 'desc' }, include: { dono: true } });
        } else {
            clientes = await prisma.cliente.findMany({ where: { donoId: req.session.userId }, orderBy: { criadoEm: 'desc' } });
        }
        
        const clientesComStatus = clientes.map(c => ({ ...c, status: c.status || 'OFFLINE' }));
        
        // Refresh na sessão para garantir permissões atualizadas
        const userFresh = await prisma.usuario.findUnique({ where: { id: req.session.userId } });
        req.session.usuario = userFresh;
        
        const permissoes = PLANOS[userFresh.plano]?.permissoes || PLANOS['ESSENTIAL'].permissoes;

        res.render('dashboard', { clientes: clientesComStatus, usuario: req.session.usuario, permissoes });
    } catch (error) { 
        res.status(500).send("Erro crítico ao carregar dashboard"); 
    }
});

// --- API CLIENTES ---
app.post('/api/clientes', isAuth, async (req, res) => {
    try {
        const user = await prisma.usuario.findUnique({ where: { id: req.session.userId }, include: { clientes: true } });
        const regras = PLANOS[user.plano] || PLANOS['ESSENTIAL'];
        
        if (user.role !== 'ADMIN' && user.clientes.length >= regras.maxBots) {
            return res.status(403).json({ error: `Seu plano permite apenas ${regras.maxBots} bots.` });
        }

        const novoBot = await prisma.cliente.create({ 
            data: { 
                nome: req.body.nome, 
                numero: req.body.numero, 
                donoId: req.session.userId, 
                status: 'OFFLINE' 
            } 
        });
        
        // Retorna ID para redirecionamento
        res.json({ success: true, id: novoBot.id });
    } catch (e) { res.status(500).json({ error: "Erro ao criar cliente" }); }
});

app.put('/api/clientes/:id', isAuth, async (req, res) => {
    try {
        const cliente = await prisma.cliente.findUnique({ where: { id: req.params.id } });
        if (cliente.donoId !== req.session.userId && req.session.role !== 'ADMIN') return res.status(403).json({});
        await prisma.cliente.update({ where: { id: req.params.id }, data: { nome: req.body.nome, numero: req.body.numero } });
        res.json({ status: 'ok' });
    } catch (e) { res.status(500).json({}); }
});

app.delete('/api/clientes/:id', isAuth, async (req, res) => {
    try {
        // Derruba sessão do WhatsApp se existir
        const sessao = whatsapp.sessoes.get(req.params.id);
        if(sessao) { try { sessao.end(undefined); } catch(e){} whatsapp.sessoes.delete(req.params.id); }
        
        // Apaga pasta de sessão
        const sessionPath = path.join(__dirname, 'sessions', `${req.params.id}`);
        if (fs.existsSync(sessionPath)) try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (err) {}

        await prisma.cliente.delete({ where: { id: req.params.id } });
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

// --- EDITOR DE FLUXO & UPLOAD ---
app.get('/editor/:id', isAuth, async (req, res) => {
    const cliente = await prisma.cliente.findUnique({ where: { id: req.params.id } });
    // Segurança: só dono ou admin acessa
    if (cliente.donoId !== req.session.userId && req.session.role !== 'ADMIN') return res.redirect('/dashboard');
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

// ============================================================
// 👑 ADMIN API (PAINEL DE GESTÃO)
// ============================================================

// Listar Usuários
app.get('/api/admin/usuarios', isAuth, async (req, res) => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({ error: 'Acesso Negado' });
    
    try {
        const usuarios = await prisma.usuario.findMany({ 
            orderBy: { criadoEm: 'desc' }, 
            select: { 
                id: true, nome: true, email: true, plano: true, ativo: true, bloqueado: true, expiraEm: true,
                clientes: { select: { nome: true, status: true } }
            } 
        });
        res.json(usuarios);
    } catch (e) { res.status(500).json({ error: "Erro ao buscar usuários" }); }
});

// Aprovar (Ativar)
app.post('/api/admin/aprovar', isAuth, async (req, res) => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({});
    await prisma.usuario.update({ where: { id: req.body.idUsuario }, data: { ativo: true } });
    res.json({ status: 'ok' });
});

// Bloquear/Desbloquear
app.post('/api/admin/usuarios/bloqueio', isAuth, async (req, res) => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({});
    await prisma.usuario.update({ where: { id: req.body.idUsuario }, data: { bloqueado: req.body.bloquear } });
    res.json({ success: true });
});

// Mudar Plano
app.put('/api/admin/mudar-plano', isAuth, async (req, res) => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({});
    await prisma.usuario.update({ where: { id: req.body.idUsuario }, data: { plano: req.body.novoPlano } });
    res.json({ success: true });
});

// Definir Data / Renovar
app.post('/api/admin/usuarios/definir-data', isAuth, async (req, res) => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({});
    const dataAjustada = new Date(req.body.novaData);
    dataAjustada.setHours(23, 59, 59);
    await prisma.usuario.update({ where: { id: req.body.idUsuario }, data: { expiraEm: dataAjustada, bloqueado: false } });
    res.json({ success: true });
});

// Renovação Rápida (+7d, +30d, Vitalício)
app.post('/api/admin/usuarios/renovar', isAuth, async (req, res) => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({});
    const { idUsuario, diasAdicionais, vitalicio } = req.body;
    
    let novaData;
    if (vitalicio) {
        novaData = null; // Null no Prisma = Sem expiração
    } else {
        const user = await prisma.usuario.findUnique({ where: { id: idUsuario } });
        const baseData = (user.expiraEm && new Date(user.expiraEm) > new Date()) ? new Date(user.expiraEm) : new Date();
        baseData.setDate(baseData.getDate() + diasAdicionais);
        novaData = baseData;
    }

    await prisma.usuario.update({ where: { id: idUsuario }, data: { expiraEm: novaData, bloqueado: false } });
    res.json({ success: true });
});

// Excluir Usuário e seus Bots
app.delete('/api/admin/usuarios/:id', isAuth, async (req, res) => {
    if (req.session.role !== 'ADMIN') return res.status(403).json({});
    try {
        const idUsuario = req.params.id;
        
        // 1. Limpa sessões do WhatsApp
        const bots = await prisma.cliente.findMany({ where: { donoId: idUsuario } });
        for (const bot of bots) {
             const sessaoAtiva = whatsapp.sessoes.get(bot.id);
             if(sessaoAtiva) { try { sessaoAtiva.end(undefined); } catch(e){} }
             
             const sessionPath = path.join(__dirname, 'sessions', `${bot.id}`);
             if (fs.existsSync(sessionPath)) { try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch(e){} }
        }

        // 2. Apaga do Banco
        await prisma.cliente.deleteMany({ where: { donoId: idUsuario } });
        await prisma.usuario.delete({ where: { id: idUsuario } });
        
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro ao excluir usuário" }); }
});

// ============================================================
// INICIALIZAÇÃO DO SERVIDOR
// ============================================================
server.listen(PORT, async () => {
    console.log(`🚀 CALIXTO OMNISYSTEM V17.0 (GOLD) ONLINE NA PORTA ${PORT}`);
    timeout.iniciar(); 

    // Restaurar Bots Online
    try {
        const clientesParaIniciar = await prisma.cliente.findMany({ where: { status: 'ONLINE' } });
        console.log(`[BOOT] Restaurando ${clientesParaIniciar.length} sessões...`);
        
        for (const cliente of clientesParaIniciar) {
            const dono = await prisma.usuario.findUnique({ where: { id: cliente.donoId } });
            
            // Só liga se o dono estiver ok
            if (dono && dono.ativo && !dono.bloqueado) {
                // Checa validade do plano no boot
                if (dono.role !== 'ADMIN' && dono.expiraEm && new Date() > new Date(dono.expiraEm)) {
                    await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'OFFLINE' } });
                    continue;
                }
                
                whatsapp.iniciarWhatsApp(cliente, io);
                await new Promise(r => setTimeout(r, 2000)); // Delay para não congestionar
            } else {
                await prisma.cliente.update({ where: { id: cliente.id }, data: { status: 'OFFLINE' } });
            }
        }
    } catch (e) { console.error('[BOOT] Erro ao restaurar sessões:', e); }
});