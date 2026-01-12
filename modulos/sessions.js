// ============================================================
// ARQUIVO: modulos/sessions.js v5.0
// ============================================================
const Redis = require('ioredis');
// Ajuste o host se necessário
const redis = new Redis(process.env.REDIS_URL || { host: '127.0.0.1', port: 6379 });

const PREFIX = 'sessao:';
const PREFIX_PAUSA = 'pausa:';

// Salva onde o usuário está no fluxo
async function setEtapaUsuario(userNum, nodeId, ttlSeconds = 600, clienteId, remoteJid) {
    const key = `${PREFIX}${userNum}`;
    const data = {
        userNum,
        nodeId,
        clienteId,
        remoteJid,
        timestamp: Date.now(),
        // Timeout lógico (para o script timeout.js ler)
        timeoutAt: ttlSeconds ? Date.now() + (ttlSeconds * 1000) : null
    };

    await redis.set(key, JSON.stringify(data));
    // Expiração de segurança (24h)
    await redis.expire(key, 86400); 
}

// Lê o nó atual
async function getEtapaUsuario(userNum) {
    const key = `${PREFIX}${userNum}`;
    const data = await redis.get(key);
    if (!data) return null;
    try {
        const json = JSON.parse(data);
        return json.nodeId;
    } catch (e) { return null; }
}

// Pega dados ricos (incluindo timestamp)
async function getSessaoCompleta(userNum) {
    const key = `${PREFIX}${userNum}`;
    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data);
}

// Apaga sessão (Reset)
async function limparSessao(userNum) {
    const key = `${PREFIX}${userNum}`;
    await redis.del(key);
}

// Lista chaves ativas (para o monitor)
async function listarSessoesAtivas() {
    return await redis.keys(`${PREFIX}*`);
}

// --- FUNÇÕES DE PAUSA (ATENDIMENTO HUMANO) ---

async function setPausado(userNum, status) {
    const key = `${PREFIX_PAUSA}${userNum}`;
    if (status) {
        await redis.set(key, '1'); // Trava
    } else {
        await redis.del(key); // Destrava
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
    limparSessao,
    listarSessoesAtivas,
    setPausado,
    isPausado
};