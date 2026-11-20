// ============================================================================
// Envio de mensagens no Direct do Instagram
// Funciona com os dois jeitos de conectar:
//  - Login do Instagram (token do Instagram)  -> graph.instagram.com
//  - Login do Facebook (token da Página)      -> graph.facebook.com
// ============================================================================
const axios = require('axios');

const IG_GRAPH = 'https://graph.instagram.com/v26.0';
const FB_GRAPH = 'https://graph.facebook.com/v20.0';

// Tokens de Página do Facebook começam com "EAA"; os do Login do Instagram, não.
const hostDoToken = (token) => (String(token || '').startsWith('EAA') ? FB_GRAPH : IG_GRAPH);

async function enviarTexto(token, destinatario, texto) {
    if (!token) throw new Error('Instagram sem token: conecte a conta de novo.');
    const corpo = { recipient: { id: String(destinatario) }, message: { text: String(texto || '').slice(0, 1000) } };
    const cabecalhos = { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 };
    const principal = hostDoToken(token);
    try {
        return (await axios.post(`${principal}/me/messages`, corpo, cabecalhos)).data;
    } catch (e) {
        // Token não reconhecido nesse endereço: tenta o outro antes de desistir
        const erro = e.response && e.response.data && e.response.data.error;
        const tokenRecusado = e.response && (e.response.status === 400 || e.response.status === 401) && erro && (erro.code === 190 || erro.type === 'OAuthException');
        if (!tokenRecusado) throw e;
        const outro = principal === IG_GRAPH ? FB_GRAPH : IG_GRAPH;
        return (await axios.post(`${outro}/me/messages`, corpo, cabecalhos)).data;
    }
}

module.exports = { enviarTexto, IG_GRAPH, FB_GRAPH, hostDoToken };
