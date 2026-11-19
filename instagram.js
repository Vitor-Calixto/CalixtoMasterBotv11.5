// ============================================================================
// 🦅 ARQUIVO: rotas/instagram.js (GATEWAY DO INSTAGRAM V20 + OAUTH)
// ============================================================================

const engine = require('./modulos/engine');
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const crypto = require('crypto');

// Token que a Meta usa para confirmar o webhook. Defina IG_VERIFY_TOKEN no .env
// (o valor antigo continua aceito só até você trocar no painel da Meta).
const VERIFY_TOKEN = process.env.IG_VERIFY_TOKEN || "calixto_v12_instagram_secreto";

// Confere se o evento veio mesmo da Meta: ela assina o corpo com o App Secret do aplicativo.
function assinaturaValida(req, appSecret) {
    const assinatura = String(req.get('x-hub-signature-256') || '');
    if (!appSecret || !req.rawBody || !assinatura.startsWith('sha256=')) return false;
    const esperado = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
    const a = Buffer.from(assinatura), b = Buffer.from(esperado);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ============================================================================
// 🔫 2. FUNÇÕES UTILITÁRIAS
// ============================================================================

async function enviarRespostaInstagram(igidDestino, texto, token) {
    // CORREÇÃO 1: O domínio correto para Direct Business é graph.facebook.com
    const url = `https://graph.facebook.com/v20.0/me/messages`;

    try {
        await axios.post(url, {
            recipient: { id: igidDestino },
            message: { text: texto }
        }, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`✅ [INSTA-OUT] Resposta enviada para: ${igidDestino}`);
    } catch (error) {
        console.error(`❌ [INSTA-OUT] Falha no disparo:`, error.response?.data || error.message);
    }
}

// ============================================================================
// 📡 3. ROTEADOR DE WEBHOOKS
// ============================================================================

router.get('/webhook', (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

router.post('/webhook', async (req, res) => {
    res.status(200).send('EVENT_RECEIVED'); 
    
    let body = req.body;
    
    if (body.object === 'instagram') {
        for (const entry of body.entry) {
            if (entry.messaging) {
                for (const event of entry.messaging) {
                    let senderId = event.sender?.id;   
                    let recipientId = event.recipient?.id; 
                    let texto = event.message?.text;

                    if (texto && !event.message?.is_echo) {
                        console.log(`\n📸 [INSTA-IN] Direct recebido de ${senderId}: "${texto}"`);

                        try {
                            const clienteDb = await prisma.cliente.findUnique({
                                where: { instagramId: String(recipientId) }
                            });

                            if (!clienteDb) {
                                console.log(`⚠️ Nenhum bot no banco possui o Instagram ID: ${recipientId}`);
                                continue;
                            }

                            // 🔒 Só aceita eventos assinados pela Meta com o App Secret deste bot
                            if (!assinaturaValida(req, clienteDb.igAppSecret || process.env.IG_APP_SECRET)) {
                                console.warn(`🚫 [INSTA] Evento sem assinatura válida da Meta para o bot ${clienteDb.nome}. Ignorado.`);
                                continue;
                            }

                            // CORREÇÃO 2: Verificando o status correto (ONLINE)
                            if (clienteDb.status !== 'ONLINE') {
                                console.log(`🛑 Bot ${clienteDb.nome} está em status ${clienteDb.status}. Ignorando.`);
                                continue;
                            }

                            console.log(`🚀 [SISTEMA] Bot ${clienteDb.nome} está pronto. Processando fluxo...`);

                            await engine.processarMensagem(
                                clienteDb.id, 
                                senderId, 
                                texto, 
                                null, 
                                prisma, 
                                "Visitante Instagram", 
                                'INSTAGRAM', 
                                clienteDb.instagramToken
                            );
                        } catch (error) {
                            console.error("❌ Erro ao processar webhook:", error);
                        }
                    }
                }
            }
        }
    }
});

// ============================================================================
// 4. MÓDULO DE AUTENTICAÇÃO OAUTH
// ============================================================================

router.get('/setup', (req, res) => {
    const clienteId = req.query.clienteId;
    if (!clienteId) return res.redirect('/dashboard');
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const callbackUrl = `${baseUrl}/instagram/auth/callback`;
    res.render('instasetup', { clienteId, callbackUrl, webhookUrl: `${baseUrl}/instagram/webhook`, verifyToken: VERIFY_TOKEN });
});

router.post('/auth/login', async (req, res) => {
    const { clienteId, appId, appSecret } = req.body;
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const callbackUrl = `${baseUrl}/instagram/auth/callback`;

    try {
        await prisma.cliente.update({
            where: { id: clienteId },
            data: { igAppId: appId.trim(), igAppSecret: appSecret.trim() }
        });

        const scopes = "instagram_basic,instagram_manage_messages,pages_show_list,pages_read_engagement,pages_manage_metadata,business_management";
        const urlLogin = `https://www.facebook.com/v20.0/dialog/oauth?client_id=${appId.trim()}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}&response_type=code&state=${clienteId}`;
        res.redirect(urlLogin);
    } catch (e) {
        res.status(500).send("Erro ao configurar App.");
    }
});

router.all('/auth/callback', async (req, res) => {
    const code = req.query.code;
    const clienteId = req.query.state; 
    if (!code) return res.status(400).send("Código não recebido.");

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const callbackUrl = `${baseUrl}/instagram/auth/callback`;

    try {
        const clienteDb = await prisma.cliente.findUnique({ where: { id: clienteId } });
        const tokenUrl = `https://graph.facebook.com/v20.0/oauth/access_token?client_id=${clienteDb.igAppId}&redirect_uri=${encodeURIComponent(callbackUrl)}&client_secret=${clienteDb.igAppSecret}&code=${code}`;
        
        const response = await axios.get(tokenUrl);
        const userAccessToken = response.data.access_token;

        const resMeta = await axios.get(`https://graph.facebook.com/v20.0/me/accounts?fields=name,access_token,instagram_business_account{id,username}&access_token=${userAccessToken}`);
        
        console.log("==================================================");
        console.log("🔍 [RAIO-X META] Lista de Páginas retornadas:");
        console.log(JSON.stringify(resMeta.data.data, null, 2));
        console.log("==================================================");

        const igAccount = resMeta.data.data.find(acc => acc.instagram_business_account);

        if (!igAccount) throw new Error("A página veio, mas sem o Instagram. Veja o terminal!");

        const instagramUser = igAccount.instagram_business_account.username;
        const instagramBusinessId = igAccount.instagram_business_account.id; 
        const pageAccessToken = igAccount.access_token; 

        // Inscreve a página no webhook do app para as mensagens do Direct chegarem até aqui
        try {
            await axios.post(`https://graph.facebook.com/v20.0/${igAccount.id}/subscribed_apps`, null, {
                params: { subscribed_fields: 'messages,messaging_postbacks', access_token: pageAccessToken }
            });
            console.log(`[OAUTH] ✅ Página ${igAccount.name || igAccount.id} inscrita para receber mensagens.`);
        } catch (e) {
            console.error('[OAUTH] ⚠️ Não foi possível inscrever a página no webhook:', e.response?.data || e.message);
        }

        // CORREÇÃO 3: Remove o Instagram de qualquer outro bot antes de atribuir ao novo
        await prisma.cliente.updateMany({
            where: { instagramId: String(instagramBusinessId) },
            data: { instagramId: null, instagramToken: null, status: 'OFFLINE' }
        });

        await prisma.cliente.update({
            where: { id: clienteId },
            data: {
                instagramId: String(instagramBusinessId), 
                instagramUser: instagramUser,
                instagramToken: pageAccessToken,
                status: 'ONLINE' 
            }
        });
        
        res.send(`<script>alert('Conectado!'); window.location.href='/dashboard';</script>`);
    } catch (error) {
        const erroMeta = error.response?.data || error.message;
        console.error("❌ [OAUTH] Falha na conexão (Callback):", erroMeta);
        res.status(500).send(`
            <h2>Ops! Erro ao conectar com a Meta:</h2>
            <pre style="background:#f4f4f4; padding:15px; border-radius:8px; color:red;">${JSON.stringify(erroMeta, null, 2)}</pre>
            <button onclick="window.location.href='/dashboard'">Voltar ao Dashboard</button>
        `);
    }
});

module.exports = { router, enviarRespostaInstagram };