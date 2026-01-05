// Arquivo: reset.js
require('dotenv').config();
const Redis = require('ioredis');

const redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
});

async function limpar() {
    console.log('🧹 Faxinando a memória do Redis...');
    await redis.flushall();
    console.log('✨ Tudo limpo! O bot esqueceu todas as conversas antigas.');
    process.exit(0);
}

limpar();