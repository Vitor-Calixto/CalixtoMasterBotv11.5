// ============================================================
// ARQUIVO: modulos/redis.js (V2.0 - ROBUSTO)
// ============================================================
const { createClient } = require('redis');

// Tenta pegar a URL do .env ou usa o padrão local
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const client = createClient({
    url: redisUrl,
    socket: {
        reconnectStrategy: (retries) => {
            // Tenta reconectar infinitamente com delay crescente (max 3s)
            const delay = Math.min(retries * 50, 3000);
            console.log(`[REDIS] ⚠️ Tentando reconectar... (${retries}x)`);
            return delay;
        }
    }
});

client.on('error', (err) => {
    // Evita crashar o app se o Redis cair
    console.error('[REDIS] Erro de Conexão:', err.message);
});

client.on('connect', () => {
    // console.log('[REDIS] Conectado!'); 
    // Comentado para não poluir o log, o index.js já avisa
});

// Inicia a conexão imediatamente
(async () => {
    try {
        if (!client.isOpen) await client.connect();
    } catch (e) {
        console.error('[REDIS] Falha ao iniciar:', e.message);
    }
})();

module.exports = client;