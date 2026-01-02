// modulos/fluxo.js
const moment = require('moment');

// Função auxiliar para checar horário
function estaNoHorario() {
    const agora = moment();
    const inicio = moment().set({ hour: 8, minute: 0 });
    const fim = moment().set({ hour: 18, minute: 0 });
    const diaSemana = agora.day(); // 0=Dom, 6=Sab
    // Seg(1) a Sex(5)
    if (diaSemana >= 1 && diaSemana <= 5) return agora.isBetween(inicio, fim);
    return false;
}

// O processador agora recebe o "fluxoDoCliente" inteiro
function processarPasso(etapaKey, bot, numeroUsuario, fluxoDoCliente) {
    // Se o cliente não tem fluxo configurado, retorna nulo ou erro
    if (!fluxoDoCliente || !fluxoDoCliente[etapaKey]) return null;

    const passo = fluxoDoCliente[etapaKey];

    // 1. Horário
    if (passo.tipo === 'verificar_horario') {
        const proximo = estaNoHorario() ? passo.next_aberto : passo.next_fechado;
        // Recursão: já chama o próximo passo imediatamente
        return processarPasso(proximo, bot, numeroUsuario, fluxoDoCliente);
    }

    // 2. Texto
    if (passo.tipo === 'texto' || passo.tipo === 'menu') {
        let opcoesTexto = "";
        // Se for menu, monta as opções visualmente
        if (passo.opcoes && Array.isArray(passo.opcoes)) {
            opcoesTexto = "\n" + passo.opcoes.map(o => `${o.id}. ${o.texto}`).join("\n");
        }
        
        bot.sendMessage(numeroUsuario, { text: passo.mensagem + opcoesTexto });
        return passo.next || null; // Retorna o ID do próximo passo (ou null se for esperar resposta)
    }

    // 3. Mídia
    if (passo.tipo === 'midia') {
        bot.sendMessage(numeroUsuario, { 
            image: { url: passo.arquivo }, // Certifique-se que a URL/Caminho existe
            caption: passo.mensagem 
        });
        return passo.next;
    }

    return null;
}

module.exports = { processarPasso };