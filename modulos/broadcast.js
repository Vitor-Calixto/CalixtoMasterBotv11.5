/**
 * ARQUIVO: modulos/broadcast.js
 * FUNÇÃO: Motor de disparo (Backend)
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function executarDisparoEmMassa(contatos, mensagem, sock) {
    console.log(`🚀 [MOTOR] Iniciando disparo para ${contatos.length} pessoas...`);
    for (let i = 0; i < contatos.length; i++) {
        try {
            let num = String(contatos[i]).replace(/\D/g, '');
            if (num.length === 10 || num.length === 11) num = '55' + num; // número brasileiro sem DDI
            num += '@s.whatsapp.net';

            await sock.sendMessage(num, { text: mensagem });
            console.log(`✅ [MOTOR] (${i+1}/${contatos.length}) Enviado para: ${num}`);

            const espera = Math.floor(Math.random() * (20000 - 10000 + 1) + 10000);
            await delay(espera);
        } catch (err) {
            console.error(`❌ [MOTOR] Falha no envio para ${contatos[i]}:`, err.message);
        }
    }
    console.log("🏁 [MOTOR] Missão de disparo concluída!");
}

module.exports = { executarDisparoEmMassa };