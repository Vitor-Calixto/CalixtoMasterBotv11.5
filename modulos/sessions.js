// ============================================================
// ARQUIVO: modulos/sessions.js v6.0 (DATA-READY)
// ============================================================
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL || { host: '127.0.0.1', port: 6379 });

const PREFIX = 'sessao:';
const PREFIX_PAUSA = 'pausa:';
const PREFIX_DADOS = 'dados:'; // Novo prefixo para variáveis do contrato

// --- GESTÃO DE ETAPAS (FLUXO) ---

async function setEtapaUsuario(userNum, nodeId, ttlSeconds = 600, clienteId, remoteJid) {
    const key = `${PREFIX}${userNum}`;
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
    const key = `${PREFIX}${userNum}`;
    const data = await redis.get(key);
    if (!data) return null;
    try {
        const json = JSON.parse(data);
        return json.nodeId;
    } catch (e) { return null; }
}

async function getSessaoCompleta(userNum) {
    const key = `${PREFIX}${userNum}`;
    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data);
}

// --- GESTÃO DE VARIÁVEIS (CONTRATOS) ---

/**
 * Salva um dado capturado (ex: nome, cpf) no dicionário do usuário
 */
async function salvarDadosUsuario(userNum, variavel, valor) {
    const key = `${PREFIX_DADOS}${userNum}`;
    // Busca dados já existentes
    const bruto = await redis.get(key);
    let dados = bruto ? JSON.parse(bruto) : {};
    
    // Atualiza com o novo valor
    dados[variavel] = valor;
    
    await redis.set(key, JSON.stringify(dados));
    await redis.expire(key, 86400); // Mantém por 24h
    console.log(`[REDIS] 📥 Dado salvo (${userNum}): ${variavel} = ${valor}`);
}

/**
 * Recupera o objeto completo de variáveis para preencher o contrato
 */
async function getDadosUsuario(userNum) {
    const key = `${PREFIX_DADOS}${userNum}`;
    const data = await redis.get(key);
    if (!data) return {};
    return JSON.parse(data);
}

// --- UTILITÁRIOS E CONTROLE ---

/**
 * Reset completo: Apaga a posição no fluxo E os dados coletados
 */
async function limparSessao(userNum) {
    const keySessao = `${PREFIX}${userNum}`;
    const keyDados = `${PREFIX_DADOS}${userNum}`;
    await redis.del(keySessao);
    await redis.del(keyDados);
    console.log(`[REDIS] 🧹 Sessão e Dados limpos para ${userNum}`);
}

async function listarSessoesAtivas() {
    return await redis.keys(`${PREFIX}*`);
}

async function setPausado(userNum, status) {
    const key = `${PREFIX_PAUSA}${userNum}`;
    if (status) {
        await redis.set(key, '1');
    } else {
        await redis.del(key);
    }
}

async function isPausado(userNum) {
    const key = `${PREFIX_PAUSA}${userNum}`;
    const result = await redis.get(key);
    return result === '1';
}

module.exports = {
    setEtapaUsuario,
    getEtapaUsuario,
    getSessaoCompleta,
    salvarDadosUsuario,
    getDadosUsuario,
    limparSessao,
    listarSessoesAtivas,
    setPausado,
    isPausado
};