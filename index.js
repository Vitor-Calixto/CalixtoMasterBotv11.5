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
const atendimento = require('./modulos/atendimento');
const usuarios = require('./modulos/usuarios'); // contas, senhas e assinaturas
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
usuarios.init({ prisma, io, whatsapp });
const PORT = process.env.PORT || 3000;

// ============================================================================
// 4. MIDDLEWARES (O encanamento)
// ============================================================================
// 🚨 CRÍTICO: Sem essa linha, os Webhooks da Meta chegam vazios (undefined)
app.use(express.json({
    limit: '10mb', // fluxos grandes do editor passam de 100kb (o padrão)
    // Guarda o corpo original do webhook do Instagram para conferir a assinatura da Meta
    verify: (req, res, buf) => { if (req.originalUrl.startsWith('/instagram/webhook')) req.rawBody = buf; }
})); 
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));

const rotasInstagram = require('./instagram'); // montado mais abaixo, depois da sessão
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
    message: "Muitas requisições deste IP, tente novamente mais tarde.",
    skip: (req) => req.path.startsWith('/instagram/webhook') // a Meta envia muitos eventos
});
app.use(limiter);

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,            //MUDAR PARA 15 DEPOIS
    max: 10, // Só 10 tentativas de login por 15 min
    message: "Muitas tentativas de login. Bloqueado por 15 min."
});

// ==========================================
// FUNÇÃO DE SEGURANÇA (ANTI-HACKER) 🛡️
// ==========================================
// Nome de robô: sem tags, sem quebras de linha, até 60 letras
function limparNome(texto) {
    return String(texto == null ? '' : texto).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

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
    // Preserva as outras chaves (ex.: configuração de e-mail do painel)
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...getSystemConfig(), ...newConfig }, null, 2));
}

// --- CONFIGURAÇÕES DO EXPRESS ---
// Chaves do WhatsApp nunca saem pela internet (hoje ficam em storage/whatsapp; este bloqueio cobre sobras antigas)
app.use('/sessions', (req, res) => res.sendStatus(404));
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'ignore' }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- CONFIGURAÇÃO DE SESSÃO BLINDADA ---
// Segredo que assina o cookie de login. Vem do .env (SESSION_SECRET); se não existir,
// é gerado uma vez e guardado no arquivo .session_secret (fora do Git).
function segredoDaSessao() {
    if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) return process.env.SESSION_SECRET;
    const arquivo = path.join(__dirname, '.session_secret');
    try {
        const salvo = fs.readFileSync(arquivo, 'utf8').trim();
        if (salvo.length >= 32) return salvo;
    } catch (e) {}
    const novo = require('crypto').randomBytes(48).toString('hex');
    fs.writeFileSync(arquivo, novo, { mode: 0o600 });
    console.log('[SEGURANÇA] 🔑 Novo segredo de sessão criado em .session_secret');
    return novo;
}

// (guardado em uma variável para o Socket.IO reaproveitar o login nas conversas ao vivo)
const sessionMiddleware = session({
    secret: segredoDaSessao(), 
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000, // 24 horas
        httpOnly: true, // O JavaScript do navegador não consegue ler o cookie (Anti-XSS)
        sameSite: 'lax', // Protege contra CSRF (Links maliciosos de outros sites)
        secure: process.env.NODE_ENV === 'production' // Se estiver na VPS com HTTPS, vira true automaticamente
    } 
});
app.use(sessionMiddleware);
app.use(flash());

// --- INSTAGRAM ---
// As telas de configuração exigem login e que o bot seja de quem está configurando.
// O webhook da Meta continua aberto (ela não tem sessão).
app.use('/instagram/setup', isAuth, exigirDonoDoBot(req => req.query.clienteId));
app.use('/instagram/auth/login', isAuth, exigirDonoDoBot(req => req.body && req.body.clienteId));
app.use('/instagram/conectar', isAuth, exigirDonoDoBot(req => req.body && req.body.clienteId));
app.use('/instagram/auth/escolher', isAuth);
app.use('/instagram', rotasInstagram.router);

// --- MIDDLEWARE DE MANUTENÇÃO ---
app.use((req, res, next) => {
    const config = getSystemConfig();
    if (!config.maintenance) return next();
    if (req.path.startsWith('/login') || req.path.startsWith('/uploads') || req.path === '/api/login' || req.path === '/registro' || req.path === '/logout' || req.path === '/esqueci-senha' || req.path.startsWith('/redefinir-senha/') || req.path === '/termos' || req.path === '/privacidade') { 
        return next();
    }
    if (req.session.usuario && req.session.role === 'ADMIN') {
        res.locals.maintenanceMode = true; 
        return next();
    }
    return res.render('manutencao');
});

// --- DONO DO BOT ---
// Só quem criou o bot (ou o administrador) pode ver ou mexer nele.
async function ehDonoDoBot(req, clienteId) {
    if (!clienteId) return false;
    if (req.session && req.session.role === 'ADMIN') return true;
    const bot = await prisma.cliente.findUnique({ where: { id: String(clienteId) }, select: { donoId: true } });
    return !!bot && !!req.session && bot.donoId === req.session.userId;
}
function negarAcesso(req, res) {
    if (req.originalUrl.startsWith('/api/') || req.method !== 'GET') return res.status(403).json({ success: false, error: 'Acesso negado.' });
    return res.redirect('/dashboard');
}
// Uso: exigirDonoDoBot(req => req.params.id)
function exigirDonoDoBot(pegarId) {
    return async (req, res, next) => {
        try { if (await ehDonoDoBot(req, pegarId(req))) return next(); }
        catch (e) { console.error('[SEGURANÇA] Falha ao conferir dono do bot:', e.message); }
        return negarAcesso(req, res);
    };
}
// Agendamentos (lembretes) pertencem ao dono do bot em que estão
function exigirDonoDoLembrete(pegarId) {
    return async (req, res, next) => {
        try {
            const l = await prisma.lembrete.findUnique({ where: { id: String(pegarId(req) || '') }, select: { clienteId: true } });
            if (l && await ehDonoDoBot(req, l.clienteId)) return next();
        } catch (e) { console.error('[SEGURANÇA] Falha ao conferir dono do agendamento:', e.message); }
        return negarAcesso(req, res);
    };
}

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
// Confere sessão, bloqueio, aprovação, validade da assinatura e troca obrigatória de senha
// (regras em modulos/usuarios.js)
async function isAuth(req, res, next) {
    return usuarios.isAuth(req, res, next);
}
const EXTENSOES_UPLOAD = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a',
    'application/pdf': '.pdf', 'video/mp4': '.mp4'
};
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'public/uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    // A extensão vem do tipo verificado, nunca do nome enviado (impede .html/.js disfarçados de imagem)
    filename: (req, file, cb) => {
        const base = path.parse(file.originalname).name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 60) || 'arquivo';
        cb(null, `${Date.now()}-${require('crypto').randomBytes(6).toString('hex')}-${base}${EXTENSOES_UPLOAD[file.mimetype]}`);
    }
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

        if (allowedMimes.includes(file.mimetype) && EXTENSOES_UPLOAD[file.mimetype]) {
            cb(null, true);
        } else {
            // Mensagem de erro atualizada para incluir Vídeos
            cb(new Error('Tipo de arquivo não permitido (Aceitamos Fotos, Áudio, PDF e Vídeo MP4).'));
        }
    }
});

// ================= ROTAS =================

app.get('/', (req, res) => { res.render('landing', { usuario: req.session.usuario || null }); });
app.get('/login', usuarios.telaLogin);

// app.post('/login', loginLimiter, async (req, res) => {
//     const email = req.body.email?.trim();
//     const senha = req.body.senha?.trim();
//     try {
//         const user = await prisma.usuario.findUnique({ where: { email } });
//         if (!user || !bcrypt.compareSync(senha, user.senha)) return res.render('login', { message: 'Credenciais inválidas.', erro: null });
//         if (user.bloqueado) return res.render('login', { message: null, erro: 'Conta bloqueada.' });
//         if (user.role !== 'ADMIN' && !user.ativo) return res.render('login', { message: null, erro: 'Aguarde aprovação.' });
//         if (user.role !== 'ADMIN' && user.expiraEm && new Date() > new Date(user.expiraEm)) return res.render('login', { message: null, erro: 'Assinatura expirada.' });

//         req.session.usuario = user; 
//         req.session.userId = user.id; 
//         req.session.role = user.role;
//         res.redirect('/dashboard');
//     } catch (e) { res.render('login', { message: 'Erro servidor.', erro: null }); }
// });


// Em caso de erro de autenticação,descomentar app.post abaixo e comentar o de cima

app.post('/login', loginLimiter, usuarios.fazerLogin);

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
const limitarCadastro = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: 'Muitos cadastros deste IP. Tente de novo mais tarde.' });
app.get('/registro', usuarios.telaCadastro);
app.post('/registro', limitarCadastro, usuarios.fazerCadastro);

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
        const permissoes = usuarios.permissoesDe(userFresh);
        res.render('dashboard', { 
            clientes: clientes.map(c => ({ ...c, status: c.status || 'OFFLINE' })), 
            usuario: userFresh, permissoes, systemMaintenance: sysConfig.maintenance,
            instagramLiberado: rotasInstagram.instagramLiberado(), ehAdminUser: usuarios.ehAdmin(userFresh)
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
        const permissoes = usuarios.permissoesDe(user);

        // Se o plano (ou o admin) não libera contratos, volta para o painel
        if (!permissoes.contratos) {
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
app.post('/api/contratos', isAuth, usuarios.exigirPermissao('contratos'), async (req, res) => {
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
app.put('/api/contratos/:id', isAuth, usuarios.exigirPermissao('contratos'), async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, conteudo, clienteId } = req.body;

        // Validação de segurança extra (para garantir que o usuário é dono do contrato)
        const contrato = await prisma.contratoTemplate.findUnique({ where: { id }, include: { cliente: true } });
        if (!contrato || (contrato.cliente.donoId !== req.session.userId && req.session.role !== 'ADMIN')) {
             return res.status(403).json({ error: 'Acesso negado' });
        }

        // Mudar o contrato de robô só vale para um robô que também é do usuário
        let novoClienteId = contrato.clienteId;
        if (clienteId && clienteId !== contrato.clienteId) {
            const destino = await prisma.cliente.findUnique({ where: { id: String(clienteId) } });
            if (!destino || (destino.donoId !== req.session.userId && req.session.role !== 'ADMIN')) {
                return res.status(403).json({ error: 'Acesso negado a este cliente' });
            }
            novoClienteId = destino.id;
        }

        await prisma.contratoTemplate.update({
            where: { id: id },
            data: {
                nome,
                conteudo,
                clienteId: novoClienteId
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Erro ao atualizar contrato:", error);
        res.status(500).json({ success: false });
    }
});

// 5. Rota para DELETAR um contrato
app.delete('/api/contratos/:id', isAuth, usuarios.exigirPermissao('contratos'), async (req, res) => {
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

app.put('/api/clientes/:id', isAuth, exigirDonoDoBot(req => req.params.id), async (req, res) => {
    try {
        const { numero, instagramUser } = req.body;
        const nome = req.body.nome === undefined ? undefined : limparNome(req.body.nome);
        if (nome !== undefined && nome.length < 2) return res.status(400).json({ success: false, error: 'Digite o nome do robô.' });
        
        // 🚨 Segurança: Garantir que o cliente pertence ao usuário logado
        const clienteDb = await prisma.cliente.findUnique({ where: { id: req.params.id } });
        if (!clienteDb || (req.session.role !== 'ADMIN' && clienteDb.donoId !== req.session.userId)) {
            return res.status(403).json({ success: false, error: 'Acesso negado' });
        }

        await prisma.cliente.update({
            where: { id: req.params.id },
            data: { 
                nome, 
                numero: numero === undefined ? undefined : String(numero).trim().slice(0, 30),
                instagramUser: instagramUser === undefined || instagramUser === null ? instagramUser : String(instagramUser).trim().slice(0, 60) // 🚀 Aqui o dado do modal entra no banco!
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
        const regras = usuarios.permissoesDe(user);
        
        if (!usuarios.ehAdmin(user) && user.clientes.length >= regras.maxBots) {
            return res.status(403).json({ error: `Limite de bots atingido (${regras.maxBots}). Fale com o suporte para aumentar.` });
        }

        // Pega os dados que o seu novo frontend lindo está enviando
        const nome = limparNome(req.body.nome);
        const { numero } = req.body;
        const plataforma = req.body.plataforma === 'INSTAGRAM' ? 'INSTAGRAM' : 'WHATSAPP';
        if (nome.length < 2) return res.status(400).json({ error: 'Digite o nome do robô.' });
        if (plataforma === 'WHATSAPP' && !/^\d{10,15}$/.test(String(numero || '').replace(/\D/g, ''))) {
            return res.status(400).json({ error: 'Digite o número do WhatsApp com DDD (só números).' });
        }
        if (plataforma === 'INSTAGRAM' && !rotasInstagram.instagramLiberado() && !usuarios.ehAdmin(user)) {
            return res.status(403).json({ error: 'O Instagram ainda não está disponível. Crie o robô para WhatsApp.' });
        }

        const novoBot = await prisma.cliente.create({ 
            data: { 
                nome: nome, 
                numero: plataforma === 'WHATSAPP' ? String(numero).replace(/\D/g, '') : String(numero || '').trim().slice(0, 30),
                plataforma, // Salva WPP ou INSTA
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
app.delete('/api/clientes/:id', isAuth, exigirDonoDoBot(req => req.params.id), async (req, res) => {
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

        // 2. Apaga arquivos da sessão física (chaves do WhatsApp)
        whatsapp.apagarPastaDaSessao(cliente);

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

app.post('/api/status', isAuth, exigirDonoDoBot(req => req.body.clienteId), async (req, res) => {
    try {
        const { clienteId } = req.body;
        const status = req.body.status === 'ONLINE' ? 'ONLINE' : 'OFFLINE';
        
        // 1. Busca quem é o cliente ANTES de ligar/desligar para saber a plataforma
        const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
        
        // 2. Atualiza o status no banco
        await prisma.cliente.update({ where: { id: clienteId }, data: { status: status } });
        io.to(['admins', `usuario:${cliente.donoId}`]).emit('status', { clienteId, status });
        
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
app.post('/api/bot/ativo', isAuth, exigirDonoDoBot(req => req.body.clienteId), async (req, res) => {
    try {
        const { clienteId } = req.body;
        // Atualiza o Prisma (verdadeiro ou falso)
        await prisma.cliente.update({ 
            where: { id: clienteId }, 
            data: { ativo: req.body.ativo === true || req.body.ativo === 'true' } 
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

app.post('/api/clientes/:id/fluxo', isAuth, exigirDonoDoBot(req => req.params.id), async (req, res) => {
    await prisma.cliente.update({ where: { id: req.params.id }, data: { fluxoJson: req.body.fluxo } });
    res.json({ success: true });
});

// ================= CONTAS: painel de usuários, senhas e assinaturas =================
usuarios.registrarRotas(app);

// ================= BIBLIOTECA DE FLUXOS (modelos, importar/exportar/enviar) =================
require('./modulos/fluxos')(app, { prisma, isAuth });

// ================= AGENDA (painel estilo Google Agenda + link de agendamento para o contato) =================
require('./modulos/agenda').init({ segredo: segredoDaSessao() });
require('./modulos/agenda-rotas').registrarRotas(app, {
    prisma, isAuth, exigirPermissao: usuarios.exigirPermissao, exigirDonoDoBot, exigirDonoDoLembrete,
    whatsapp, engine: require('./modulos/engine'), sessions: require('./modulos/sessions')
});

// ================= CONVERSAS AO VIVO (acompanhar em tempo real e assumir a conversa) =================
atendimento.init({ prisma, io, sessionMiddleware });
// Avisos em tempo real (status do bot, código de pareamento) só chegam ao dono e aos admins
io.on('connection', (socket) => {
    const s = socket.request.session;
    if (!s || !s.userId) return;
    socket.join(`usuario:${s.userId}`);
    if (s.role === 'ADMIN') socket.join('admins');
});
atendimento.registrarRotas(app, { isAuth: [isAuth, usuarios.exigirPermissao('conversas')], getSock: (clienteId) => whatsapp.sessoes.get(clienteId) });

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

// (as rotas antigas de aprovar/bloquear/renovar/excluir usuário foram removidas:
//  hoje tudo passa por /api/admin/contas em modulos/usuarios.js, com as proteções do administrador)

app.get('/termos', (req, res) => res.render('termos', { usuario: req.session.usuario || null }));
app.get('/privacidade', (req, res) => res.render('privacidade', { usuario: req.session.usuario || null }));


// 📄 1. ROTA PARA ABRIR A TELA DE DISPARO
app.get('/broadcast', isAuth, usuarios.exigirPermissao('disparo'), exigirDonoDoBot(req => req.query.id), async (req, res) => {
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
app.post('/api/broadcast', isAuth, usuarios.exigirPermissao('disparo'), exigirDonoDoBot(req => req.body.clienteId), async (req, res) => {
    const { contatos, mensagem, clienteId } = req.body; 

    console.log(`[BROADCAST] 🛰️ Tentando disparo para o robô: ${clienteId}`);

    // Conexões ativas ficam em whatsapp.sessoes (global.socks nunca era preenchido)
    const sock = whatsapp.sessoes.get(clienteId) || null;
    if (!contatos || !String(mensagem || '').trim()) {
        return res.status(400).json({ error: "Preencha a lista de números e a mensagem." });
    }

    if (!sock) {
        console.error(`[BROADCAST] ❌ Erro: Robô ${clienteId} sem conexão ativa.`);
        return res.status(500).json({ 
            error: "Robô desconectado. Reinicie o bot no dashboard para ativar a conexão." 
        });
    }

    const listaFinal = String(contatos).split(/[,\n]/).map(c => c.trim()).filter(c => c.length > 5);
    const { executarDisparoEmMassa } = require('./modulos/broadcast');
    
    // Executa em segundo plano para não travar a resposta do site
    executarDisparoEmMassa(listaFinal, mensagem, sock);
    res.json({ success: true });
});

// --- ROTA DE DISPARO CORRIGIDA ---
app.get('/disparo/:id', isAuth, usuarios.exigirPermissao('disparo'), exigirDonoDoBot(req => req.params.id), async (req, res) => {
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

// 1. A página da agenda e as novas rotas ficam em modulos/agenda-rotas.js
// (as configurações de horário e avisos da agenda ficam em modulos/agenda-rotas.js)
app.delete('/api/agendamentos/:id', isAuth, exigirDonoDoLembrete(req => req.params.id), async (req, res) => {
    try {
        await prisma.lembrete.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Executa a verificação de novos lembretes a cada 2 minutos
// setInterval(() => {
//     verificarENotificarLembretes(prisma, sock);
// }, 2 * 60 * 1000);




// ==========================================
// 🧪 ROTA DE TESTE MANUAL DE LEMBRETE
// ==========================================
app.get('/api/testar-lembrete/:id', isAuth, exigirDonoDoLembrete(req => req.params.id), async (req, res) => {
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
        const dataF = agendamento.dataAgendada.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const horaF = agendamento.dataAgendada.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

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

// 🔗 /privacidade e /termos usam as páginas completas (views/privacidade.ejs e views/termos.ejs), definidas acima.

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
    await usuarios.desligarBotsVencidos(); // assinaturas vencidas não religam
    await religarRobosAtivos(); // Restaura as conexões antes de liberar o sistema
    timeout.iniciar(); 
    if (typeof iniciarMonitorDeLembretes === 'function') {
        iniciarMonitorDeLembretes(prisma, whatsapp.sessoes);
        console.log("[SISTEMA] ⏰ Monitor de Lembretes Ativado.");
    }
});