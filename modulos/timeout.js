// ============================================================
// ARQUIVO: modulos/timeout.js
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
            
            const sessao = await sessions.getSessaoCompleta(userNum);
            
            if (sessao && sessao.timeoutAt) {
                // Se o tempo expirou
                if (agora > sessao.timeoutAt) {
                    
                    const sock = whatsapp.sessoes.get(sessao.clienteId);
                    
                    if (sock) {
                        // Avisa o Engine (que decide se é abandono ou fim de espera)
                        await engine.executarTimeout(
                            userNum, 
                            sessao.clienteId, 
                            sessao.remoteJid, 
                            sessao.nodeId, 
                            prisma, 
                            sock
                        );
                    } else {
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
    setInterval(verificarTimeouts, 5000); 
    console.log('[SISTEMA] ⏰ Monitor de Timeouts e Delays iniciado.');
}

module.exports = { iniciar };