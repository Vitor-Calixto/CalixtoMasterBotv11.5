const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function diagnostico() {
    console.log("🔍 CHECKUP OMNISYSTEM V19.1 - AMBIENTE LOCAL");
    console.log("-------------------------------------------");

    try {
        await prisma.$connect();
        console.log("✅ Conexão com o Banco Local: OK");

        // Verifica se a tabela que deu erro nos logs existe
        console.log("📡 Testando acesso à tabela: ContratoTemplate...");
        const count = await prisma.contratoTemplate.count();
        console.log(`✅ Tabela encontrada! Registros atuais: ${count}`);

        if (count === 0) {
            console.log("⚠️ AVISO: Tabela vazia. O seletor não terá o que mostrar.");
        }

    } catch (error) {
        console.log("❌ ERRO DETECTADO:");
        if (error.code === 'P2021') {
            console.log("👉 MOTIVO: A tabela 'ContratoTemplate' não existe no seu banco local.");
            console.log("👉 RESOLUÇÃO: Rode 'npx prisma db push' no terminal do VS Code.");
        } else {
            console.log(`👉 DETALHE: ${error.message}`);
        }
    } finally {
        await prisma.$disconnect();
        process.exit();
    }
}

diagnostico();