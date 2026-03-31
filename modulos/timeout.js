// ============================================================
// ARQUIVO: modulos/timeout.js (CRON DE SEGUNDO PLANO V12)
// ============================================================
const sessions = require('./sessions');
const engine = require('./engine');
const whatsapp = require('./whatsapp'); 

// ⚠️ ATENÇÃO: Nunca dê um "new PrismaClient()" aqui dentro se o arquivo principal
// (index.js) já fez isso. Use a mesma instância global para não estourar conexões!
// O ideal é passar o Prisma via parâmetro na hora do iniciar(), mas como este é um Cron
// isolado e você já exporta o Prisma no db.js (ou similar), recomendo usar o centralizado.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient(); // (Se possível, importe do seu arquivo de banco central)

/**
 * Função varredora: Roda a cada 5 segundos olhando o Redis
 */
async function verificarTimeouts() {
    try {
        // 1. Pega todo mundo que está conversando com o robô no momento (Redis)
        const chaves = await sessions.listarSessoesAtivas();
        const agora = Date.now();

        // 2. Varre cada conversa
        for (const chave of chaves) {
            // A chave vem como 'sessao:551199999999', a gente extrai só o número
            const userNum = chave.split(':')[1];
            
            // 3. Pega a prancheta completa desse cliente
            const sessao = await sessions.getSessaoCompleta(userNum);
            
            if (sessao && sessao.timeoutAt) {
                // 4. BINGO! O relógio virou. O tempo de limite chegou.
                if (agora > sessao.timeoutAt) {
                    
                    // Procura o celular (socket) da empresa logada que estava falando com ele
                    const sock = whatsapp.sessoes.get(sessao.clienteId);
                    
                    if (sock) {
                        // 5. Acorda o cérebro (engine.js) para processar o fim da linha
                        await engine.executarTimeout(
                            userNum, 
                            sessao.clienteId, 
                            sessao.remoteJid, 
                            sessao.nodeId, 
                            prisma, 
                            sock,
                            "Cliente" // pushName default
                        );
                    } else {
                        // Se o celular da empresa desconectou do QR Code, a gente mata a sessão do cliente
                        await sessions.limparSessao(userNum);
                    }
                }
            }
        }
    } catch (e) {
        console.error("[CRON TIMEOUT] Erro ao varrer sessões:", e.message);
    }
}

/**
 * Liga o motor de varredura
 */
function iniciar() {
    // Fica rodando em loop a cada 5 segundos (5000 milissegundos)
    setInterval(verificarTimeouts, 5000); 
    console.log('⏰ [CRON] Monitor de Timeouts e Delays V12 ativado e rodando.');
}

module.exports = { iniciar };