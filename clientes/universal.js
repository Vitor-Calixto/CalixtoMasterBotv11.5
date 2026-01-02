// CÉREBRO UNIVERSAL - VERSÃO GAVETAS 🗄️

const memorias = {}; 

function processarResposta(mensagem, plataforma, idUsuario, configBot) {
    if (!mensagem) return null;
    const texto = mensagem.toLowerCase().trim();
    const chaveMemoria = `${configBot.id}_${idUsuario}`;

    // -----------------------------------------------------------
    // 🪄 A MÁGICA: Seleciona a gaveta certa (whatsapp, instagram ou telegram)
    // -----------------------------------------------------------
    let textos = configBot[plataforma]; 

    // Segurança: Se você esqueceu de criar a gaveta do instagram, usa a do whatsapp pra não travar
    if (!textos) textos = configBot['whatsapp'];
    // -----------------------------------------------------------

    // Reset
    if (texto === '0' || texto === 'menu' || texto === 'voltar') {
        memorias[chaveMemoria] = 'INICIO';
        return textos.menu; // Pega direto da gaveta selecionada
    }

    if (!memorias[chaveMemoria]) memorias[chaveMemoria] = 'INICIO';
    const etapa = memorias[chaveMemoria];

    if (etapa === 'INICIO') {
        
        if (texto.match(/oi|ola|olá|bom|inicio|start/)) {
            return textos.menu;
        }

        if (texto === '1') {
            return textos.opcao_1;
        }
        
        if (texto === '2') {
            return textos.opcao_2;
        }
    }

    return null;
}

module.exports = { processarResposta };