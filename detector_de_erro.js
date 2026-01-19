// ARQUIVO: detector_de_erro.js
// OBJETIVO: Mostrar o erro cru no terminal sem filtros.

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { 
    makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion,
    DisconnectReason 
} = require('@whiskeysockets/baileys');

// 1. CONFIGURAÇÃO DE DIAGNÓSTICO
const NOME_SESSAO = 'teste_diagnostico';
// Tenta os dois caminhos possíveis para garantir
const CAMINHOS = [
    path.resolve(__dirname, 'sessions', NOME_SESSAO),
    path.resolve(__dirname, 'public', 'sessions', NOME_SESSAO)
];

async function iniciarDiagnostico() {
    console.log('\n==================================================');
    console.log('🕵️‍♂️ INICIANDO DETETOR DE ERROS V1.0');
    console.log('==================================================\n');

    // --- TESTE 1: SISTEMA DE ARQUIVOS (O "LIXEIRO") ---
    console.log('[TESTE 1] 📂 Tentando manipular pastas de sessão...');
    
    for (const pasta of CAMINHOS) {
        if (fs.existsSync(pasta)) {
            console.log(`   > Encontrada pasta em: ${pasta}`);
            try {
                fs.rmSync(pasta, { recursive: true, force: true });
                console.log('   ✅ SUCESSO: Pasta apagada sem erros.');
            } catch (erro) {
                console.log('   ❌ ERRO CRÍTICO AO APAGAR:');
                console.log(`      CÓDIGO: ${erro.code}`);
                console.log(`      MENSAGEM: ${erro.message}`);
                
                if (erro.code === 'EBUSY') {
                    console.log('      👉 DIAGNÓSTICO: O Windows bloqueou o arquivo. Tem um processo "zumbi" do Node rodando no fundo.');
                }
            }
        } else {
            console.log(`   > Pasta limpa (não existia): ${pasta}`);
        }
    }

    // --- TESTE 2: CONEXÃO WHATSAPP (COM LOGS ATIVADOS) ---
    console.log('\n[TESTE 2] 🔗 Iniciando motor do WhatsApp (Logs: DEBUG)...');
    
    // Usamos o primeiro caminho para criar a nova sessão
    const pathAuth = CAMINHOS[0];
    const { state, saveCreds } = await useMultiFileAuthState(pathAuth);
    const { version } = await fetchLatestBaileysVersion();

    console.log(`   📦 Versão da Biblioteca: ${version.join('.')}`);

    const sock = makeWASocket({
        version,
        // AQUI ESTÁ O SEGREDO: 'info' ou 'debug' mostra tudo o que está acontecendo "por baixo do capô"
        logger: pino({ level: 'info' }), 
        printQRInTerminal: true, // Vai mostrar o QR Code no terminal se precisar
        auth: state,
        browser: ["Diagnostico", "Chrome", "1.0"],
        connectTimeoutMs: 60000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n🔍 QR CODE GERADO! (O sistema está funcionando, o erro pode ser no Frontend)');
        }

        if (connection === 'close') {
            const erro = lastDisconnect.error;
            const statusCode = erro?.output?.statusCode;

            console.log('\n❌ CONEXÃO CAIU!');
            console.log(`   Status Code: ${statusCode}`);
            console.log(`   Erro Real: ${erro}`);

            if (statusCode === 401) console.log('   👉 DIAGNÓSTICO: Desconectado/Logoff.');
            if (statusCode === 408) console.log('   👉 DIAGNÓSTICO: Timeout (Internet lenta ou bloqueio).');
            if (statusCode === 428) console.log('   👉 DIAGNÓSTICO: Conexão recusada (Bloqueio de IP).');
            if (statusCode === 515) console.log('   👉 DIAGNÓSTICO: Reinício necessário (Stream Restart).');

            process.exit(1);
        } else if (connection === 'open') {
            console.log('\n🟢 SUCESSO TOTAL! CONECTADO!');
            console.log('   👉 Se conectou aqui mas não no site, o erro está no index.js ou dashboard.ejs.');
            process.exit(0);
        }
    });
}

iniciarDiagnostico();