// ============================================================
// ARQUIVO: modulos/engine.js
// DESCRIÇÃO: V5 - LÓGICA INTELIGENTE (AUTO-DETECÇÃO DE SAÍDAS)
// ============================================================

function findNode(fluxo, nodeId) {
    if (!fluxo || !fluxo.drawflow || !fluxo.drawflow.Home || !fluxo.drawflow.Home.data) return null;
    return fluxo.drawflow.Home.data[nodeId];
}

function findStartNode(fluxo) {
    if (!fluxo || !fluxo.drawflow || !fluxo.drawflow.Home || !fluxo.drawflow.Home.data) return null;
    const nodes = fluxo.drawflow.Home.data;
    for (const key in nodes) {
        if (nodes[key].name === 'inicio') return nodes[key];
    }
    return null;
}

// Busca o ID do nó conectado a uma saída específica
function getConnectedNodeId(node, outputKey) {
    if (!node || !node.outputs || !node.outputs[outputKey]) return null;
    const connections = node.outputs[outputKey].connections;
    if (connections.length > 0) return connections[0].node;
    return null;
}

// Descobre qual é a chave da saída de ERRO (A última disponível)
function findErrorOutputKey(node) {
    if (!node.outputs) return null;
    
    // Pega todas as chaves de saída (output_1, output_2, output_4...)
    const keys = Object.keys(node.outputs).sort((a, b) => {
        // Ordena numericamente: output_1 < output_10
        const numA = parseInt(a.replace('output_', ''));
        const numB = parseInt(b.replace('output_', ''));
        return numA - numB;
    });

    if (keys.length === 0) return null;

    // A lógica é: A saída de erro é SEMPRE a última bolinha do nó visual
    return keys[keys.length - 1];
}

async function executarPasso(idAtual, fluxo, inputUsuario) {
    let node = null;
    console.log(`\n[ENGINE] 🔍 Analisando ID: ${idAtual || 'INICIO'}`);

    if (!idAtual) {
        const startNode = findStartNode(fluxo);
        if (!startNode) return null;
        
        // No início, pega a primeira conexão que existir
        const keys = Object.keys(startNode.outputs);
        if(keys.length === 0) return null;
        const nextId = getConnectedNodeId(startNode, keys[0]);
        
        if (!nextId) return null;
        node = findNode(fluxo, nextId);
    } else {
        node = findNode(fluxo, idAtual);
    }

    if (!node) return null;

    console.log(`[ENGINE] ▶️ Nó: ${node.name} (ID: ${node.id})`);

    // --- TIPOS SIMPLES ---
    if (['mensagem', 'midia', 'audio'].includes(node.name)) {
        // Pega a primeira saída disponível
        const keys = Object.keys(node.outputs);
        const nextId = keys.length > 0 ? getConnectedNodeId(node, keys[0]) : null;

        return {
            tipo: node.name === 'mensagem' ? 'texto' : node.name,
            mensagem: node.data.message || "",
            url: node.data.url || "",
            caption: node.data.caption || "",
            ptt: node.data.ptt !== false,
            proximoId: nextId,
            parar: false
        };
    }

    if (node.name === 'finalizar') {
        return { parar: true, proximoId: null };
    }

    // --- MENU (AGORA MAIS INTELIGENTE) ---
    if (node.name === 'menu') {
        
        // RESPOSTA DO USUÁRIO
        if (inputUsuario) {
            const num = parseInt(inputUsuario.trim());
            
            // 1. TENTA ACHAR A OPÇÃO CORRESPONDENTE
            if (!isNaN(num) && num > 0) {
                // Verifica se existe texto configurado para essa opção
                if (node.data[`opcao${num}`]) {
                    // Tenta a saída padrão: output_1, output_2...
                    const outputKey = `output_${num}`;
                    const nextId = getConnectedNodeId(node, outputKey);
                    
                    if (nextId) {
                        console.log(`[ENGINE] ✅ Opção ${num} válida -> Indo para nó ${nextId}`);
                        return { tipo: 'processando', proximoId: nextId, parar: false };
                    } else {
                        console.log(`[ENGINE] ⚠️ Usuário escolheu ${num}, mas 'output_${num}' não está conectada.`);
                    }
                }
            }

            // 2. CAMINHO DE ERRO / INVÁLIDO
            console.log(`[ENGINE] ❌ Opção inválida/desconectada: "${inputUsuario}"`);
            
            if (node.data['invalid-active']) {
                // Procura a ÚLTIMA saída disponível no nó
                const errorKey = findErrorOutputKey(node);
                console.log(`[ENGINE] 🔍 Tentando saída de erro na chave: ${errorKey}`);
                
                if (errorKey) {
                    const errorNextId = getConnectedNodeId(node, errorKey);
                    
                    // Verifica se não estamos mandando para o mesmo lugar de uma opção válida (evita loop errado)
                    // (Opcional, mas bom para debug)
                    
                    if (errorNextId) {
                        console.log(`[ENGINE] 🔀 Redirecionando para fluxo de Erro.`);
                        return { tipo: 'processando', proximoId: errorNextId, parar: false };
                    }
                }
                console.log(`[ENGINE] ⚠️ Fluxo de erro ativo, mas sem conexão.`);
            }

            // Fallback (Se não tiver linha de erro desenhada)
            return {
                tipo: 'texto',
                mensagem: "⚠️ Opção inválida. Digite apenas o número.",
                manterNoAtual: true, 
                parar: true
            };
        } 
        
        // EXIBIÇÃO DO MENU
        else {
            let textoMenu = node.data.question || "Escolha uma opção:";
            // Varre até 10 opções (limite de segurança)
            for(let i=1; i<=10; i++) {
                if(node.data[`opcao${i}`]) {
                    textoMenu += `\n${i}. ${node.data[`opcao${i}`]}`;
                }
            }

            return {
                tipo: 'texto',
                mensagem: textoMenu,
                idAtual: node.id.toString(),
                parar: true
            };
        }
    }

    return null;
}

module.exports = { executarPasso };