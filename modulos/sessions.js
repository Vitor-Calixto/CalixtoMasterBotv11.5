// ============================================================
// ARQUIVO: modulos/sessions.js
// DESCRIÇÃO: GERENCIADOR DE SESSÃO VIA REDIS (COM PAUSA)
// ============================================================
const redis = require('./redis'); // Importa sua conexão

const TEMPO_EXPIRACAO_PADRAO = 3600; // 1 hora

module.exports = {
    // --- GERENCIAMENTO DE FLUXO ---

    // Busca onde o usuário parou
    async getEtapaUsuario(userId) {
        try {
            const etapa = await redis.get(`sessao:${userId}`);
            return etapa || null;
        } catch (error) {
            console.error('Erro no Redis getEtapa:', error);
            return null;
        }
    },

    // Salva onde o usuário está agora
    async setEtapaUsuario(userId, etapaId, minutos = 60) {
        try {
            const ttlSegundos = minutos * 60;
            await redis.set(`sessao:${userId}`, etapaId, 'EX', ttlSegundos);
        } catch (error) {
            console.error('Erro no Redis setEtapa:', error);
        }
    },

    // Deleta a sessão (fim de papo)
    async limparSessao(userId) {
        try {
            await redis.del(`sessao:${userId}`);
        } catch (error) {
            console.error('Erro no Redis limparSessao:', error);
        }
    },

    // --- GERENCIAMENTO DE PAUSA (ATENDIMENTO HUMANO) ---
    // Essas eram as funções que estavam faltando!

    // Verifica se o bot está pausado para esse número
    async isPausado(userId) {
        try {
            const status = await redis.get(`pausa:${userId}`);
            return status === 'true'; // Retorna true se achar a string 'true'
        } catch (error) {
            return false;
        }
    },

    // Ativa ou Desativa a pausa (Atendimento Humano)
    async setPausa(userId, status) {
        try {
            if (status) {
                // Pausa por 24 horas (exemplo) para não ficar travado para sempre
                await redis.set(`pausa:${userId}`, 'true', 'EX', 86400);
            } else {
                // Remove a pausa (Volta pro Bot)
                await redis.del(`pausa:${userId}`);
            }
        } catch (error) {
            console.error('Erro no Redis setPausa:', error);
        }
    }
};