// ============================================================
// ARQUIVO: index.js
// DESCRIÇÃO: V25 - SERVIDOR ESTÁVEL (CORRIGIDO)
// ============================================================

const express = require('express');
const app = express(); // Inicializa o App primeiro!
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Importa funções do módulo WhatsApp
// Certifique-se que o modulos/whatsapp.js exporta { iniciarCliente, sessionMap }
const { iniciarCliente, sessionMap } = require('./modulos/whatsapp'); 

// Variável global para sessões (compatibilidade)
global.sessoes = {}; 

// Configuração do Express
app.set('view engine', 'ejs'); 
app.use(express.static('public')); 
app.use('/uploads', express.static('public/uploads')); 
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- UPLOADS ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = `file-${Date.now()}${ext}`;
        cb(null, name);
    }
});
const upload = multer({ storage: storage });

// --- ROTAS DO PAINEL (FRONTEND) ---
app.get('/', async (req, res) => {
    try {
        const clientes = await prisma.cliente.findMany({ orderBy: { id: 'desc' } });
        res.render('dashboard', { clientes });
    } catch (e) { res.status(500).send("Erro ao carregar dashboard: " + e.message); }
});

app.get('/editor/:id', async (req, res) => {
    try {
        const cliente = await prisma.cliente.findUnique({ where: { id: req.params.id } });
        if (!cliente) return res.send("Cliente não encontrado");
        // Garante JSON válido
        const fluxo = cliente.fluxoJson || { "drawflow": { "Home": { "data": {} } } };
        res.render('editor', { cliente, fluxo });
    } catch (e) { res.status(500).send("Erro no editor: " + e.message); }
});

// --- API (CRUD) ---
app.post('/api/clientes', async (req, res) => {
    try {
        const { nome, numero } = req.body;
        // Validação básica
        if (!nome) return res.status(400).json({ error: "Nome é obrigatório" });

        const novo = await prisma.cliente.create({
            data: { 
                nome: nome, 
                numero: numero || '', 
                status: 'OFFLINE', 
                fluxoJson: { "drawflow": { "Home": { "data": {} } } } 
            }
        });
        res.json(novo);
    } catch (e) { res.status(500).json({ error: "Erro ao criar cliente" }); }
});

app.delete('/api/clientes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[API] Excluindo cliente: ${id}`);
        
        // 1. Derruba a sessão se existir
        if (global.sessoes[id]) {
            try { global.sessoes[id].end(undefined); } catch (e) {}
            delete global.sessoes[id];
        }
        if (sessionMap && sessionMap.has(id)) {
            sessionMap.delete(id);
        }

        // 2. Apaga pasta da sessão
        const sessionPath = path.join(__dirname, 'sessions', id);
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }

        // 3. Limpa Banco de Dados (Cascading Delete Manual)
        await prisma.$transaction(async (tx) => {
            const contatos = await tx.contato.findMany({ where: { clienteId: id }, select: { id: true } });
            const ids = contatos.map(c => c.id);
            if(ids.length) await tx.mensagem.deleteMany({ where: { contatoId: { in: ids } } });
            await tx.contato.deleteMany({ where: { clienteId: id } });
            await tx.cliente.delete({ where: { id } });
        });
        
        res.json({ success: true });
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: "Erro ao excluir" }); 
    }
});

// ROTA ON/OFF (CORRIGIDA)
app.post('/api/status', async (req, res) => {
    try {
        const { clienteId, status } = req.body;
        console.log(`[API] Alterando status ${clienteId} -> ${status}`);
        
        await prisma.cliente.update({ where: { id: clienteId }, data: { status } });
        io.emit('status', { clienteId, status }); // Avisa o Front

        if (status === 'ONLINE') {
            const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
            // Só inicia se tiver número configurado
            if (cliente && cliente.numero && cliente.numero.length > 8) {
                if (!global.sessoes[clienteId]) {
                    console.log(`[RESTART] Iniciando processo do bot...`);
                    iniciarCliente(cliente, io, prisma);
                }
            } else {
                console.log(`[AVISO] Cliente ${clienteId} sem número válido.`);
            }
        }
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Erro interno no servidor" });
    }
});

app.post('/api/clientes/:id/fluxo', async (req, res) => {
    try {
        await prisma.cliente.update({ where: { id: req.params.id }, data: { fluxoJson: req.body.fluxo } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erro ao salvar fluxo" }); }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    res.json({ url: req.file.filename }); 
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 3000;

http.listen(PORT, async () => {
    console.log(`\n🚀 CALIXTO OMNISYSTEM - RODANDO NA PORTA ${PORT}`);
    
    // Recuperação de desastre: Reiniciar clientes ONLINE
    try {
        const onlines = await prisma.cliente.findMany({ where: { status: 'ONLINE' } });
        console.log(`[SISTEMA] Encontrados ${onlines.length} clientes ONLINE para iniciar.`);
        
        onlines.forEach(c => {
            if (c.numero && c.numero.length > 8) {
                iniciarCliente(c, io, prisma);
            } else {
                console.log(`[SISTEMA] Ignorando ${c.nome} (Sem número configurado)`);
            }
        });
    } catch (e) {
        console.error("[CRITICO] Erro ao carregar clientes iniciais:", e);
    }
});