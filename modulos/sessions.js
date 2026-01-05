// ============================================================
// ARQUIVO: modulos/sessions.js (V3.0 - DADOS RICOS)
// ============================================================
const redis = require('./redis');

const PREFIX = 'sessao:';

module.exports = {
    // Salva onde o usuário está e QUANDO ele deve expirar
    async setEtapaUsuario(userNum, nodeId, ttlSeconds, clienteId, remoteJid) {
        const key = PREFIX + userNum;
        
        const data = {
            nodeId: nodeId,
            timestamp: Date.now(),
            // Se tiver TTL, calcula a hora exata que vence. Se não, é null (infinito)
            timeoutAt: ttlSeconds ? Date.now() + (ttlSeconds * 1000) : null,
            clienteId: clienteId,
            remoteJid: remoteJid
        };

        // Salvamos como JSON string. 
        // IMPORTANTE: Removemos o 'EX' (expiração automática) para o monitor poder ler depois.
        await redis.set(key, JSON.stringify(data));
    },

    // Retorna apenas o ID do nó (para o Engine saber onde está)
    async getEtapaUsuario(userNum) {
        const key = PREFIX + userNum;
        const raw = await redis.get(key);
        if (!raw) return null;
        try {
            const data = JSON.parse(raw);
            return data.nodeId; // Retorna só o ID (ex: "3")
        } catch (e) {
            return raw; // Fallback para compatibilidade antiga
        }
    },

    // Retorna o objeto completo (para o Monitor de Timeout saber quem é o cliente)
    async getSessaoCompleta(userNum) {
        const key = PREFIX + userNum;
        const raw = await redis.get(key);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (e) { return null; }
    },

    // Apaga a sessão (Reset)
    async limparSessao(userNum) {
        await redis.del(PREFIX + userNum);
    },

    // Lista todas as sessões ativas (para o Monitor varrer)
    async listarSessoesAtivas() {
        return await redis.keys(`${PREFIX}*`);
    },

    // --- PAUSA (HUMANO) ---
    async isPausado(userNum) {
        try {
            const status = await redis.get(`pausa:${userNum}`);
            return status === 'true';
        } catch (error) { return false; }
    },

    async setPausa(userNum, status) {
        try {
            if (status) await redis.set(`pausa:${userNum}`, 'true', 'EX', 86400);
            else await redis.del(`pausa:${userNum}`);
        } catch (error) { console.error('Erro Pause:', error); }
    }
};