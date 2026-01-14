// ============================================================
// ARQUIVO: index.js (V11.1 - COM EDIÇÃO E ADMIN ESTILOSO)
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

// Módulos Internos
const whatsapp = require('./modulos/whatsapp');

// Configuração
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// Configuração de Limite de Upload
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Arquivos Estáticos e Views
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- SEGURANÇA E SESSÃO ---
app.use(session({
    secret: 'segredo_calixto_v10_super_secreto', 
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 horas
}));
app.use(flash());

// Upload (Multer)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// --- MIDDLEWARE DE PROTEÇÃO ---
function isAuth(req, res, next) {
    if (req.session.usuario) { // Verifica o objeto CORRETO na sessão
        return next(); 
    }
    res.redirect('/login'); 
}

// ============================================================
// 1. ROTAS PÚBLICAS
// ============================================================

app.get('/', (req, res) => {
    if (req.session.usuario) return res.redirect('/dashboard');
    res.render('landing');
});

app.get('/login', (req, res) => {
    if (req.session.usuario) return res.redirect('/dashboard');
    res.render('login', { message: req.flash('error'), erro: null });
});

// LOGIN (CORRIGIDO)
app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    
    try {
        // 1. PRIMEIRO busca o usuário
        const user = await prisma.usuario.findUnique({ where: { email } });

        // 2. Verifica se existe e se a senha bate
        if (!user || !bcrypt.compareSync(senha, user.senha)) {
            req.flash('error', 'E-mail ou senha inválidos.');
            return res.render('login', { message: 'E-mail ou senha inválidos.', erro: null });
        }

        // 3. AGORA SIM verifica a trava de segurança (Ativo/Inativo)
        if (user.ativo === false) {
            return res.render('login', { 
                message: null, 
                erro: 'Sua conta está em análise! Aguarde aprovação do administrador.' 
            });
        }

        // 4. Salva o objeto COMPLETO na sessão (RESOLVE O ERRO 'usuario is not defined')
        req.session.usuario = user; 
        
        // Atalhos úteis
        req.session.userId = user.id;
        req.session.role = user.role;
        
        res.redirect('/dashboard');

    } catch (e) {
        console.error(e);
        res.render('login', { message: 'Erro interno.', erro: null });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/registro', (req, res) => {
    res.render('registro', { message: req.flash('error') });
});

app.post('/registro', async (req, res) => {
    const { nome, email, senha } = req.body;
    try {
        const existe = await prisma.usuario.findUnique({ where: { email } });
        if (existe) {
            req.flash('error', 'Este e-mail já está em uso.');
            return res.redirect('/registro');
        }

        const hash = bcrypt.hashSync(senha, 10);
        
        // Lógica: 1º user é ADMIN, resto é CLIENTE
        const totalUsers = await prisma.usuario.count();
        const role = totalUsers === 0 ? 'ADMIN' : 'CLIENTE';

        const novoUsuario = await prisma.usuario.create({
            // Cria como ativo: false (bloqueado) por padrão, exceto se for o primeiro (Admin)
            data: { 
                nome, 
                email, 
                senha: hash, 
                role,
                ativo: role === 'ADMIN' ? true : false 
            }
        });

        // Se for admin, já loga. Se for cliente, avisa da aprovação.
        if (novoUsuario.ativo) {
            req.session.usuario = novoUsuario;
            req.session.userId = novoUsuario.id;
            req.session.role = novoUsuario.role;
            res.redirect('/dashboard');
        } else {
            res.render('login', { message: null, erro: 'Conta criada! Aguarde aprovação do administrador para entrar.' });
        }

    } catch (e) {
        req.flash('error', 'Erro ao criar conta.');
        res.redirect('/registro');
    }
});

// ============================================================
// 2. ROTAS PROTEGIDAS
// ============================================================

app.get('/dashboard', isAuth, async (req, res) => {
    try {
        let clientes;
        
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

        // CORRIGIDO: Envia a variável com o nome 'usuario' (que o dashboard.ejs espera)
        res.render('dashboard', { 
            clientes: clientesComStatus, 
            usuario: req.session.usuario 
        });

    } catch (error) {
        console.error(error);
        res.status(500).send("Erro dashboard");
    }
});

// Editor de Fluxo
app.get('/editor/:id', isAuth, async (req, res) => {
    try {
        const cliente = await prisma.cliente.findUnique({ where: { id: req.params.id } });
        if(!cliente) return res.status(404).send("Bot não encontrado");

        if (req.session.role !== 'ADMIN' && cliente.donoId && cliente.donoId !== req.session.userId) {
            return res.status(403).send("Sem permissão.");
        }

        res.render('editor', { cliente, fluxo: cliente.fluxoJson });
    } catch (e) { res.status(500).send("Erro"); }
});

// ============================================================
// 3. API SEGURA
// ============================================================

// CRIAR CLIENTE
app.post('/api/clientes', isAuth, async (req, res) => {
    try {
        await prisma.cliente.create({ 
            data: { 
                nome: req.body.nome, 
                numero: req.body.numero,
                donoId: req.session.userId 
            } 
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro ao criar" }); }
});

// EDITAR CLIENTE (NOVO - V11.1)
app.put('/api/clientes/:id', isAuth, async (req, res) => {
    const { id } = req.params;
    const { nome, numero } = req.body;
    
    try {
        // Verifica permissão antes de editar
        const cliente = await prisma.cliente.findUnique({ where: { id } });
        if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado' });
        
        if (req.session.role !== 'ADMIN' && cliente.donoId !== req.session.userId) {
            return res.status(403).json({ error: 'Sem permissão.' });
        }

        await prisma.cliente.update({
            where: { id },
            data: { nome, numero }
        });
        res.json({ status: 'ok' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao atualizar.' });
    }
});

// Função auxiliar
async function verificarPermissao(req, clienteId) {
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente) return null;
    
    if (!cliente.donoId && req.session.role !== 'ADMIN') return false;

    if (req.session.role === 'ADMIN' || cliente.donoId === req.session.userId) {
        return cliente;
    }
    return false;
}

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

app.post('/api/clientes/:id/fluxo', isAuth, async (req, res) => {
    try {
        const cliente = await verificarPermissao(req, req.params.id);
        if (!cliente) return res.status(403).json({ error: "Sem permissão." });

        await prisma.cliente.update({ where: { id: req.params.id }, data: { fluxoJson: req.body.fluxo } });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Erro' }); }
});

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

app.post('/upload', isAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url: fileUrl });
});

// ============================================================
// 4. ROTAS ADMIN (APROVAÇÃO)
// ============================================================

app.get('/api/admin/pendentes', async (req, res) => {
    // TROQUE O E-MAIL ABAIXO PELO SEU SE PRECISAR MUDAR
    const MEU_EMAIL = 'vitorpedrocalixto@gmail.com'; 

    if (!req.session.usuario || req.session.usuario.email !== MEU_EMAIL) { 
        return res.status(403).json({ erro: 'Acesso Negado' });
    }

    const pendentes = await prisma.usuario.findMany({
        where: { ativo: false },
        select: { id: true, nome: true, email: true }
    });
    res.json(pendentes);
});

app.post('/api/admin/aprovar', async (req, res) => {
    const MEU_EMAIL = 'vitorpedrocalixto@gmail.com';

    if (!req.session.usuario || req.session.usuario.email !== MEU_EMAIL) {
        return res.status(403).json({ erro: 'Acesso Negado' });
    }

    const { idUsuario } = req.body;
    await prisma.usuario.update({
        where: { id: idUsuario },
        data: { ativo: true } 
    });
    res.json({ status: 'ok' });
});

// Agendamento Público
app.get('/agendar/:id', async (req, res) => {
    res.render('agenda', { clienteId: req.params.id });
});

// ============================================================
// INICIALIZAÇÃO
// ============================================================
server.listen(PORT, async () => {
    console.log(`🚀 CALIXTO SAAS V10 RODANDO NA PORTA ${PORT}`);
    
    // Auto-Start
    const clientesAtivos = await prisma.cliente.findMany({ where: { ativo: true } });
    for (const cliente of clientesAtivos) {
        console.log(`🔄 Reiniciando bot: ${cliente.nome}`);
        whatsapp.iniciarWhatsApp(cliente, io);
        await new Promise(r => setTimeout(r, 2000));
    }
});