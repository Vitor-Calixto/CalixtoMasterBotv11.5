// ============================================================
// ARQUIVO: index.js (V10.0 - SAAS + LANDING PAGE)
// ============================================================
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer'); 
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs'); // Criptografia
const session = require('express-session'); // Sessão
const flash = require('connect-flash'); // Mensagens de erro

// Módulos Internos (Mantidos Intactos)
const whatsapp = require('./modulos/whatsapp');
// const redis = require('./modulos/redis'); // Ative se usar Redis
// const timeoutMonitor = require('./modulos/timeout'); // Ative se usar Timeout

// Configuração
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// Configuração de Limite de Upload (Para áudios/imagens grandes)
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Arquivos Estáticos e Views
// A pasta 'public' serve as imagens (como matrix.jpg)
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- SEGURANÇA E SESSÃO ---
app.use(session({
    secret: 'segredo_calixto_v10_super_secreto', // Troque isso em produção
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 horas logado
}));
app.use(flash());

// Upload (Multer)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// --- MIDDLEWARE DE PROTEÇÃO (O Porteiro) ---
function isAuth(req, res, next) {
    if (req.session.userId) {
        return next(); // Tem crachá? Pode passar.
    }
    res.redirect('/login'); // Sem crachá? Vai pro login.
}

// ============================================================
// 1. ROTAS PÚBLICAS (LANDING PAGE & LOGIN)
// ============================================================

// Rota Principal: Inteligente
app.get('/', (req, res) => {
    // Se já estiver logado, joga pro Dashboard direto
    if (req.session.userId) {
        return res.redirect('/dashboard');
    }
    // Se não, mostra a Landing Page bonita (landing.ejs)
    res.render('landing');
});

// Tela de Login
app.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.render('login', { message: req.flash('error') });
});

// Processar Login
app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    
    try {
        const user = await prisma.usuario.findUnique({ where: { email } });

        if (!user || !bcrypt.compareSync(senha, user.senha)) {
            req.flash('error', 'E-mail ou senha inválidos.');
            return res.redirect('/login');
        }

        // Salva dados na sessão
        req.session.userId = user.id;
        req.session.role = user.role;
        req.session.nome = user.nome;
        
        res.redirect('/dashboard');
    } catch (e) {
        console.error(e);
        req.flash('error', 'Erro interno ao logar.');
        res.redirect('/login');
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Tela de Registro (Criar Conta)
app.get('/registro', (req, res) => {
    res.render('registro', { message: req.flash('error') });
});

// Processar Registro
app.post('/registro', async (req, res) => {
    const { nome, email, senha } = req.body;
    try {
        // Verifica se já existe
        const existe = await prisma.usuario.findUnique({ where: { email } });
        if (existe) {
            req.flash('error', 'Este e-mail já está em uso.');
            return res.redirect('/registro');
        }

        const hash = bcrypt.hashSync(senha, 10);
        
        // O 1º usuário do sistema vira ADMIN. Os próximos são CLIENTE.
        const totalUsers = await prisma.usuario.count();
        const role = totalUsers === 0 ? 'ADMIN' : 'CLIENTE';

        const novoUsuario = await prisma.usuario.create({
            data: { nome, email, senha: hash, role }
        });

        // Loga automaticamente após registrar
        req.session.userId = novoUsuario.id;
        req.session.role = novoUsuario.role;
        req.session.nome = novoUsuario.nome;
        
        res.redirect('/dashboard');
    } catch (e) {
        req.flash('error', 'Erro ao criar conta.');
        res.redirect('/registro');
    }
});

// ============================================================
// 2. ROTAS PROTEGIDAS (DASHBOARD & SAAS)
// ============================================================

app.get('/dashboard', isAuth, async (req, res) => {
    try {
        let clientes;
        
        // LÓGICA SAAS: 
        // Admin vê tudo. Cliente vê só o dele.
        if (req.session.role === 'ADMIN') {
            clientes = await prisma.cliente.findMany({ 
                orderBy: { criadoEm: 'desc' }, 
                include: { dono: true } 
            });
        } else {
            clientes = await prisma.cliente.findMany({ 
                where: { donoId: req.session.userId },
                orderBy: { criadoEm: 'desc' } 
            });
        }
        
        const clientesComStatus = clientes.map(c => {
            const session = whatsapp.sessoes.get(c.id);
            return { ...c, status: session ? 'ONLINE' : 'OFFLINE' };
        });

        res.render('dashboard', { 
            clientes: clientesComStatus, 
            user: req.session // Envia dados do usuário para o frontend
        });
    } catch (error) {
        res.status(500).send("Erro dashboard: " + error.message);
    }
});

// Editor de Fluxo (Protegido)
app.get('/editor/:id', isAuth, async (req, res) => {
    try {
        const cliente = await prisma.cliente.findUnique({ where: { id: req.params.id } });
        
        if(!cliente) return res.status(404).send("Bot não encontrado");

        // Verificação de Segurança de Propriedade
        if (req.session.role !== 'ADMIN' && cliente.donoId && cliente.donoId !== req.session.userId) {
            return res.status(403).send("Você não tem permissão para editar este bot.");
        }

        res.render('editor', { cliente, fluxo: cliente.fluxoJson });
    } catch (e) { res.status(500).send("Erro"); }
});

// ============================================================
// 3. API SEGURA (CRIAÇÃO E GESTÃO DE BOTS)
// ============================================================

// Criar Cliente (Bot)
app.post('/api/clientes', isAuth, async (req, res) => {
    try {
        await prisma.cliente.create({ 
            data: { 
                nome: req.body.nome, 
                numero: req.body.numero,
                donoId: req.session.userId // <--- VINCULA AO USUÁRIO LOGADO
            } 
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro ao criar" }); }
});

// Função auxiliar de permissão
async function verificarPermissao(req, clienteId) {
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente) return null;
    
    // Se for bot antigo (sem dono), só Admin mexe.
    if (!cliente.donoId && req.session.role !== 'ADMIN') return false;

    // Se tem dono, verifica se é o usuário logado ou Admin
    if (req.session.role === 'ADMIN' || cliente.donoId === req.session.userId) {
        return cliente;
    }
    return false;
}

// Mudar Status (Ligar/Desligar)
app.post('/api/status', isAuth, async (req, res) => {
    try {
        const { clienteId, status } = req.body;
        
        const cliente = await verificarPermissao(req, clienteId);
        if (cliente === false) return res.status(403).json({ error: "Acesso negado." });
        if (cliente === null) return res.status(404).json({ error: "Bot não encontrado." });

        const ativo = status === 'ONLINE';
        await prisma.cliente.update({ where: { id: clienteId }, data: { ativo } });

        if (ativo) {
            whatsapp.iniciarWhatsApp(cliente, io);
        } else {
            const sock = whatsapp.sessoes.get(clienteId);
            if(sock) { 
                try { sock.end(undefined); } catch(e){}
                whatsapp.sessoes.delete(clienteId); 
            }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro interno" }); }
});

// Salvar Fluxo
app.post('/api/clientes/:id/fluxo', isAuth, async (req, res) => {
    try {
        const cliente = await verificarPermissao(req, req.params.id);
        if (!cliente) return res.status(403).json({ error: "Sem permissão." });

        await prisma.cliente.update({ where: { id: req.params.id }, data: { fluxoJson: req.body.fluxo } });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Erro' }); }
});

// Excluir Bot
app.delete('/api/clientes/:id', isAuth, async (req, res) => {
    try {
        const cliente = await verificarPermissao(req, req.params.id);
        if (!cliente) return res.status(403).json({ error: "Sem permissão." });

        const session = whatsapp.sessoes.get(req.params.id);
        if(session) { session.end(undefined); whatsapp.sessoes.delete(req.params.id); }
        
        await prisma.cliente.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro ao excluir" }); }
});

// Upload de Mídia (Protegido)
app.post('/upload', isAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    // URL correta apontando para a pasta estática
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url: fileUrl });
});

// ============================================================
// 4. ROTAS PÚBLICAS FINAIS (AGENDA EXTERNA)
// ============================================================

// Agendamento (O cliente final acessa isso, não precisa de login)
app.get('/agendar/:id', async (req, res) => {
    res.render('agenda', { clienteId: req.params.id });
});

// API de Agendamento Externo
app.post('/api/agendar-externo', async (req, res) => {
    const { clienteId, nome, telefone, data, horario } = req.body;
    try {
        console.log(`Novo agendamento: ${nome} - ${data} ${horario}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Erro ao agendar" });
    }
});

// ============================================================
// INICIALIZAÇÃO
// ============================================================
server.listen(PORT, async () => {
    console.log(`🚀 CALIXTO SAAS V10 RODANDO NA PORTA ${PORT}`);
    
    // Auto-Start (Inicia todos os bots ativos)
    const clientesAtivos = await prisma.cliente.findMany({ where: { ativo: true } });
    for (const cliente of clientesAtivos) {
        console.log(`🔄 Reiniciando bot: ${cliente.nome}`);
        whatsapp.iniciarWhatsApp(cliente, io);
        await new Promise(r => setTimeout(r, 2000)); // Delay para não sobrecarregar
    }
});