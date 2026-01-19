// ARQUIVO: medico.js (O CURANDEIRO DO SISTEMA)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const prisma = new PrismaClient();
const redis = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
});

async function operarPaciente() {
    console.clear();
    console.log("👨‍⚕️ OLÁ! SOU O MÉDICO DO SISTEMA.");
    console.log("🏥 Iniciando cirurgia de emergência...\n");

    // ----------------------------------------------------
    // 1. LIMPEZA DO REDIS (Sua ideia original)
    // ----------------------------------------------------
    try {
        console.log("1️⃣  [REDIS] Limpando memória cache...");
        await redis.flushall();
        console.log("   ✅ Redis limpo com sucesso.");
    } catch (e) {
        console.log("   ⚠️  Redis não configurado ou desligado (Ignorando).");
    }

    // ----------------------------------------------------
    // 2. RESET DO BANCO DE DADOS (PRISMA)
    // ----------------------------------------------------
    try {
        console.log("\n2️⃣  [BANCO] Definindo todos os bots como OFFLINE...");
        const update = await prisma.cliente.updateMany({
            data: { status: 'OFFLINE' }
        });
        console.log(`   ✅ ${update.count} bots foram desconectados no banco.`);
    } catch (e) {
        console.error("   ❌ Erro no Banco:", e.message);
    }

    // ----------------------------------------------------
    // 3. CIRURGIA NOS ARQUIVOS (PASTA SESSIONS)
    // ----------------------------------------------------
    console.log("\n3️⃣  [ARQUIVOS] Tentando apagar pastas travadas...");
    
    // Lista de pastas onde as sessões podem estar
    const caminhos = [
        path.join(__dirname, 'sessions'),
        path.join(__dirname, 'public', 'sessions')
    ];

    for (const p of caminhos) {
        if (fs.existsSync(p)) {
            try {
                // Tenta apagar
                fs.rmSync(p, { recursive: true, force: true });
                console.log(`   ✅ Pasta apagada: ${p}`);
            } catch (e) {
                // Se o Windows bloquear, tenta o truque de renomear
                try {
                    const lixo = p + "_LIXO_" + Date.now();
                    fs.renameSync(p, lixo);
                    console.log(`   ⚠️  Pasta estava travada! Renomeada para: ${lixo}`);
                    console.log(`       (Você pode apagar essa pasta de lixo manualmente depois)`);
                } catch (errRename) {
                    console.error(`   ❌ ERRO CRÍTICO: O Windows não solta a pasta: ${p}`);
                    console.error(`      SOLUÇÃO: Feche todos os terminais do Node.js e tente de novo.`);
                }
            }
        } else {
            console.log(`   ℹ️  Nada para apagar em: ${p}`);
        }
    }

    console.log("\n------------------------------------------------");
    console.log("✅ CIRURGIA CONCLUÍDA! O sistema está limpo.");
    console.log("🚀 Pode rodar 'node index.js' agora.");
    console.log("------------------------------------------------\n");
    
    process.exit(0);
}

operarPaciente();