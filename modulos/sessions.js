// ============================================================
// ARQUIVO: modulos/sessions.js
// DESCRIÇÃO: Gerencia o estado (memória) de onde cada usuário está no fluxo
// ============================================================

const usuarios = {}; // Memória RAM: { '552199...': 'node_5' }
const pausas = {};   // Memória RAM: { '552199...': true }

module.exports = {
    // Retorna o ID do nó atual do usuário (ou null se não tiver)
    getEtapaUsuario: (id) => usuarios[id] || null,

    // Define o novo nó do usuário
    setEtapaUsuario: (id, etapa) => {
        usuarios[id] = etapa;
    },

    // Pausa o bot para esse usuário (ex: atendimento humano)
    setPausa: (id, status) => {
        pausas[id] = status;
    },

    // Verifica se está pausado
    isPausado: (id) => !!pausas[id],

    // Limpa tudo (útil para testes)
    limparSessao: (id) => {
        delete usuarios[id];
        delete pausas[id];
    }
};