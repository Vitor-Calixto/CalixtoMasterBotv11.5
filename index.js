// ============================================================
// ARQUIVO: index.js (V19.1 - CONTRACT SYSTEM FINAL)
// ============================================================

const PLANOS = {
    'ESSENTIAL': { maxBots: 2, permissoes: { midia: true, transferencia: true, agendamento: true, audioIA: true, contratos: false } },
    'ADVANCED': { maxBots: 3, permissoes: { midia: true, transferencia: true, agendamento: true, audioIA: false, contratos: false } },
    'SIGNATURE': { maxBots: 10, permissoes: { midia: true, transferencia: true, agendamento: true, audioIA: true, contratos: true } }
};

require('dotenv').config();

// ============================================================================
// 1. IMPORTAÇÕES DE BIBLIOTECAS (O telhado do sistema)
// ============================================================================
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
const rateLimit = require('express-rate-limit'); 
const helmet = require('helmet'); 


// ============================================================================
// 2. IMPORTAÇÕES DE MÓDULOS INTERNOS (O motor do SaaS)
// ============================================================================
const { iniciarMonitorDeLembretes } = require('./modulos/cron');
const whatsapp = require('./modulos/whatsapp');
const iniciarBot = whatsapp.iniciarWhatsApp;

const timeout = require('./modulos/timeout');
 // 🚀 Só adicione o '.router' no final!

// ============================================================================
// 3. INICIALIZAÇÃO DA INFRAESTRUTURA (Levantando as paredes)
// ============================================================================
const app = express();

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// ============================================================================
// 4. MIDDLEWARES (O encanamento)
// ============================================================================
// 🚨 CRÍTICO: Sem essa linha, os Webhooks da Meta chegam vazios (undefined)
app.use(express.json()); 
app.use(bodyParser.urlencoded({ extended: true }));

const rotasInstagram = require('./instagram');
app.use('/instagram', rotasInstagram.router);
// ============================================================================
// 5. ROTAS (As portas da casa)
// ============================================================================
// Agora sim, com o "app" e a "rotaInstagram" criados, nós juntamos os dois:



app.set('trust proxy', 1); // Se estiver atrás de um proxy (ex: Heroku, VPS com proxy reverso)
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

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10, // Só 10 tentativas de login por 15 min
    message: "Muitas tentativas de login. Bloqueado por 15 min."
});

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
app.use(express.json());
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
    if (req.session.userId) { // Mudamos para conferir o ID direto
        try {
            const user = await prisma.usuario.findUnique({ where: { id: req.session.userId } });
            if (!user || user.bloqueado || !user.ativo) {
                req.session.destroy();
                return res.redirect('/login');
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


// --- SEGURANÇA 3: FILTRO DE UPLOAD (VERSÃO CORRIGIDA) ---
const upload = multer({ 
    storage: storage,
    // Aumentamos para 20MB porque vídeos MP4 são maiores que fotos
    limits: { fileSize: 20 * 1024 * 1024 }, 
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'image/jpeg', 'image/png', 'image/webp', 
            'audio/mpeg', 'audio/ogg', 'audio/mp4',  
            'application/pdf', // <--- A VÍRGULA QUE FALTAVA ESTÁ AQUI
            'video/mp4'        // Agora o MP4 será aceito pelo Multer
        ];

        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            // Mensagem de erro atualizada para incluir Vídeos
            cb(new Error('Tipo de arquivo não permitido (Aceitamos Fotos, Áudio, PDF e Vídeo MP4).'));
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

app.put('/api/clientes/:id', async (req, res) => {
    try {
        const { nome, numero, instagramUser } = req.body;
        
        // 🚨 Segurança: Garantir que o cliente pertence ao usuário logado
        const clienteDb = await prisma.cliente.findUnique({ where: { id: req.params.id } });
        if (!clienteDb || (req.session.role !== 'ADMIN' && clienteDb.donoId !== req.session.userId)) {
            return res.status(403).json({ success: false, error: 'Acesso negado' });
        }

        await prisma.cliente.update({
            where: { id: req.params.id },
            data: { 
                nome, 
                numero,
                instagramUser // 🚀 Aqui o dado do modal entra no banco!
            }
        });
        res.json({ success: true });
    } catch (error) {
        console.error("❌ Erro ao atualizar cliente:", error);
        res.status(500).json({ success: false });
    }
});

app.post('/api/clientes', isAuth, async (req, res) => {
    try {
        const user = await prisma.usuario.findUnique({ 
            where: { id: req.session.userId }, 
            include: { clientes: true } 
        });
        const regras = PLANOS[user.plano] || PLANOS['ESSENTIAL'];
        
        if (user.role !== 'ADMIN' && user.clientes.length >= regras.maxBots) {
            return res.status(403).json({ error: 'Limite de bots atingido.' });
        }

        // Pega os dados que o seu novo frontend lindo está enviando
        const { nome, numero, plataforma } = req.body;

        const novoBot = await prisma.cliente.create({ 
            data: { 
                nome: nome, 
                numero: String(numero), // Garante que o número não quebre se for nulo
                plataforma: plataforma || 'WHATSAPP', // Salva WPP ou INSTA
                donoId: req.session.userId, 
                status: 'OFFLINE' 
            } 
        });
        
        console.log(`[SISTEMA] Novo bot criado: ${novoBot.nome} (${novoBot.plataforma})`);
        res.json({ success: true, id: novoBot.id });

    } catch (e) { 
        console.error("❌ Erro ao criar cliente no banco:", e); // Isso vai te mostrar o erro real no terminal
        res.status(500).json({ error: "Erro ao criar no banco de dados." }); 
    }
});

// --- EXCLUSÃO BLINDADA E RASTREADA ---
app.delete('/api/clientes/:id', isAuth, async (req, res) => {
    try {
        const botId = req.params.id;
        console.log(`\n[EXCLUSÃO] 🗑️ Iniciando exclusão do bot ID: ${botId}`);
        
        const cliente = await prisma.cliente.findUnique({ where: { id: botId } });
        if (!cliente) {
            console.log(`[EXCLUSÃO] ❌ Bot não encontrado no banco.`);
            return res.status(404).json({ error: "Bot não encontrado" });
        }

        // 1. Derruba a conexão do WhatsApp se estiver rodando
        if (whatsapp.sessoes && whatsapp.sessoes.has(botId)) {
            console.log(`[EXCLUSÃO] 🔌 Desconectando sessão ativa na memória RAM...`);
            const sessao = whatsapp.sessoes.get(botId);
            try { sessao.end(undefined); } catch (e) {}
            whatsapp.sessoes.delete(botId);
        }

        await new Promise(r => setTimeout(r, 1000));

        // 2. Apaga arquivos da sessão física
        const sessionsDir = path.join(__dirname, 'public', 'sessions', `${cliente.nome}-${cliente.id}`);
        if (fs.existsSync(sessionsDir)) {
            console.log(`[EXCLUSÃO] 📁 Apagando pasta de sessão física...`);
            try { 
                fs.rmSync(sessionsDir, { recursive: true, force: true }); 
            } catch (fsErr) { 
                console.warn(`[AVISO] Pasta em uso pelo Windows, ignorando por enquanto.`); 
            }
        }

        // 3. Limpeza Hierárquica do Banco (Os filhos precisam morrer antes do pai)
        console.log(`[EXCLUSÃO] 🧹 Limpando dados atrelados no banco...`);
        
        try { 
            await prisma.lembrete.deleteMany({ where: { clienteId: botId } }); 
            console.log(`[EXCLUSÃO] - Lembretes apagados.`);
        } catch(e) {}

        try { 
            await prisma.contratoTemplate.deleteMany({ where: { clienteId: botId } }); 
            console.log(`[EXCLUSÃO] - Contratos apagados.`);
        } catch(e) {}

        // 4. O Golpe Final: Apagar o Bot
        console.log(`[EXCLUSÃO] 💥 Apagando bot do banco de dados...`);
        await prisma.cliente.delete({ where: { id: botId } });
        
        console.log(`[EXCLUSÃO] ✅ Bot ${cliente.nome} excluído com sucesso!\n`);
        res.json({ success: true });
        
    } catch (e) {
        console.error("\n❌ ERRO CRÍTICO NA EXCLUSÃO DO BOT:");
        console.error(e.message || e);
        console.error("------------------------------------------------\n");
        res.status(500).json({ error: "Falha ao remover bot e arquivos" });
    }
});

//ON/OFF do Bot (Status ONLINE/OFFLINE) - Agora também inicia ou para o motor de WhatsApp

app.post('/api/status', isAuth, async (req, res) => {
    try {
        const { clienteId, status } = req.body;
        
        // 1. Busca quem é o cliente ANTES de ligar/desligar para saber a plataforma
        const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
        
        // 2. Atualiza o status no banco
        await prisma.cliente.update({ where: { id: clienteId }, data: { status: status } });
        io.emit('status', { clienteId, status });
        
        // 3. Separação de Rotas (A Mágica Multi-canal)
        if (status === 'ONLINE') {
            if (cliente.plataforma === 'WHATSAPP') {
                whatsapp.iniciarWhatsApp(cliente, io);
            } else if (cliente.plataforma === 'INSTAGRAM') {
                console.log(`[SISTEMA] 🟣 Instagram ativado para o bot: ${cliente.nome}`);
                // Se você tiver um módulo de insta, chame ele aqui. Exemplo:
                // instagram.iniciarInstagram(cliente);
            }
        } else {
            if (cliente.plataforma === 'WHATSAPP') {
                const sessao = whatsapp.sessoes.get(clienteId);
                if(sessao) { try { sessao.end(undefined); } catch(e){} whatsapp.sessoes.delete(clienteId); }
            } else if (cliente.plataforma === 'INSTAGRAM') {
                console.log(`[SISTEMA] 🟣 Instagram desligado para o bot: ${cliente.nome}`);
                // Desligue a sessão do insta aqui, se necessário.
            }
        }
        
        res.json({ success: true });
    } catch (e) { 
        console.error("Erro no /api/status:", e);
        res.status(500).json({}); 
    }
});


// 🚀 ROTA NOVA: Liga e Desliga o "Cérebro" do Bot no Banco de Dados
app.post('/api/bot/ativo', async (req, res) => {
    try {
        const { clienteId, ativo } = req.body;
        // Atualiza o Prisma (verdadeiro ou falso)
        await prisma.cliente.update({ 
            where: { id: clienteId }, 
            data: { ativo: ativo } 
        });
        res.json({ success: true });
    } catch (error) {
        console.error("❌ Erro ao mudar status ATIVO do bot:", error.message);
        res.status(500).json({ success: false });
    }
});

app.get('/editor/:id', isAuth, async (req, res) => {
    const cliente = await prisma.cliente.findUnique({ where: { id: req.params.id } });
    if (!cliente || (cliente.donoId !== req.session.userId && req.session.role !== 'ADMIN')) return res.redirect('/dashboard');
    res.render('editor', { cliente, fluxo: cliente.fluxoJson || {}

    });
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


// 📄 1. ROTA PARA ABRIR A TELA DE DISPARO
app.get('/broadcast', isAuth, async (req, res) => {
    const idDoRobo = req.query.id; 
    
    if (!idDoRobo) return res.redirect('/dashboard');

    try {
        // Busca no modelo 'lembrete' (conforme seu schema.prisma)
        const agendamentos = await prisma.lembrete.findMany({
            where: { clienteId: idDoRobo },
            select: { numero: true, mensagem: true }
        });

        const contatosDaBase = agendamentos.map(ag => ({
            numero: ag.numero,
            nome: (ag.mensagem && ag.mensagem.includes('*')) ? ag.mensagem.split('*')[3] : 'Cliente'
        }));

        res.render('disparo', { 
            usuario: req.session.usuario,
            clienteId: idDoRobo, 
            contatos: contatosDaBase 
        });

    } catch (error) {
        console.error("❌ ERRO NO PRISMA:", error.message);
        res.status(500).send("Erro ao carregar a base de dados.");
    }
}); 

// 🚀 2. ROTA PARA EXECUTAR O DISPARO
app.post('/api/broadcast', isAuth, async (req, res) => {
    const { contatos, mensagem, clienteId } = req.body; 

    console.log(`[BROADCAST] 🛰️ Tentando disparo para o robô: ${clienteId}`);

    const sock = global.socks ? global.socks[clienteId] : null;

    if (!sock) {
        console.error(`[BROADCAST] ❌ Erro: Robô ${clienteId} sem conexão ativa.`);
        return res.status(500).json({ 
            error: "Robô desconectado. Reinicie o bot no dashboard para ativar a conexão." 
        });
    }

    const listaFinal = contatos.split(/[,\n]/).map(c => c.trim()).filter(c => c.length > 5);
    const { executarDisparoEmMassa } = require('./modulos/broadcast');
    
    // Executa em segundo plano para não travar a resposta do site
    executarDisparoEmMassa(listaFinal, mensagem, sock);
    res.json({ success: true });
});

// --- ROTA DE DISPARO CORRIGIDA ---
app.get('/disparo/:id', isAuth, async (req, res) => {
    try {
        const clienteId = req.params.id;
        
        const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
        if (!cliente) return res.redirect('/dashboard');

        // 2. 🛡️ BUSCA DOS NÚMEROS (Ajustado para o modelo 'lembrete')
        const contatosRecuperados = await prisma.lembrete.findMany({
            where: { clienteId: clienteId },
            distinct: ['numero'],
            select: { 
                nome: true,
                numero: true,
                cpf: true // Você pode usar o CPF como identificador se quiser
            }
        }) || [];

        // 3. Renderiza enviando os dados
        res.render('disparo', { 
            cliente, 
            // Mapeamos para garantir que o EJS não quebre se procurar por .nome
            contatos: contatosRecuperados.map(c => ({
                nome: c.cpf || 'Cliente Base', // Usamos o CPF ou um texto fixo como nome
                numero: c.numero
            })), 
            usuario: req.session.usuario 
        });

    } catch (error) {
        console.error("Erro ao carregar página de disparo:", error);
        res.redirect('/dashboard');
    }
});

async function religarRobosAtivos() {
    console.log("[SISTEMA] 🤖 Verificando robôs para auto-conexão...");
    const ativos = await prisma.cliente.findMany({ where: { status: 'ONLINE' } });

    for (const bot of ativos) {
        console.log(`[SISTEMA] 🔌 Restaurando conexão do robô: ${bot.nome} (${bot.plataforma})`);
        
        if (bot.plataforma === 'WHATSAPP') {
            if (typeof iniciarBot === 'function') {
                iniciarBot(bot, io); 
            }
        } else if (bot.plataforma === 'INSTAGRAM') {
             console.log(`[SISTEMA] 🟣 Bot de Instagram ${bot.nome} está ATIVO.`);
             // Se precisar injetar algo na memória pro Insta rodar, é aqui.
        }
    }
}
// ==========================================
// 🚀 GESTÃO DA AGENDA 
// ==========================================

// 1. Rota para abrir a página (Carrega robôs e configurações)
app.get('/dashboard/agenda', isAuth, async (req, res) => {
    try {
        // Esta linha é o "soro" que cura o erro 'clientes is not defined'
        const meusRobos = await prisma.cliente.findMany({ 
            where: { donoId: req.session.userId } 
        });

        res.render('agenda', { 
            usuario: req.session.usuario,
            clientes: meusRobos, // Agora a página recebe os dados
            systemMaintenance: getSystemConfig().maintenance 
        });
    } catch (e) {
        res.status(500).send("Erro ao carregar agenda.");
    }
});
// 2. Rota para salvar configurações da agenda (Notificação, Lembretes e Horário)
app.post('/api/clientes/:id/config-notificacao', isAuth, async (req, res) => {
    try {
        // 1. Puxa todas as variáveis enviadas pelo front-end
        const { numeroDono, tempoLembrete1, tempoLembrete2, usarHorarioComercial } = req.body;
        
        // 2. Inteligência do DDI 55 para o número do gestor
        let numeroLimpo = numeroDono.replace(/\D/g, '');
        if (numeroLimpo.length === 10 || numeroLimpo.length === 11) {
            numeroLimpo = '55' + numeroLimpo;
        }
        const jidGestor = numeroLimpo + '@s.whatsapp.net';
        
        // 3. Salva TUDO no banco de dados
        await prisma.cliente.update({
            where: { id: req.params.id },
            data: { 
                numeroNotificacao: jidGestor,
                tempoLembrete1: parseInt(tempoLembrete1) || 24, // Padrão 24h
                tempoLembrete2: parseInt(tempoLembrete2) || 0,  // Padrão 0 (desativado)
                usarHorarioComercial: usarHorarioComercial !== undefined ? usarHorarioComercial : true
            }
        });
        
        console.log(`✅ [ config ] Configurações da Agenda salvas para o bot ${req.params.id}`);
        res.json({ success: true });
    } catch (e) {
        console.error("❌ Erro ao salvar configurações:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// 3. API: Busca eventos para o calendário (VERSÃO SINCRONIZADA V30.9)

app.get('/api/agendamentos/usuario', isAuth, async (req, res) => {
    try {
        const meusRobos = await prisma.cliente.findMany({ where: { donoId: req.session.userId }, select: { id: true } });
        const ids = meusRobos.map(r => r.id);
        const agendamentos = await prisma.lembrete.findMany({ where: { clienteId: { in: ids } } });
        
        res.json(agendamentos.map(ag => ({
            id: String(ag.id),
            title: ag.status === 'BLOQUEADO' ? '🔒 RESTRITO' : (ag.nome || 'Agendamento'), 
            start: ag.dataAgendada,
            backgroundColor: ag.status === 'BLOQUEADO' ? '#1a1a1a' : 'rgba(0, 102, 255, 0.2)',
            borderColor: ag.status === 'BLOQUEADO' ? '#ff3333' : '#0066ff',
            extendedProps: { 
                // 🚩 Garante que o Nome não vai como undefined
                nome: ag.nome || 'Nome não registado', 
                cpf: ag.cpf,
                // 🚩 Garante que o número não vai como undefined
                numero: ag.numero || 'Sem número',
                mensagem: ag.mensagem,
                clienteId: ag.clienteId
            }
        })));
    } catch (e) { res.status(500).json([]); }
});
// 4. API: Bloqueio manual e 5. API: Excluir (Mantenha as que enviamos antes)
app.post('/api/agendamentos/bloquear', isAuth, async (req, res) => {
    try {
        const { start, clienteId } = req.body;
        await prisma.lembrete.create({
            data: { numero: "SISTEMA", cpf: "BLOQUEIO", status: 'BLOQUEADO', mensagem: "🔒 HORÁRIO RESTRITO (MANUAL)", dataAgendada: new Date(start), clienteId: clienteId }
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/agendamentos/:id', isAuth, async (req, res) => {
    try {
        await prisma.lembrete.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/agendamentos/manual', isAuth, async (req, res) => {
    try {
        const { nome, whatsapp, data, clienteId } = req.body;

        // Limpa o número e garante o 55 (Brasil) para o Baileys não dar erro
        let numLimpo = String(whatsapp).replace(/\D/g, '');
        if (numLimpo.length === 10 || numLimpo.length === 11) {
            numLimpo = '55' + numLimpo;
        }

        await prisma.lembrete.create({
            data: {
                nome: nome,
                numero: numLimpo,
                dataAgendada: new Date(data),
                clienteId: clienteId, // Se o ID no Prisma for número, troque para parseInt(clienteId)
                status: 'PENDENTE',
                mensagem: 'Agendamento Manual'
            }
        });

        res.json({ success: true });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

// Executa a verificação de novos lembretes a cada 2 minutos
// setInterval(() => {
//     verificarENotificarLembretes(prisma, sock);
// }, 2 * 60 * 1000);




// ==========================================
// 🧪 ROTA DE TESTE MANUAL DE LEMBRETE
// ==========================================
app.get('/api/testar-lembrete/:id', isAuth, async (req, res) => {
    try {
        const idLembrete = req.params.id;

        // 1. Busca o agendamento específico no banco
        const agendamento = await prisma.lembrete.findUnique({
            where: { id: idLembrete }
        });

        if (!agendamento) return res.status(404).send("❌ Erro: Agendamento não encontrado no banco.");

        // 2. Localiza a sessão ativa do robô (usando o mapa de sessoes)
        const sock = whatsapp.sessoes.get(agendamento.clienteId);

        if (!sock) {
            return res.status(500).send("❌ Erro: O robô responsável por este agendamento está OFFLINE.");
        }

        // 3. Monta a mensagem (Exatamente como no CRON)
        const dataF = agendamento.dataAgendada.toLocaleDateString('pt-BR');
        const horaF = agendamento.dataAgendada.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        const textoMensagem = `🔔 *TESTE DE LEMBRETE MANUAL*\n\n` +
            `Olá, *${agendamento.nome || 'Cliente'}*! Este é um teste de funcionamento.\n\n` +
            `🪪 *CPF:* ${agendamento.cpf}\n` +
            `📅 *Data:* ${dataF}\n` +
            `🕒 *Hora:* ${horaF}\n\n` +
            `O sistema de notificações está operando corretamente.`;

        // 4. Dispara para o WhatsApp do cliente
        const jid = agendamento.numero.replace(/\D/g, '') + '@s.whatsapp.net';
        await sock.sendMessage(jid, { text: textoMensagem });

        console.log(`[TESTE] Lembrete enviado manualmente para: ${agendamento.nome}`);
        res.send(`🚀 Sucesso! Lembrete enviado para ${agendamento.nome} (${agendamento.numero}).`);

    } catch (e) {
        console.error("Erro no teste manual:", e.message);
        res.status(500).send("Erro interno: " + e.message);
    }
});

// ============================================================================
// ⚖️ ROTAS JURÍDICAS E DE CONFORMIDADE (EXIGÊNCIAS DA META)
// Instruções: Quando o sistema estiver online na sua VPS (Contabo), 
// copie as URLs indicadas abaixo de cada rota e cole-as no painel da Meta 
// em: Meus Apps > Configurações do App > Básico.
// ============================================================================

// 🔗 LINK PARA A META (URL da Política de Privacidade): 
// Copie e cole -> https://calixtosystem.com.br/privacidade
app.get('/privacidade', (req, res) => {
    res.send(`
        <div style="font-family: Arial; padding: 40px; background: #000; color: #fff;">
            <h1>Política de Privacidade - Calixto OmniSystem</h1>
            <p>A sua privacidade é importante para nós. 
            O Calixto OmniSystem utiliza a API oficial da Meta apenas para 
            ler e responder mensagens autorizadas pelo usuário.</p>
            <p>Não vendemos, não compartilhamos e não utilizamos os dados
             das conversas para nenhum outro fim que não seja o funcionamento do bot de atendimento.</p>
        </div>
    `);
});

// 🔗 LINK PARA A META (URL dos Termos de Serviço): 
// Copie e cole -> https://calixtosystem.com.br/termos
app.get('/termos', (req, res) => {
    res.send(`
        <div style="font-family: Arial; padding: 40px; background: #000; color: #fff;">
            <h1>Termos de Serviço</h1>
            <p>Ao utilizar o Calixto OmniSystem, você concorda em usar a automação 
            de forma ética e em conformidade com as diretrizes da Meta.</p>
        </div>
    `);
});

// 🔗 LINK PARA A META (Instruções de Exclusão de Dados do Usuário): 
// Copie e cole -> https://calixtosystem.com.br/exclusao-dados
app.get('/exclusao-dados', (req, res) => {
    res.send(`
        <div style="font-family: Arial; padding: 40px; background: #000; color: #fff;">
            <h1>Exclusão de Dados</h1>
            <p>Se você deseja remover sua conta e todos os dados associados do nosso sistema,
             envie um e-mail solicitando a exclusão para: suporte@calixtosystem.com.br.
              Seus dados serão apagados em até 48 horas.</p>
        </div>
    `);
});


// ============================================================================
// 🏁 4. INÍCIO DO SERVIDOR
// ============================================================================
server.listen(PORT, async () => {
    console.log(`🚀 CALIXTO OMNISYSTEM V19.1 ONLINE NA PORTA ${PORT}`);
    await religarRobosAtivos(); // Restaura as conexões antes de liberar o sistema
    timeout.iniciar(); 
    if (typeof iniciarMonitorDeLembretes === 'function') {
        iniciarMonitorDeLembretes(prisma, whatsapp.sessoes);
        console.log("[SISTEMA] ⏰ Monitor de Lembretes Ativado.");
    }
});