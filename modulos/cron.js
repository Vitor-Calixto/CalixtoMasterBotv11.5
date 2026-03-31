const cron = require('node-cron');

/**
 * ============================================================================
 * MOTOR DE LEMBRETES AUTOMÁTICOS (CRON JOB)
 * ============================================================================
 * Descrição:
 * Este script é o "Vigia" que roda em segundo plano. Ele não depende que o 
 * cliente envie mensagem. Ele acorda a cada 1 minuto, checa o banco de dados
 * e dispara os lembretes via WhatsApp respeitando a configuração do SaaS.
 * ============================================================================
 */
function iniciarMonitorDeLembretes(prisma, sessoes) {
    
    // 🛡️ TRAVA DE SEGURANÇA 1: Impede o cron de iniciar se não houver banco
    if (!prisma || !prisma.lembrete) {
        console.error("❌ Erro Crítico: Tabela 'lembrete' não encontrada no Prisma.");
        return;
    }

    // ⏱️ EXPRESSÃO CRON: Roda no segundo 0 de todo minuto ('* * * * *')
    cron.schedule('* * * * *', async () => {
        const agora = new Date();

        try {
            // ================================================================
            // PASSO 1: VARREDURA NO BANCO DE DADOS
            // ================================================================
            // Puxa apenas lembretes futuros que estão nos status PENDENTE ou LEMBRETE_1
            const lembretes = await prisma.lembrete.findMany({
                where: { 
                    status: { in: ['PENDENTE', 'LEMBRETE_1'] },
                    dataAgendada: { gte: agora } 
                }
            });

            // Se não houver nada agendado, morre em silêncio poupando memória RAM
            if (lembretes.length === 0) return;

            // ================================================================
            // PASSO 2: PROCESSAMENTO DO FLUXO DO CLIENTE
            // ================================================================
            for (const item of lembretes) {
                
                // Puxa a conexão de WhatsApp vinculada à clínica/gestor dono da agenda
                const sock = sessoes.get(item.clienteId); 
                if (!sock) {
                    console.log(`⚠️ [CRON] Bot do cliente ${item.clienteId} offline. Lembrete ignorado nesta rodada.`);
                    continue; 
                }

                // Carrega a configuração feita no painel (Front-end) pelo Gestor
                const cliente = await prisma.cliente.findUnique({
                    where: { id: item.clienteId }
                });

                if (!cliente) continue;
                
                // Converte as horas do painel em minutos para a matemática do Cron
                const t1 = (cliente.tempoLembrete1 || 24) * 60; // Padrão: 1440 min (24h)
                const t2 = (cliente.tempoLembrete2 || 0) * 60;  // Padrão: 0 (Desativado)

                // Calcula a distância entre AGORA e a hora da CONSULTA em minutos
                const diffMinutos = Math.round((item.dataAgendada.getTime() - agora.getTime()) / 60000);

                // DEBUG LOG: Mantido para você acompanhar o monitoramento via terminal
                console.log(`\n⏰ [CRON DEBUG] Analisando: ${item.nome}`);
                console.log(`   ⏱️ Faltam: ${diffMinutos} minutos para a consulta.`);
                console.log(`   🎯 Alvo do Painel: ${t1} minutos.`);

                let enviarAgora = false;
                let proximoStatus = item.status;
                let mensagemTempo = "";

                // ================================================================
                // PASSO 3: REGRAS DE GATILHO (JANELAS DE TEMPO)
                // ================================================================
                
                // GATILHO 1: Primeiro Lembrete (Com margem de segurança de 2 min)
                if (item.status === 'PENDENTE' && Math.abs(diffMinutos - t1) <= 2) {
                    enviarAgora = true;
                    proximoStatus = t2 > 0 ? 'LEMBRETE_1' : 'ENVIADO'; 
                    // Se o alerta for de 24h ou mais, o bot escreve "amanhã" na msg
                    mensagemTempo = t1 >= 1440 ? "*amanhã*" : `em *${cliente.tempoLembrete1} horas*`;
                } 
                // GATILHO 2: Segundo Lembrete (Reforço Final)
                else if ((item.status === 'PENDENTE' || item.status === 'LEMBRETE_1') && t2 > 0 && Math.abs(diffMinutos - t2) <= 2) {
                    enviarAgora = true;
                    proximoStatus = 'ENVIADO'; // Encerra a jornada deste lembrete
                    mensagemTempo = `em *${cliente.tempoLembrete2} horas*`;
                }

                // ================================================================
                // PASSO 4: VALIDAÇÃO DE JID E DISPARO DA MENSAGEM
                // ================================================================
                if (enviarAgora) {
                    let numLimpo = String(item.numero).replace(/\D/g, '');
                    if (numLimpo.length === 10 || numLimpo.length === 11) numLimpo = '55' + numLimpo;

                    // Cria as possibilidades de número (Com o 9 e Sem o 9)
                    let jidTentativa1 = numLimpo + '@s.whatsapp.net';
                    let jidTentativa2 = null;

                    if (numLimpo.startsWith('55') && numLimpo.length === 13) {
                        jidTentativa2 = numLimpo.slice(0, 4) + numLimpo.slice(5) + '@s.whatsapp.net'; // Tira o 9
                    } else if (numLimpo.startsWith('55') && numLimpo.length === 12) {
                        jidTentativa2 = numLimpo.slice(0, 4) + '9' + numLimpo.slice(4) + '@s.whatsapp.net'; // Põe o 9
                    }

                    let jidFinal = jidTentativa1;

                    // 🛡️ INTELIGÊNCIA META: Pergunta ao WhatsApp qual JID o usuário realmente usa
                    try {
                        const [res1] = await sock.onWhatsApp(jidTentativa1);
                        if (res1 && res1.exists) {
                            jidFinal = res1.jid;
                        } else if (jidTentativa2) {
                            const [res2] = await sock.onWhatsApp(jidTentativa2);
                            if (res2 && res2.exists) {
                                jidFinal = res2.jid;
                            }
                        }
                    } catch (e) {
                        console.warn(`⚠️ [CRON] Não foi possível validar o JID na Meta, usando padrão...`);
                    }

                    // Formatação Visual para o Cliente
                    const dataF = item.dataAgendada.toLocaleDateString('pt-BR');
                    const horaF = item.dataAgendada.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

                    const textoMensagem = `🔔 *LEMBRETE DE CONSULTA*\n\n` +
                        `Olá, *${item.nome}*! Passando para lembrar que sua consulta está agendada para ${mensagemTempo}.\n\n` +
                        `📅 *Data:* ${dataF}\n` +
                        `🕒 *Hora:* ${horaF}\n\n` +
                        `Caso precise desmarcar, por favor nos avise.`;

                    // 🚀 DISPARO (Fire and Forget)
                    sock.sendMessage(jidFinal, { text: textoMensagem })
                        .then(async () => {
                            // Só atualiza o banco se o WhatsApp confirmar o envio
                            await prisma.lembrete.update({
                                where: { id: item.id },
                                data: { status: proximoStatus, lembreteEnviado: proximoStatus === 'ENVIADO' }
                            });
                            console.log(`[CRON] ✅ Lembrete enviado para ${jidFinal}`);
                        })
                        .catch(err => {
                            console.error(`[CRON] ❌ Erro ao enviar lembrete para ${jidFinal}:`, err.message);
                        });
                } 
            } // Fechamento do For(lembretes)
        
        } catch (errorGlobal) {
            // Se o Prisma ou o JS quebrarem, o erro para aqui e não mata o Cron geral
            console.error("❌ Erro fatal no monitor de lembretes:", errorGlobal.message);
        }

    }); // Fechamento do cron.schedule
} // Fechamento da função iniciarMonitorDeLembretes

module.exports = { iniciarMonitorDeLembretes };