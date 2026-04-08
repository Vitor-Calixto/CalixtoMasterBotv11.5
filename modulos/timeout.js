// ============================================================
// ARQUIVO: modulos/timeout.js (CRON DE SEGUNDO PLANO V12)
// ============================================================
const sessions = require('./sessions');
const engine = require('./engine');
const whatsapp = require('./whatsapp'); 

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient(); 

// 🚦 SEMÁFORO ANTI-ENGARRAFAMENTO
// Impede que o cron rode uma nova varredura se a anterior ainda não terminou
let isRodando = false;

async function verificarTimeouts() {
   // Se o sinal estiver vermelho (já tem uma varredura acontecendo), cancela essa!
   if (isRodando) return; 
   isRodando = true; // Acende o sinal vermelho

   try {
       const chaves = await sessions.listarSessoesAtivas();
       const agora = Date.now();
       
       // Filtro de duplicação: Garante que não processe a mesma pessoa 2x no mesmo segundo
       const processados = new Set(); 

       for (const chave of chaves) {
           const userNum = chave.split(':')[1];
           
           if (processados.has(userNum)) continue;
           processados.add(userNum);

           const sessao = await sessions.getSessaoCompleta(userNum);
           if (!sessao) continue; // Prevenção contra sessões corrompidas
           
           // ========================================================
           // 🛡️ TRAVA DE OURO: BLINDAGEM DO MODO #PAUSE
           // ========================================================
           const estaPausado = await sessions.isPausado(userNum);
           if (estaPausado) {
               // Converte para texto com segurança para o IF nunca falhar
               const tempoAtual = String(sessao.timeoutAt || '').trim();
               
               // Só salva se não estiver desativado!
               if (tempoAtual !== 'DESATIVADO') {
                   await sessions.salvarDadosUsuario(userNum, 'timeoutAt', 'DESATIVADO');
               }
               continue; // Pula o cliente pausado e mantém silêncio no terminal
           }

           // ========================================================
           // ⏰ VERIFICAÇÃO DO RELÓGIO (SÓ PARA QUEM NÃO ESTÁ PAUSADO)
           // ========================================================
           const tempoAtual = String(sessao.timeoutAt || '').trim();
           if (tempoAtual && tempoAtual !== 'DESATIVADO' && tempoAtual !== 'null') {
               
               const tempoLimite = Number(tempoAtual);
               if (isNaN(tempoLimite)) continue; // Segurança extra

               // 4. BINGO! O relógio virou.
               if (agora > tempoLimite) {
                   
                   // TRAVA 1: FANTASMAS DO PASSADO (QUEDAS DE SERVIDOR)
                   const tempoEstourado = agora - tempoLimite;
                   if (tempoEstourado > 600000) { // 600.000 ms = 10 minutos
                       console.log(`[CRON TIMEOUT] 👻 Sessão fantasma de ${userNum} ignorada silenciosamente.`);
                       await sessions.limparSessao(userNum);
                       continue;
                   }

                   // TRAVA 2: ANTI-LOOP (Finaliza a conversa e bloqueia repetição)
                   await sessions.salvarDadosUsuario(userNum, 'timeoutAt', 'DESATIVADO');

                   const sock = whatsapp.sessoes.get(sessao.clienteId);
                   
                   if (sock) {
                       await engine.executarTimeout(
                           userNum, 
                           sessao.clienteId, 
                           sessao.remoteJid, 
                           sessao.nodeId, 
                           prisma, 
                           sock,
                           "Cliente"
                       );
                   } else {
                       await sessions.limparSessao(userNum);
                   }
               }
           }
       }
   } catch (e) {
       console.error("[CRON TIMEOUT] ❌ Erro ao varrer sessões:", e.message);
   } finally {
       // A varredura acabou. Fica verde para a próxima rodada!
       isRodando = false; 
   }
}

function iniciar() {
   setInterval(verificarTimeouts, 5000); 
   console.log('⏰ [CRON] Monitor de Timeouts e Delays V12 ativado e rodando.');
}

module.exports = { iniciar };