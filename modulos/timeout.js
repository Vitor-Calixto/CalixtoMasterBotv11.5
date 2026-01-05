// ============================================================
// ARQUIVO: modulos/timeout.js (NOVO MONITOR)
// ============================================================
const sessions = require('./sessions');
const engine = require('./engine');
const whatsapp = require('./whatsapp'); 
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verificarTimeouts() {
    try {
        const chaves = await sessions.listarSessoesAtivas();
        const agora = Date.now();

        for (const chave of chaves) {
            const userNum = chave.split(':')[1];
            
            // Pega dados ricos (timestamp, timeoutAt, ids)
            const sessao = await sessions.getSessaoCompleta(userNum);
            
            if (sessao && sessao.timeoutAt) {
                // Se a hora atual for maior que o tempo limite
                if (agora > sessao.timeoutAt) {
                    
                    const sock = whatsapp.sessoes.get(sessao.clienteId);
                    
                    if (sock) {
                        // O cliente está online, executa o fluxo de timeout
                        await engine.executarTimeout(
                            userNum, 
                            sessao.clienteId, 
                            sessao.remoteJid, 
                            sessao.nodeId, 
                            prisma, 
                            sock
                        );
                    } else {
                        // Bot desligado, apenas limpa
                        await sessions.limparSessao(userNum);
                    }
                }
            }
        }
    } catch (e) {
        console.error("[TIMEOUT MONITOR] Erro:", e.message);
    }
}

function iniciar() {
    setInterval(verificarTimeouts, 5000); // Checa a cada 5 segundos
    console.log('[SISTEMA] ⏰ Monitor de Timeouts iniciado.');
}

module.exports = { iniciar };