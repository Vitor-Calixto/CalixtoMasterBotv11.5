// ============================================================
// ARQUIVO: index.js (ORQUESTRADOR V8.0 - COM TIMEOUT ATIVO)
// ============================================================
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer'); 
const { PrismaClient } = require('@prisma/client');

// Módulos Internos
const whatsapp = require('./modulos/whatsapp');
const redis = require('./modulos/redis');
const timeoutMonitor = require('./modulos/timeout'); // <--- NOVO: MONITOR DE TIMEOUT

// Configuração
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } }); // Socket para Pairing Code
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Configuração de Upload (Para Mídia do Bot)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ============================================================
// 1. ROTAS DE FRONTEND (PÁGINAS)
// ============================================================

// Rota Raiz -> Redireciona para o Painel
app.get('/', (req, res) => {
    res.redirect('/dashboard');
});

// Painel Principal
app.get('/dashboard', async (req, res) => {
    try {
        // Busca clientes ordenados
        const clientes = await prisma.cliente.findMany({ orderBy: { criadoEm: 'desc' } });
        
        // Verifica quem está realmente conectado na memória (Sync Visual)
        const clientesComStatus = clientes.map(c => {
            const session = whatsapp.sessoes.get(c.id);
            const isOnline = !!session; 
            if (c.ativo !== isOnline) {
                // Status visual apenas
            }
            return { ...c, status: isOnline ? 'ONLINE' : 'OFFLINE' };
        });

        res.render('dashboard', { clientes: clientesComStatus });
    } catch (error) {
        console.error(error);
        res.status(500).send("Erro ao carregar dashboard: " + error.message);
    }
});

// Editor de Fluxo
app.get('/editor/:id', async (req, res) => {
    try {
        const cliente = await prisma.cliente.findUnique({ where: { id: req.params.id } });
        if(!cliente) return res.status(404).send("Cliente não encontrado");
        res.render('editor', { cliente, fluxo: cliente.fluxoJson });
    } catch (e) {
        res.status(500).send("Erro ao abrir editor");
    }
});

// ============================================================
// 2. ROTAS DE API (GERENCIAMENTO DE CLIENTES)
// ============================================================

// Rota de Diagnóstico (Para o Frontend checar status real via AJAX)
app.get('/api/status-real', (req, res) => {
    const idsOnline = Array.from(whatsapp.sessoes.keys());
    res.json({ onlineIds: idsOnline });
});

// Criar Novo Cliente
app.post('/api/clientes', async (req, res) => {
    try {
        const { nome, numero } = req.body;
        if(!nome || !numero) return res.status(400).json({ error: "Dados incompletos" });

        await prisma.cliente.create({ data: { nome, numero } });
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Erro ao criar cliente" });
    }
});

// Excluir Cliente (E deletar sessão do WhatsApp)
app.delete('/api/clientes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // 1. Desconectar WhatsApp se existir
        const session = whatsapp.sessoes.get(id);
        if(session) {
            try { 
                session.end(undefined);
                if(session.ws) session.ws.close();
            } catch(e){}
            whatsapp.sessoes.delete(id);
        }

        // 2. Deletar do Banco (Cascade deleta contatos e msgs)
        await prisma.cliente.delete({ where: { id } });
        
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Erro ao excluir" });
    }
});

// Ligar/Desligar Bot (Switch do Dashboard)
app.post('/api/status', async (req, res) => {
    try {
        const { clienteId, status } = req.body; // 'ONLINE' ou 'OFFLINE'
        const ativo = status === 'ONLINE';

        // Atualiza no banco
        const cliente = await prisma.cliente.update({
            where: { id: clienteId },
            data: { ativo: ativo }
        });

        if (ativo) {
            // LIGA: Inicia conexão passando o IO para enviar Código de Pareamento
            whatsapp.iniciarWhatsApp(cliente, io);
        } else {
            // DESLIGA: Derruba conexão IMEDIATAMENTE (Kill Switch)
            const sock = whatsapp.sessoes.get(clienteId);
            if(sock) {
                console.log(`[API] 🛑 Forçando desconexão de: ${cliente.nome}`);
                try { 
                    sock.end(undefined); 
                    if(sock.ws) sock.ws.close(); // Garante o fim do socket
                } catch(e){}
                whatsapp.sessoes.delete(clienteId);
            }
        }

        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Erro ao mudar status" });
    }
});

// Salvar Fluxo
app.post('/api/clientes/:id/fluxo', async (req, res) => {
    try {
        const { id } = req.params;
        const { fluxo } = req.body;
        await prisma.cliente.update({ where: { id }, data: { fluxoJson: fluxo } });
        console.log(`[API] Fluxo salvo para cliente ${id}`);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erro interno' });
    }
});

// Upload de Arquivos
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Sem arquivo' });
    res.json({ url: `/uploads/${req.file.filename}` });
});

// ============================================================
// INICIALIZAÇÃO DO SISTEMA
// ============================================================
server.listen(PORT, async () => {
    console.log(`\n===================================================`);
    console.log(`🚀 CALIXTO OMNISYSTEM - ORQUESTRADOR V8.0 RODANDO!`);
    console.log(`👉 DASHBOARD: http://localhost:${PORT}/dashboard`);
    console.log(`===================================================\n`);
    
    // 1. Verifica Redis
    try {
        await redis.ping(); 
        console.log('✅ [REDIS] Banco de memória conectado!');
        
        // --- INICIA O VIGIA DE TIMEOUT ---
        timeoutMonitor.iniciar(); 

    } catch (e) {
        console.error('❌ [REDIS] ERRO CRÍTICO: Redis não encontrado. O Timeout não funcionará.');
        console.error('   -> Certifique-se que o serviço do Redis está rodando no Windows.');
    }

    // 2. AUTO-START: Inicia Bots Ativos do Banco
    try {
        const clientesAtivos = await prisma.cliente.findMany({ where: { ativo: true } });
        console.log(`[SISTEMA] 🔄 Auto-Start: Encontrados ${clientesAtivos.length} clientes para iniciar.\n`);

        for (const cliente of clientesAtivos) {
            console.log(`[SISTEMA] Iniciando ${cliente.nome}...`);
            whatsapp.iniciarWhatsApp(cliente, io);
            await new Promise(r => setTimeout(r, 2000));
        }

    } catch (e) {
        console.error('[CRITICO] Erro no Auto-Start:', e);
    }
});

io.on('connection', (socket) => {
    console.log('🔌 Painel conectado:', socket.id);
});