// ARQUIVO: zerar_tudo.js (LIMPEZA NUCLEAR CORRIGIDA)
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
// Tenta carregar o Redis, mas não falha se não tiver
let redis = null;
try {
    const Redis = require('ioredis');
    redis = new Redis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
    });
} catch (e) {}

const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

async function resetTotal() {
    console.log('\n🔥 INICIANDO PROTOCOLO DE RESET TOTAL 🔥');
    console.log('-------------------------------------------');

    // 1. Limpar Banco de Dados
    try {
        console.log('1️⃣  Apagando todos os clientes do Banco...');
        await prisma.cliente.deleteMany({}); 
        console.log('   ✅ Banco de Dados ZERADO (Você terá que criar o bot de novo no painel).');
    } catch (e) {
        console.error('   ❌ Erro no Banco:', e.message);
    }

    // 2. Limpar Redis
    if (redis) {
        try {
            console.log('2️⃣  Limpando memória Redis...');
            await redis.flushall();
            console.log('   ✅ Redis ZERADO.');
        } catch (e) {
            console.log('   ⚠️  Redis ignorado (não conectado).');
        }
    }

    // 3. Apagar Sessões (AS DUAS POSSÍVEIS)
    console.log('3️⃣  Excluindo arquivos de sessão...');
    
    const pastasParaApagar = [
        path.join(__dirname, 'sessions'),          // Caminho antigo
        path.join(__dirname, 'public', 'sessions') // Caminho novo (V18/V23)
    ];

    for (const pasta of pastasParaApagar) {
        if (fs.existsSync(pasta)) {
            try {
                fs.rmSync(pasta, { recursive: true, force: true });
                console.log(`   ✅ Pasta apagada: ${pasta}`);
            } catch (e) {
                // Se der erro de permissão (EBUSY), tentamos renomear para "lixo"
                try {
                    const lixo = pasta + '_LIXO_' + Date.now();
                    fs.renameSync(pasta, lixo);
                    console.log(`   ⚠️  Pasta travada renomeada para: ${lixo} (O Windows apagará depois)`);
                } catch (errRename) {
                    console.error(`   ❌ ERRO CRÍTICO: O Windows bloqueou a pasta ${pasta}. Reinicie o PC se necessário.`);
                }
            }
        } else {
            console.log(`   ℹ️  Pasta não existia: ${pasta}`);
        }
    }

    console.log('\n-------------------------------------------');
    console.log('✨ SISTEMA COMPLETAMENTE RESETADO.');
    console.log('➡️  Passo 1: Crie um novo bot no Dashboard.');
    console.log('➡️  Passo 2: Escaneie o código.');
    console.log('-------------------------------------------\n');
    process.exit(0);
}

resetTotal();