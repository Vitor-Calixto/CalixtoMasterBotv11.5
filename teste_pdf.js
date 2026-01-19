// ARQUIVO: teste_pdf.js
// OBJETIVO: Testar se o gerador de PDF e o Banco estão conversando
const { PrismaClient } = require('@prisma/client');
const contratos = require('./modulos/contratos');
const prisma = new PrismaClient();

async function diagnosticar() {
    console.log("🔍 === INICIANDO DIAGNÓSTICO DE CONTRATOS ===\n");

    // 1. Listar Clientes (Robôs)
    console.log("1️⃣ Buscando Robôs...");
    const clientes = await prisma.cliente.findMany();
    if (clientes.length === 0) {
        console.log("❌ NENHUM ROBÔ ENCONTRADO NO BANCO.");
        return;
    }
    clientes.forEach(c => console.log(`   🤖 Robô: ${c.nome} | ID: ${c.id}`));

    // 2. Listar Contratos
    console.log("\n2️⃣ Buscando Modelos de Contrato...");
    const modelos = await prisma.contratoTemplate.findMany();
    if (modelos.length === 0) {
        console.log("❌ NENHUM CONTRATO SALVO NO BANCO.");
        return;
    }
    modelos.forEach(m => console.log(`   📄 Modelo: ${m.nome} | ID: ${m.id} | Vinculado ao ClienteID: ${m.clienteId}`));

    // 3. Tentar Gerar PDF com o primeiro par encontrado
    console.log("\n3️⃣ Testando Geração de PDF...");
    
    // Pega o primeiro contrato
    const modeloTeste = modelos[0];
    const dadosFicticios = {
        nome_cliente: "TESTE MANUAL DE SISTEMA",
        cpf_cliente: "000.000.000-00",
        endereco_cliente: "Rua dos Testes, 123",
        valor_servico: "9.999,00"
    };

    console.log(`   ⚙️ Tentando gerar modelo "${modeloTeste.nome}"...`);
    
    const resultado = await contratos.processarContrato(
        prisma, 
        modeloTeste.id, 
        dadosFicticios, 
        "5521999999999" // Número fictício
    );

    if (resultado && resultado.sucesso) {
        console.log(`   ✅ SUCESSO! PDF gerado em: ${resultado.caminhoArquivo}`);
    } else {
        console.log(`   ❌ FALHA na geração do PDF via script.`);
    }
}

diagnosticar();