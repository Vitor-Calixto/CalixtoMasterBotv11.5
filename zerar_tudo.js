// ARQUIVO: zerar_tudo.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
});

async function resetTotal() {
    console.log('\n🔥 INICIANDO PROTOCOLO DE RESET TOTAL 🔥');

    // 1. Limpar Banco de Dados (Postgres)
    try {
        console.log('1️⃣  Apagando todos os clientes do Banco...');
        await prisma.cliente.deleteMany({}); 
        console.log('   ✅ Banco de Dados ZERADO.');
    } catch (e) {
        console.error('   ❌ Erro no Banco:', e.message);
    }

    // 2. Limpar Redis (Cache)
    try {
        console.log('2️⃣  Limpando memória Redis...');
        await redis.flushall();
        console.log('   ✅ Redis ZERADO.');
    } catch (e) {
        console.error('   ❌ Erro no Redis:', e.message);
    }

    // 3. Apagar Sessões do WhatsApp (Arquivos)
    try {
        console.log('3️⃣  Excluindo arquivos de sessão...');
        const sessionsDir = path.join(__dirname, 'sessions');
        if (fs.existsSync(sessionsDir)) {
            fs.rmSync(sessionsDir, { recursive: true, force: true });
            console.log('   ✅ Pasta sessions excluída.');
        } else {
            console.log('   ℹ️  Pasta sessions não existia.');
        }
    } catch (e) {
        console.error('   ❌ Erro ao apagar arquivos:', e.message);
    }

    console.log('\n✨ CONCLUÍDO! O sistema está limpo como novo.');
    console.log('➡️  Reinicie o PM2 agora.');
    process.exit(0);
}

resetTotal();