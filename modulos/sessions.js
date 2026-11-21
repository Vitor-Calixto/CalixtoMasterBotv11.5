// ============================================================
// ARQUIVO: modulos/sessions.js v6.1 (SILENCIADO)
// ============================================================
const Redis = require('ioredis');
const { AsyncLocalStorage } = require('async_hooks');
const redis = new Redis(process.env.REDIS_URL || { host: '127.0.0.1', port: 6379 });

// ------------------------------------------------------------
// Cada robô (cliente do SaaS) tem o seu próprio espaço no Redis.
// Sem isso, a mesma pessoa falando com dois robôs diferentes misturaria
// etapa do fluxo, dados (nome, CPF...) e pausa entre empresas.
// Quem processa uma conversa roda dentro de dentroDoBot(clienteId, ...):
// todas as funções abaixo passam a usar as chaves daquele robô.
// ------------------------------------------------------------
const contextoBot = new AsyncLocalStorage();
function dentroDoBot(clienteId, fn) {
    return contextoBot.run({ clienteId: String(clienteId) }, fn);
}
function botAtual() {
    const c = contextoBot.getStore();
    return c && c.clienteId ? c.clienteId : '';
}
const escopo = (clienteId) => {
    const id = botAtual() || (clienteId ? String(clienteId) : '');
    return id ? `${id}:` : '';
};

const PREFIX = 'sessao:';
const PREFIX_PAUSA = 'pausa:';
const PREFIX_DADOS = 'dados:'; // Novo prefixo para variáveis do contrato

// --- GESTÃO DE ETAPAS (FLUXO) ---

async function setEtapaUsuario(userNum, nodeId, ttlSeconds = 600, clienteId, remoteJid) {
    const key = `${PREFIX}${escopo(clienteId)}${userNum}`;
    const data = {
        userNum,
        nodeId,
        clienteId,
        remoteJid,
        timestamp: Date.now(),
        timeoutAt: ttlSeconds ? Date.now() + (ttlSeconds * 1000) : null
    };

    await redis.set(key, JSON.stringify(data));
    await redis.expire(key, 86400); // 24h de persistência máxima
}

async function getEtapaUsuario(userNum) {
    const key = `${PREFIX}${escopo()}${userNum}`;
    const data = await redis.get(key);
    if (!data) return null;
    try {
        const json = JSON.parse(data);
        return json.nodeId;
    } catch (e) { return null; }
}

async function getSessaoCompleta(userNum) {
    const key = `${PREFIX}${escopo()}${userNum}`;
    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data);
}

/**
 * Desativa o timeout da SESSÃO (chave sessao:, não dados:).
 * Usado para tornar o timeout one-shot: dispara uma vez e não rearma sozinho.
 */
async function desativarTimeout(userNum) {
    const key = `${PREFIX}${escopo()}${userNum}`;
    const data = await redis.get(key);
    if (!data) return;
    try {
        const json = JSON.parse(data);
        json.timeoutAt = 'DESATIVADO';
        await redis.set(key, JSON.stringify(json));
        await redis.expire(key, 86400);
    } catch (e) {}
}

// --- GESTÃO DE VARIÁVEIS (CONTRATOS E TIMEOUTS) ---

/**
 * Salva um dado capturado (ex: nome, cpf, ou controle de timeout) no dicionário do usuário
 */
async function salvarDadosUsuario(userNum, variavel, valor) {
    const key = `${PREFIX_DADOS}${escopo()}${userNum}`;
    // Busca dados já existentes
    const bruto = await redis.get(key);
    let dados = bruto ? JSON.parse(bruto) : {};
    
    // Atualiza com o novo valor
    dados[variavel] = valor;
    
    await redis.set(key, JSON.stringify(dados));
    await redis.expire(key, 86400); // Mantém por 24h
    
    // ===========================================================
    // 🤫 O SILENCIADOR
    // ===========================================================
    // Só imprime no terminal se NÃO for a atualização invisível de timeout
    if (variavel !== 'timeoutAt') {
        console.log(`[REDIS] 📥 Dado salvo (${userNum}): ${variavel} = ${valor}`);
    }
}

/**
 * Recupera o objeto completo de variáveis para preencher o contrato
 */
async function getDadosUsuario(userNum) {
    const key = `${PREFIX_DADOS}${escopo()}${userNum}`;
    const data = await redis.get(key);
    if (!data) return {};
    return JSON.parse(data);
}

// --- UTILITÁRIOS E CONTROLE ---

/**
 * Reset completo: Apaga a posição no fluxo E os dados coletados
 */
async function limparSessao(userNum) {
    const keySessao = `${PREFIX}${escopo()}${userNum}`;
    const keyDados = `${PREFIX_DADOS}${escopo()}${userNum}`;
    
    // Vamos silenciar também a limpeza caso seja aquela faxina automática silenciosa!
    // Se a gente precisar descobrir por que tá limpando, a gente usa o log lá do engine.js
    await redis.del(keySessao);
    await redis.del(keyDados);
    
    // (Opcional) Podemos deixar o log de limpeza ativo porque ele ocorre 1x por conversa,
    // mas se achar chato depois, é só comentar essa linha abaixo:
    console.log(`[REDIS] 🧹 Sessão e Dados limpos para ${userNum}`);
}

// Lista as chaves de conversa em andamento. Usa SCAN (o KEYS trava o Redis quando há muitas chaves).
async function listarSessoesAtivas() {
    const achadas = [];
    await new Promise((resolve, reject) => {
        const fluxo = redis.scanStream({ match: `${PREFIX}*`, count: 200 });
        fluxo.on('data', (lote) => achadas.push(...lote));
        fluxo.on('end', resolve);
        fluxo.on('error', reject);
    });
    return [...new Set(achadas)];
}

// "sessao:<robo>:<numero>" -> { clienteId, userNum }  (chaves antigas, sem robô, voltam com clienteId vazio)
function lerChaveDeSessao(chave) {
    const resto = String(chave).slice(PREFIX.length);
    const i = resto.indexOf(':');
    return i === -1 ? { clienteId: '', userNum: resto } : { clienteId: resto.slice(0, i), userNum: resto.slice(i + 1) };
}

// Quem quiser ser avisado quando uma conversa for pausada/reativada (ex: dashboard ao vivo)
let aoMudarPausa = null;
function setOnPausaChange(fn) { aoMudarPausa = fn; }

async function setPausado(userNum, status) {
    const key = `${PREFIX_PAUSA}${escopo()}${userNum}`;
    const antes = (await redis.get(key)) === '1';
    if (status) {
        await redis.set(key, '1');
    } else {
        await redis.del(key);
    }
    // Só avisa quando o estado realmente mudou
    if (aoMudarPausa && antes !== !!status) {
        try { Promise.resolve(aoMudarPausa(userNum, !!status, botAtual())).catch(() => {}); } catch (e) {}
    }
}

// Consulta várias conversas de uma vez: devolve um Set com as que estão pausadas
async function pausadosEm(userNums) {
    if (!userNums || userNums.length === 0) return new Set();
    const valores = await redis.mget(userNums.map(n => `${PREFIX_PAUSA}${escopo()}${n}`));
    return new Set(userNums.filter((n, i) => valores[i] === '1'));
}

async function isPausado(userNum) {
    const key = `${PREFIX_PAUSA}${escopo()}${userNum}`;
    const result = await redis.get(key);
    return result === '1';
}

module.exports = {
    dentroDoBot,
    lerChaveDeSessao,
    setEtapaUsuario,
    getEtapaUsuario,
    getSessaoCompleta,
    desativarTimeout,
    salvarDadosUsuario,
    getDadosUsuario,
    limparSessao,
    listarSessoesAtivas,
    setPausado,
    isPausado,
    pausadosEm,
    setOnPausaChange
};