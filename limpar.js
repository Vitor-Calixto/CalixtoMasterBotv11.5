// ARQUIVO: limpar.js
require('dotenv').config();
const Redis = require('ioredis');

const redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
});

async function faxina() {
    console.log('🧹 Iniciando limpeza total do Redis...');
    try {
        await redis.flushall();
        console.log('✨ SUCESSO! Memória do bot está zerada.');
        console.log('➡️  Agora reinicie o processo no PM2.');
    } catch (e) {
        console.error('Erro:', e);
    }
    process.exit(0);
}

faxina();