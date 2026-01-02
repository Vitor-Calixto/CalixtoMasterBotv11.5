const { 
    makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    delay, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');

// COLOQUE SEU NÚMERO AQUI (Com 55, DDD e Número)
const NUMERO_TESTE = "5521990026871"; // <--- EDITE AQUI

async function iniciar() {
    console.log("---------------------------------------------------");
    console.log("🧪 INICIANDO TESTE DE CONEXÃO (MODO DEBUG)");
    console.log("---------------------------------------------------");

    // 1. Limpa sessão de teste anterior para garantir
    if (fs.existsSync('./session_debug')) {
        fs.rmSync('./session_debug', { recursive: true, force: true });
        console.log("🧹 Sessão anterior limpa.");
    }

    const { state, saveCreds } = await useMultiFileAuthState('./session_debug');
    const { version } = await fetchLatestBaileysVersion();
    
    console.log(`📦 Versão do Baileys: ${version.join('.')}`);

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }), // Log limpo
        mobile: false,
        browser: ["Teste Debug", "Chrome", "1.0"],
        connectTimeoutMs: 60000,
    });

    // 2. Aguarda conexão estabilizar
    console.log("⏳ Aguardando 5 segundos antes de pedir código...");
    await delay(5000);

    if (!sock.authState.creds.registered) {
        try {
            console.log(`📞 Solicitando código para: ${NUMERO_TESTE}`);
            const code = await sock.requestPairingCode(NUMERO_TESTE);
            console.log("\n===========================");
            console.log(`✅ CÓDIGO GERADO: ${code}`);
            console.log("===========================\n");
            console.log("👉 Digite isso no seu celular AGORA.");
        } catch (e) {
            console.log("\n❌ FALHA AO GERAR CÓDIGO:");
            console.log(e.message);
            
            if(e.message.includes('428')) {
                console.log("💡 DICA: Erro 428 significa que o WhatsApp recusou a conexão inicial.");
                console.log("   Tente desligar seu roteador por 1 minuto para mudar o IP.");
            }
        }
    }

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if(connection === 'close') {
            console.log(`🔴 Conexão fechada. Motivo: ${lastDisconnect.error?.output?.statusCode}`);
        } else if(connection === 'open') {
            console.log("🟢 CONECTADO COM SUCESSO! O problema não é o WhatsApp.");
        }
    });
}

iniciar();