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

const { lerConfig } = require('./modulos/email'); // lê system_config.json

const GRAPH = 'https://graph.facebook.com/v20.0';
const ESCOPOS = 'instagram_basic,instagram_manage_messages,pages_show_list,pages_read_engagement,pages_manage_metadata,business_management';

// App da Meta da PLATAFORMA (um só para todos os clientes), configurado pelo admin
// em Administração > Configurações. O .env (IG_APP_ID / IG_APP_SECRET) também vale.
function appDaPlataforma() {
    const c = lerConfig().instagram || {};
    const appId = String(c.appId || process.env.IG_APP_ID || '').trim();
    const appSecret = String(c.appSecret || process.env.IG_APP_SECRET || '').trim();
    return { appId, appSecret, configurado: !!(appId && appSecret) };
}

// Token que a Meta usa para confirmar o webhook (gerado no painel do admin).
// O valor antigo só é aceito enquanto nenhum outro for definido.
function tokenVerificacao() {
    return String((lerConfig().instagram || {}).verifyToken || process.env.IG_VERIFY_TOKEN || 'calixto_v12_instagram_secreto');
}

const urlBase = (req) => (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
const urlCallback = (req) => `${urlBase(req)}/instagram/auth/callback`;

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
    
    if (mode === 'subscribe' && token === tokenVerificacao()) {
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
                            if (!assinaturaValida(req, clienteDb.igAppSecret || appDaPlataforma().appSecret)) {
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

// ============================================================================
// 4. CONEXÃO DA CONTA (OAuth)
//    - Com o app da plataforma configurado: o cliente só clica em "Conectar".
//    - Sem ele: modo antigo, em que o cliente informa o App ID/Secret do próprio app.
//    /setup e /auth/login exigem login e dono do bot (middlewares no index.js).
// ============================================================================

function paginaAviso(res, titulo, texto, status = 200, ajudaClienteId = null) {
    const ajuda = ajudaClienteId === null ? null : '/instagram/ajuda' + (ajudaClienteId ? '?clienteId=' + encodeURIComponent(ajudaClienteId) : '');
    return res.status(status).render('instagram-conectar', { modo: 'aviso', titulo, texto, contas: [], cliente: null, ajuda });
}

// Inicia o login na Meta guardando, na sessão, para qual bot é a conexão
function iniciarOAuth(req, res, clienteId, appId, plataforma) {
    const state = crypto.randomBytes(24).toString('hex');
    req.session.igOauth = { state, clienteId: String(clienteId), plataforma, criadoEm: Date.now() };
    const url = `https://www.facebook.com/v20.0/dialog/oauth?client_id=${encodeURIComponent(appId)}` +
        `&redirect_uri=${encodeURIComponent(urlCallback(req))}&scope=${ESCOPOS}&response_type=code&state=${state}`;
    req.session.save(() => res.redirect(url));
}

// Passo a passo para o cliente deixar a conta pronta (página pública)
router.get('/ajuda', (req, res) => {
    const clienteId = /^[\w-]{1,64}$/.test(String(req.query.clienteId || '')) ? String(req.query.clienteId) : null;
    res.render('instagram-ajuda', { clienteId });
});

router.get('/setup', async (req, res) => {
    const clienteId = String(req.query.clienteId || '');
    if (!clienteId) return res.redirect('/dashboard');
    const app = appDaPlataforma();
    if (app.configurado) {
        const cliente = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true, nome: true, instagramUser: true, status: true } });
        if (!cliente) return res.redirect('/dashboard');
        return res.render('instagram-conectar', { modo: 'inicio', cliente, contas: [], titulo: null, texto: null });
    }
    // Modo antigo: tutorial para o cliente criar o próprio app
    res.render('instasetup', { clienteId, callbackUrl: urlCallback(req), webhookUrl: `${urlBase(req)}/instagram/webhook`, verifyToken: tokenVerificacao() });
});

// Conectar com o app da plataforma (um clique)
router.post('/conectar', (req, res) => {
    const app = appDaPlataforma();
    if (!app.configurado) return res.redirect('/instagram/setup?clienteId=' + encodeURIComponent(req.body.clienteId || ''));
    return iniciarOAuth(req, res, req.body.clienteId, app.appId, true);
});

// Modo antigo: o cliente informa o próprio App ID/Secret
router.post('/auth/login', async (req, res) => {
    const { clienteId } = req.body;
    const appId = String(req.body.appId || '').trim();
    const appSecret = String(req.body.appSecret || '').trim();
    if (!appId || !appSecret) return paginaAviso(res, 'Faltam dados', 'Informe o App ID e o App Secret do seu aplicativo da Meta.', 400);
    try {
        await prisma.cliente.update({ where: { id: String(clienteId) }, data: { igAppId: appId, igAppSecret: appSecret } });
        return iniciarOAuth(req, res, clienteId, appId, false);
    } catch (e) {
        console.error('[OAUTH] Falha ao salvar credenciais:', e.message);
        return paginaAviso(res, 'Não foi possível continuar', 'Tente de novo em instantes.', 500);
    }
});

// Grava a conta escolhida no bot e inscreve a página para receber mensagens
async function concluirConexao(clienteId, conta, plataforma) {
    try {
        await axios.post(`${GRAPH}/${conta.paginaId}/subscribed_apps`, null, {
            params: { subscribed_fields: 'messages,messaging_postbacks', access_token: conta.token }
        });
        console.log(`[OAUTH] ✅ Página ${conta.paginaNome} inscrita para receber mensagens.`);
    } catch (e) {
        console.error('[OAUTH] ⚠️ Não foi possível inscrever a página no webhook:', e.response?.data || e.message);
    }
    // Uma conta do Instagram só pode estar em um bot
    await prisma.cliente.updateMany({
        where: { instagramId: String(conta.igId), NOT: { id: clienteId } },
        data: { instagramId: null, instagramToken: null, instagramUser: null, status: 'OFFLINE' }
    });
    await prisma.cliente.update({
        where: { id: clienteId },
        data: {
            instagramId: String(conta.igId), instagramUser: conta.usuario, instagramToken: conta.token, status: 'ONLINE',
            ...(plataforma ? { igAppId: null, igAppSecret: null } : {}) // no modo plataforma, vale o segredo do app da plataforma
        }
    });
}

router.get('/auth/callback', async (req, res) => {
    const pendente = req.session && req.session.igOauth;
    if (req.query.error) {
        delete req.session.igOauth;
        return paginaAviso(res, 'Conexão cancelada', 'Você não autorizou o acesso ao Instagram. Pode tentar de novo quando quiser.', 200, pendente ? pendente.clienteId : '');
    }
    // Confere que a volta da Meta é desta mesma sessão (impede conexões forjadas)
    if (!pendente || !req.query.state || req.query.state !== pendente.state || Date.now() - pendente.criadoEm > 15 * 60 * 1000) {
        return paginaAviso(res, 'Link de conexão inválido ou expirado', 'Volte ao painel e clique em "Conectar Instagram" de novo.', 400);
    }
    if (!req.session.userId) return res.redirect('/login');
    const { clienteId, plataforma } = pendente;
    delete req.session.igOauth;

    try {
        const clienteDb = await prisma.cliente.findUnique({ where: { id: clienteId } });
        if (!clienteDb || (clienteDb.donoId !== req.session.userId && req.session.role !== 'ADMIN')) {
            return paginaAviso(res, 'Acesso negado', 'Este bot não pertence à sua conta.', 403);
        }
        const app = plataforma ? appDaPlataforma() : { appId: clienteDb.igAppId, appSecret: clienteDb.igAppSecret };
        if (!app.appId || !app.appSecret) return paginaAviso(res, 'Aplicativo não configurado', 'Fale com o suporte.', 500);

        // 1) código -> token curto
        const curto = await axios.get(`${GRAPH}/oauth/access_token`, { params: {
            client_id: app.appId, client_secret: app.appSecret, redirect_uri: urlCallback(req), code: req.query.code } });
        // 2) token curto -> token de longa duração (sem isso, o robô para de responder em ~1 hora)
        const longo = await axios.get(`${GRAPH}/oauth/access_token`, { params: {
            grant_type: 'fb_exchange_token', client_id: app.appId, client_secret: app.appSecret, fb_exchange_token: curto.data.access_token } });
        // 3) páginas com Instagram profissional (os tokens de página derivados de um token longo não expiram)
        const paginas = await axios.get(`${GRAPH}/me/accounts`, { params: {
            fields: 'id,name,access_token,instagram_business_account{id,username}', access_token: longo.data.access_token, limit: 100 } });

        const contas = (paginas.data.data || []).filter(p => p.instagram_business_account).map(p => ({
            paginaId: p.id, paginaNome: p.name, token: p.access_token,
            igId: p.instagram_business_account.id, usuario: p.instagram_business_account.username
        }));

        if (contas.length === 0) {
            return paginaAviso(res, 'Nenhum Instagram encontrado',
                'Não encontramos uma conta do Instagram profissional ligada a uma Página do Facebook que você administra. Siga o passo a passo para deixar a conta pronta e tente de novo.', 200, clienteId);
        }
        if (contas.length === 1) {
            await concluirConexao(clienteId, contas[0], plataforma);
            return res.render('instagram-conectar', { modo: 'sucesso', cliente: { nome: clienteDb.nome, instagramUser: contas[0].usuario }, contas: [], titulo: null, texto: null });
        }
        // Mais de uma conta: a pessoa escolhe qual usar
        req.session.igEscolha = { clienteId, plataforma, contas, criadoEm: Date.now() };
        return req.session.save(() => res.render('instagram-conectar', {
            modo: 'escolher', cliente: { nome: clienteDb.nome }, titulo: null, texto: null,
            contas: contas.map((c, i) => ({ indice: i, usuario: c.usuario, pagina: c.paginaNome }))
        }));
    } catch (error) {
        console.error('❌ [OAUTH] Falha na conexão:', error.response?.data || error.message);
        return paginaAviso(res, 'Não foi possível conectar', 'A Meta recusou a conexão. Confira o passo a passo e tente de novo; se continuar, fale com o suporte.', 502, clienteId);
    }
});

router.post('/auth/escolher', async (req, res) => {
    const pendente = req.session && req.session.igEscolha;
    if (!req.session.userId || !pendente || Date.now() - pendente.criadoEm > 15 * 60 * 1000) {
        return paginaAviso(res, 'Escolha expirada', 'Volte ao painel e clique em "Conectar Instagram" de novo.', 400);
    }
    const conta = pendente.contas[Number(req.body.indice)];
    if (!conta) return paginaAviso(res, 'Conta inválida', 'Escolha uma das contas da lista.', 400);
    const clienteDb = await prisma.cliente.findUnique({ where: { id: pendente.clienteId } });
    if (!clienteDb || (clienteDb.donoId !== req.session.userId && req.session.role !== 'ADMIN')) {
        return paginaAviso(res, 'Acesso negado', 'Este bot não pertence à sua conta.', 403);
    }
    delete req.session.igEscolha;
    try {
        await concluirConexao(pendente.clienteId, conta, pendente.plataforma);
    } catch (e) {
        console.error('❌ [OAUTH] Falha ao salvar a conta escolhida:', e.message);
        return paginaAviso(res, 'Não foi possível conectar', 'Tente de novo em instantes.', 500);
    }
    return res.render('instagram-conectar', { modo: 'sucesso', cliente: { nome: clienteDb.nome, instagramUser: conta.usuario }, contas: [], titulo: null, texto: null });
});

module.exports = { router, enviarRespostaInstagram, appDaPlataforma, tokenVerificacao };