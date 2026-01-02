const userState = new Map(); 

/**
 * Calcula um delay aleatório baseado no tamanho do texto
 * Simula uma pessoa lendo e digitando.
 */
function calcularTempoDeDigitacao(texto) {
    const tempoBase = 1500; // Mínimo de 1.5 segundos para qualquer msg
    const tempoPorCaractere = 60; // 60ms por letra (velocidade média de digitação)
    
    let tempoTotal = tempoBase + (texto.length * tempoPorCaractere);
    
    // Adiciona uma pequena variação aleatória (±10%) para não ficar robótico exato
    const variacao = (Math.random() * 0.2) + 0.9; 
    
    return Math.floor(tempoTotal * variacao);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function processarMensagem(clienteId, remoteJid, textoMsg, sock, prisma) {
    const userNum = remoteJid.replace(/\D/g, ''); 

    // 1. BUSCAR DADOS
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    if (!cliente || !cliente.fluxoJson) return;
    const { nodes, connections } = cliente.fluxoJson;
    if (!nodes || nodes.length === 0) return;

    // 2. ESTADO DO USUÁRIO
    let estadoAtualId = userState.get(userNum);
    let proximoNo = null;

    // --- INÍCIO ---
    if (!estadoAtualId) {
        proximoNo = nodes.find(n => n.type === 'start');
        if (!proximoNo) return; // Se não tiver start, não faz nada
    } 
    // --- RESPOSTA DO USUÁRIO ---
    else {
        const noAtual = nodes.find(n => n.id === estadoAtualId);
        
        if (noAtual) {
            // Se estava em MENU
            if (noAtual.type === 'menu') {
                const opcao = textoMsg.trim();
                
                // Tenta achar conexão (opt-1, opt-2...)
                const conexao = connections.find(c => 
                    c.source === noAtual.id && c.handle === `opt-${opcao}`
                );

                if (conexao) {
                    proximoNo = nodes.find(n => n.id === conexao.target);
                } else {
                    // Feedback de erro (rápido)
                    await enviarTexto(sock, remoteJid, "⚠️ *Opção inválida.*\nDigite apenas o número da opção desejada.");
                    return; 
                }
            } 
            // Se estava em OUTRO bloco
            else {
                const conexao = connections.find(c => c.source === noAtual.id);
                if (conexao) {
                    proximoNo = nodes.find(n => n.id === conexao.target);
                } else {
                    userState.delete(userNum); // Fim do fluxo
                }
            }
        } else {
            userState.delete(userNum); // Nó deletado, reinicia
            processarMensagem(clienteId, remoteJid, textoMsg, sock, prisma);
            return;
        }
    }

    // --- EXECUÇÃO ---
    if (proximoNo) {
        await executarNoRecursivo(proximoNo, nodes, connections, sock, remoteJid, userNum);
    }
}

async function executarNoRecursivo(node, nodes, connections, sock, remoteJid, userNum) {
    if(!node) return;

    userState.set(userNum, node.id);

    // 1. MENSAGEM / START
    if (node.type === 'start' || node.type === 'mensagem') {
        const texto = node.data.texto || "Olá!";
        
        // Envia com Delay Humano
        await enviarComDelay(sock, remoteJid, texto);

        // Avança automaticamente
        const proximaConexao = connections.find(c => c.source === node.id);
        if (proximaConexao) {
            const proximoNo = nodes.find(n => n.id === proximaConexao.target);
            await executarNoRecursivo(proximoNo, nodes, connections, sock, remoteJid, userNum);
        }
    }

    // 2. MENU (Menu Bonito)
    else if (node.type === 'menu') {
        const titulo = node.data.texto || "Escolha uma opção";
        
        // Formatação Estilo WhatsApp
        let menuTexto = `*${titulo}*\n\n`; // Negrito no título
        
        if (node.data.options && node.data.options.length > 0) {
            node.data.options.forEach((opt, idx) => {
                // Emoji de número ou ponto
                menuTexto += `*${idx + 1}.* ${opt}\n`;
            });
        }
        menuTexto += `\n_Digite o número da opção:_`; // Instrução em itálico

        await enviarComDelay(sock, remoteJid, menuTexto);
        // Para aqui e espera resposta
    }

    // 3. CONDIÇÃO
    else if (node.type === 'condicao') {
        const agora = new Date();
        // Ajuste fuso horário se necessário: agora.setHours(agora.getHours() - 3); 
        
        const minutosAtuais = agora.getHours() * 60 + agora.getMinutes();
        
        const [hIn, mIn] = (node.data.inicio || "09:00").split(':').map(Number);
        const [hFim, mFim] = (node.data.fim || "18:00").split(':').map(Number);
        
        const inicio = hIn * 60 + mIn;
        const fim = hFim * 60 + mFim;

        const estaAberto = minutosAtuais >= inicio && minutosAtuais < fim;
        const handleSaida = estaAberto ? 'true' : 'false';
        
        const proximaConexao = connections.find(c => 
            c.source === node.id && c.handle === handleSaida
        );

        if (proximaConexao) {
            const proximoNo = nodes.find(n => n.id === proximaConexao.target);
            // Delay pequeno só para processar, sem digitar
            await delay(500); 
            await executarNoRecursivo(proximoNo, nodes, connections, sock, remoteJid, userNum);
        }
    }

    // 4. FINALIZAR
    else if (node.type === 'finalizar') {
        await enviarComDelay(sock, remoteJid, "Atendimento finalizado. Obrigado! 👋");
        userState.delete(userNum);
    }

    // 5. TRANSFERIR
    else if (node.type === 'transferir') {
        const setor = node.data.fila || "um atendente";
        await enviarComDelay(sock, remoteJid, `⏳ Aguarde um momento, estou transferindo para *${setor}*...`);
        // Aqui o bot pararia de responder e notificaria um humano
    }
}

/**
 * Função Auxiliar: Simula a digitação e envia
 */
async function enviarComDelay(sock, jid, texto) {
    const tempo = calcularTempoDeDigitacao(texto);

    // 1. Status: Digitando...
    await sock.sendPresenceUpdate('composing', jid);
    
    // 2. Espera o tempo calculado
    await delay(tempo);

    // 3. Status: Parou
    await sock.sendPresenceUpdate('paused', jid);

    // 4. Envia
    await sock.sendMessage(jid, { text: texto });
}

// Simples helper para mensagens de sistema (sem delay longo)
async function enviarTexto(sock, jid, texto) {
    await sock.sendMessage(jid, { text: texto });
}

module.exports = { processarMensagem };