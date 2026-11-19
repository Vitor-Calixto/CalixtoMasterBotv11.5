// ============================================================
// ARQUIVO: modulos/email.js
// Envio de e-mails do sistema (redefinição de senha, boas-vindas, teste).
// O remetente (servidor SMTP) é configurado pelo administrador no painel
// e fica salvo em system_config.json, na chave "email".
// ============================================================
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const CONFIG_FILE = path.join(__dirname, '..', 'system_config.json');

function lerConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {}; } catch (e) { return {}; }
}

// Grava só as chaves informadas, preservando o resto (ex.: "maintenance").
function salvarConfig(parcial) {
    const atual = lerConfig();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...atual, ...parcial }, null, 2));
}

function configEmail() {
    const c = lerConfig().email || {};
    return {
        host: c.host || '',
        porta: Number(c.porta) || 465,
        seguro: c.seguro !== false,
        usuario: c.usuario || '',
        senha: c.senha || '',
        nomeRemetente: c.nomeRemetente || 'Calixto OmniSystem',
        emailRemetente: c.emailRemetente || c.usuario || ''
    };
}

const emailConfigurado = () => { const c = configEmail(); return !!(c.host && c.usuario && c.senha); };

// Endereço público do site, usado nos links enviados por e-mail.
// Vem da configuração do admin; sem ele, usa o endereço da requisição.
function urlDoSite(req) {
    const salvo = String(lerConfig().siteUrl || '').trim().replace(/\/+$/, '');
    if (salvo) return salvo;
    return `${req.protocol}://${req.get('host')}`;
}

function transportador() {
    const c = configEmail();
    return nodemailer.createTransport({
        host: c.host, port: c.porta, secure: c.seguro,
        auth: { user: c.usuario, pass: c.senha },
        connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000
    });
}

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function moldura(titulo, corpoHtml) {
    return `<!doctype html><html><body style="margin:0;background:#f5f7f4;font-family:Arial,Helvetica,sans-serif;color:#16211c">
      <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #dfe5e0;border-radius:14px;padding:32px">
          <tr><td>
            <div style="font-weight:700;font-size:18px;margin-bottom:20px">Calixto OmniSystem</div>
            <h1 style="font-size:22px;margin:0 0 14px">${escHtml(titulo)}</h1>
            ${corpoHtml}
          </td></tr>
        </table>
        <p style="font-size:12px;color:#7a8a82;margin-top:16px">E-mail automático. Não é preciso responder.</p>
      </td></tr></table></body></html>`;
}

const botao = (url, texto) =>
    `<p style="margin:26px 0"><a href="${escHtml(url)}" style="background:#128c6b;color:#fff;text-decoration:none;padding:13px 22px;border-radius:999px;font-weight:bold;display:inline-block">${escHtml(texto)}</a></p>`;

async function enviar({ para, assunto, html, texto }) {
    if (!emailConfigurado()) throw new Error('O envio de e-mails ainda não foi configurado pelo administrador.');
    const c = configEmail();
    await transportador().sendMail({
        from: { name: c.nomeRemetente, address: c.emailRemetente || c.usuario },
        to: para, subject: assunto, html, text: texto
    });
}

function enviarRedefinicao({ para, nome, link }) {
    return enviar({
        para,
        assunto: 'Redefinir sua senha',
        texto: `Olá, ${nome}!\n\nPara criar uma nova senha, abra este link (vale por 1 hora):\n${link}\n\nSe não foi você que pediu, ignore este e-mail.`,
        html: moldura('Redefinir sua senha',
            `<p style="line-height:1.6">Olá, ${escHtml(nome)}! Recebemos um pedido para redefinir a senha da sua conta.</p>
             ${botao(link, 'Criar nova senha')}
             <p style="line-height:1.6;color:#4b5a53;font-size:14px">O link vale por 1 hora e só pode ser usado uma vez. Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.</p>`)
    });
}

function enviarBoasVindas({ para, nome, link, senhaProvisoria }) {
    return enviar({
        para,
        assunto: 'Seu acesso ao Calixto OmniSystem',
        texto: `Olá, ${nome}!\n\nSua conta foi criada.\nEntre em: ${link}\nE-mail: ${para}\nSenha provisória: ${senhaProvisoria}\n\nNo primeiro acesso você vai criar a sua própria senha.`,
        html: moldura('Sua conta está pronta',
            `<p style="line-height:1.6">Olá, ${escHtml(nome)}! Sua conta no Calixto OmniSystem foi criada.</p>
             <p style="line-height:1.8;background:#f5f7f4;border-radius:10px;padding:14px 16px;margin:18px 0">
               E-mail: <b>${escHtml(para)}</b><br>Senha provisória: <b>${escHtml(senhaProvisoria)}</b></p>
             ${botao(link, 'Entrar')}
             <p style="line-height:1.6;color:#4b5a53;font-size:14px">No primeiro acesso você vai criar a sua própria senha.</p>`)
    });
}

function enviarTeste({ para }) {
    return enviar({
        para,
        assunto: 'Teste de envio - Calixto OmniSystem',
        texto: 'Se você recebeu esta mensagem, o envio de e-mails está funcionando.',
        html: moldura('Envio funcionando', '<p style="line-height:1.6">Se você recebeu esta mensagem, os e-mails de redefinição de senha vão chegar normalmente.</p>')
    });
}

module.exports = {
    lerConfig, salvarConfig, configEmail, emailConfigurado, urlDoSite,
    enviarRedefinicao, enviarBoasVindas, enviarTeste
};
