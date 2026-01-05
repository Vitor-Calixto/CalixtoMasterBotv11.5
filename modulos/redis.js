// ============================================================
// ARQUIVO: modulos/redis.js
// DESCRIÇÃO: GERENCIADOR DE CONEXÃO REDIS (CACHE & SESSÃO)
// ============================================================
const Redis = require('ioredis');

// Configuração padrão (ajuste se tiver senha ou host diferente)
const redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: 0, // DB 0 para Cache
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
});

redis.on('connect', () => console.log('✅ [REDIS] Conectado com sucesso!'));
redis.on('error', (err) => console.error('❌ [REDIS] Erro:', err));

module.exports = redis;