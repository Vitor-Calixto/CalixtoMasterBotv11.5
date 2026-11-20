// ============================================================================
// AGENDA: horário de atendimento, horários livres e reservas
// Tudo é calculado no fuso de São Paulo, independente do fuso do servidor.
// ============================================================================
const crypto = require('crypto');

const TZ = 'America/Sao_Paulo';
const DURACOES = [10, 15, 20, 30, 40, 45, 60, 90, 120];
const SEMANA_CURTA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const SEMANA_LONGA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MINUTO = 60 * 1000;

let segredo = null;
function init(opcoes = {}) { segredo = opcoes.segredo || segredo; }

// ---------------------------------------------------------------- fuso -----
const formatador = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
function partes(data) {
    const o = {};
    for (const p of formatador.formatToParts(new Date(data))) o[p.type] = p.value;
    return { ano: +o.year, mes: +o.month, dia: +o.day, h: +o.hour % 24, m: +o.minute };
}
// Data/hora "de parede" em São Paulo -> instante real
function dataLocal(ano, mes, dia, h = 0, m = 0) {
    const alvo = Date.UTC(ano, mes - 1, dia, h, m);
    let t = alvo;
    for (let i = 0; i < 3; i++) {
        const p = partes(t);
        const visto = Date.UTC(p.ano, p.mes - 1, p.dia, p.h, p.m);
        if (visto === alvo) break;
        t += alvo - visto;
    }
    return new Date(t);
}
const doisDig = (n) => String(n).padStart(2, '0');
const chaveDe = (data) => { const p = partes(data); return `${p.ano}-${doisDig(p.mes)}-${doisDig(p.dia)}`; };
const separarChave = (chave) => chave.split('-').map(Number);
function somarDias(chave, n) {
    const [a, m, d] = separarChave(chave);
    const x = new Date(Date.UTC(a, m - 1, d + n));
    return `${x.getUTCFullYear()}-${doisDig(x.getUTCMonth() + 1)}-${doisDig(x.getUTCDate())}`;
}
const diaDaSemana = (chave) => { const [a, m, d] = separarChave(chave); return new Date(Date.UTC(a, m - 1, d)).getUTCDay(); };
const inicioDoDia = (chave) => { const [a, m, d] = separarChave(chave); return dataLocal(a, m, d, 0, 0); };
const paraMinutos = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
const deMinutos = (min) => `${doisDig(Math.floor(min / 60))}:${doisDig(min % 60)}`;

// ---------------------------------------------------------- formatação -----
const hora = (data) => { const p = partes(data); return `${doisDig(p.h)}:${doisDig(p.m)}`; };
const dataCurta = (data) => { const p = partes(data); return `${doisDig(p.dia)}/${doisDig(p.mes)}`; };
const dataBR = (data) => { const p = partes(data); return `${doisDig(p.dia)}/${doisDig(p.mes)}/${p.ano}`; };
function rotuloDia(chave, hoje = chaveDe(Date.now())) {
    const [, m, d] = separarChave(chave);
    const base = `${SEMANA_CURTA[diaDaSemana(chave)]} ${doisDig(d)}/${doisDig(m)}`;
    if (chave === hoje) return `Hoje, ${base}`;
    if (chave === somarDias(hoje, 1)) return `Amanhã, ${base}`;
    return base.charAt(0).toUpperCase() + base.slice(1);
}
function textoCompleto(data) {
    return `${SEMANA_LONGA[diaDaSemana(chaveDe(data))]}, ${dataCurta(data)} às ${hora(data)}`;
}

// ------------------------------------------------------- configuração -----
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

function padraoLegado(cliente) {
    const comercial = !cliente || cliente.usarHorarioComercial !== false;
    const dias = {};
    for (let d = 0; d < 7; d++) {
        dias[d] = comercial ? { ativo: d !== 0, inicio: '08:00', fim: '18:00' } : { ativo: true, inicio: '00:00', fim: '24:00' };
    }
    return { duracao: 30, dias, almoco: { ativo: false, inicio: '12:00', fim: '13:00' }, antecedencia: 60, diasAFrente: 30 };
}

// Lê a configuração salva no bot (ou a antiga: comercial seg-sáb 08-18)
function configDe(cliente) {
    const base = padraoLegado(cliente);
    const salvo = cliente && cliente.horarioAtendimento && typeof cliente.horarioAtendimento === 'object' ? cliente.horarioAtendimento : null;
    if (!salvo) return base;
    try { return validarConfig(salvo); } catch (e) { return base; }
}

// Valida o que vem do painel; lança Error com mensagem amigável
function validarConfig(entrada) {
    const e = entrada || {};
    const duracao = Number(e.duracao);
    if (!DURACOES.includes(duracao)) throw new Error('Escolha uma duração de atendimento válida.');
    const dias = {};
    let algumAberto = false;
    for (let d = 0; d < 7; d++) {
        const x = (e.dias && (e.dias[d] || e.dias[String(d)])) || {};
        const ativo = !!x.ativo;
        const inicio = String(x.inicio || '08:00'), fim = String(x.fim || '18:00');
        if (ativo) {
            if (!HHMM.test(inicio) || !HHMM.test(fim)) throw new Error(`Horário inválido na ${SEMANA_LONGA[d]}.`);
            if (paraMinutos(fim) - paraMinutos(inicio) < duracao) throw new Error(`Na ${SEMANA_LONGA[d]}, o fim precisa ser depois do início (com espaço para pelo menos um atendimento).`);
            algumAberto = true;
        }
        dias[d] = { ativo, inicio, fim };
    }
    if (!algumAberto) throw new Error('Deixe pelo menos um dia da semana aberto.');
    const a = e.almoco || {};
    const almoco = { ativo: !!a.ativo, inicio: String(a.inicio || '12:00'), fim: String(a.fim || '13:00') };
    if (almoco.ativo && (!HHMM.test(almoco.inicio) || !HHMM.test(almoco.fim) || paraMinutos(almoco.fim) <= paraMinutos(almoco.inicio))) {
        throw new Error('O intervalo precisa terminar depois de começar.');
    }
    const antecedencia = Math.max(0, Math.min(10080, Math.round(Number(e.antecedencia) || 0)));
    const diasAFrente = Math.max(1, Math.min(180, Math.round(Number(e.diasAFrente) || 30)));
    return { duracao, dias, almoco, antecedencia, diasAFrente };
}

// ------------------------------------------------------------ ocupação -----
async function ocupacoes(prisma, clienteId, inicio, fim, duracao) {
    const lista = await prisma.lembrete.findMany({
        where: {
            clienteId,
            dataAgendada: { lt: new Date(fim) },
            OR: [{ dataAgendada: { gte: new Date(+inicio - 4 * 60 * MINUTO) } }, { fim: { gt: new Date(inicio) } }]
        },
        select: { id: true, dataAgendada: true, fim: true }
    });
    return lista.map(l => {
        const ini = +new Date(l.dataAgendada);
        const f = l.fim ? +new Date(l.fim) : ini + duracao * MINUTO;
        return { id: l.id, ini, fim: Math.max(f, ini + MINUTO) };
    });
}

function horariosDoDia(cfg, chave, ocup, agora = Date.now()) {
    const d = cfg.dias[diaDaSemana(chave)];
    if (!d || !d.ativo) return [];
    const [a, m, dia] = separarChave(chave);
    const ini = paraMinutos(d.inicio), fim = paraMinutos(d.fim);
    const almIni = paraMinutos(cfg.almoco.inicio), almFim = paraMinutos(cfg.almoco.fim);
    const limite = agora + cfg.antecedencia * MINUTO;
    const livres = [];
    for (let t = ini; t + cfg.duracao <= fim; t += cfg.duracao) {
        if (cfg.almoco.ativo && t < almFim && t + cfg.duracao > almIni) continue;
        const s = dataLocal(a, m, dia, Math.floor(t / 60), t % 60);
        const sMs = +s, eMs = sMs + cfg.duracao * MINUTO;
        if (sMs < limite) continue;
        if (ocup.some(o => o.ini < eMs && o.fim > sMs)) continue;
        livres.push(s);
    }
    return livres;
}

const ultimoDia = (cfg, agora) => somarDias(chaveDe(agora), cfg.diasAFrente);

async function livresNoDia(prisma, cliente, chave, agora = Date.now()) {
    const cfg = configDe(cliente);
    if (chave < chaveDe(agora) || chave > ultimoDia(cfg, agora)) return [];
    const ini = inicioDoDia(chave), fim = inicioDoDia(somarDias(chave, 1));
    return horariosDoDia(cfg, chave, await ocupacoes(prisma, cliente.id, ini, fim, cfg.duracao), agora);
}

// Próximos dias com horário livre: [{ chave, rotulo, livres: [Date] }]
async function proximosDias(prisma, cliente, { quantidade = 7, agora = Date.now(), ate = null } = {}) {
    const cfg = configDe(cliente);
    const hoje = chaveDe(agora);
    const fimChave = ate || ultimoDia(cfg, agora);
    const ocup = await ocupacoes(prisma, cliente.id, inicioDoDia(hoje), inicioDoDia(somarDias(fimChave, 1)), cfg.duracao);
    const dias = [];
    for (let chave = hoje; chave <= fimChave && dias.length < quantidade; chave = somarDias(chave, 1)) {
        const livres = horariosDoDia(cfg, chave, ocup, agora);
        if (livres.length) dias.push({ chave, rotulo: rotuloDia(chave, hoje), livres });
    }
    return dias;
}

// Confere se um horário específico pode ser reservado
async function verificarHorario(prisma, cliente, data, agora = Date.now()) {
    const cfg = configDe(cliente);
    const inst = new Date(data);
    if (isNaN(inst)) return { ok: false, motivo: 'invalido' };
    const chave = chaveDe(inst);
    const d = cfg.dias[diaDaSemana(chave)];
    const p = partes(inst), min = p.h * 60 + p.m;
    if (+inst < agora + cfg.antecedencia * MINUTO) return { ok: false, motivo: 'passado' };
    if (chave > ultimoDia(cfg, agora)) return { ok: false, motivo: 'longe' };
    if (!d.ativo || min < paraMinutos(d.inicio) || min + cfg.duracao > paraMinutos(d.fim)) return { ok: false, motivo: 'fechado' };
    if (cfg.almoco.ativo && min < paraMinutos(cfg.almoco.fim) && min + cfg.duracao > paraMinutos(cfg.almoco.inicio)) return { ok: false, motivo: 'fechado' };
    const ocup = await ocupacoes(prisma, cliente.id, +inst, +inst + cfg.duracao * MINUTO, cfg.duracao);
    if (ocup.some(o => o.ini < +inst + cfg.duracao * MINUTO && o.fim > +inst)) return { ok: false, motivo: 'ocupado' };
    return { ok: true };
}

function normalizarNumero(n) {
    let limpo = String(n || '').replace(/\D/g, '');
    if (limpo.length === 10 || limpo.length === 11) limpo = '55' + limpo;
    return limpo;
}

async function reservar(prisma, cliente, { data, nome, numero, cpf }) {
    const v = await verificarHorario(prisma, cliente, data);
    if (!v.ok) return v;
    const nomeF = String(nome || 'Cliente').trim().slice(0, 80) || 'Cliente';
    const lembrete = await prisma.lembrete.create({
        data: { numero: normalizarNumero(numero), nome: nomeF, cpf: cpf || 'S/N', mensagem: `Confirmado: ${nomeF}`, dataAgendada: new Date(data), clienteId: cliente.id }
    });
    return { ok: true, lembrete };
}

// "Seg a Sáb, das 08:00 às 18:00" — usado nas mensagens de ajuda
function resumoHorario(cliente) {
    const cfg = configDe(cliente);
    const abertos = [0, 1, 2, 3, 4, 5, 6].filter(d => cfg.dias[d].ativo);
    const iguais = abertos.every(d => cfg.dias[d].inicio === cfg.dias[abertos[0]].inicio && cfg.dias[d].fim === cfg.dias[abertos[0]].fim);
    const nome = (d) => SEMANA_CURTA[d].charAt(0).toUpperCase() + SEMANA_CURTA[d].slice(1);
    const seguidos = abertos.length > 2 && abertos.every((d, i) => i === 0 || d === abertos[i - 1] + 1);
    const dias = abertos.length === 7 ? 'Todos os dias' : seguidos ? `${nome(abertos[0])} a ${nome(abertos[abertos.length - 1])}` : abertos.map(nome).join(', ');
    if (!iguais) return dias;
    const d0 = cfg.dias[abertos[0]];
    return d0.inicio === '00:00' && d0.fim === '24:00' ? `${dias}, a qualquer hora` : `${dias}, das ${d0.inicio} às ${d0.fim}`;
}

// ------------------------------------------------- texto digitado -----
// Entende "hoje", "amanhã", "25/11", "25/11/2026" e, opcionalmente, "14:30", "14h", "14h30"
function interpretarTexto(texto, agora = Date.now()) {
    const t = String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    if (!t) return null;
    const hoje = chaveDe(agora);
    let chave = null;
    const mData = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (mData) {
        const dia = +mData[1], mes = +mData[2];
        if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return { invalido: true };
        let ano = mData[3] ? (mData[3].length === 2 ? 2000 + +mData[3] : +mData[3]) : +hoje.slice(0, 4);
        const teste = new Date(Date.UTC(ano, mes - 1, dia));
        if (teste.getUTCMonth() !== mes - 1) return { invalido: true };
        chave = `${ano}-${doisDig(mes)}-${doisDig(dia)}`;
        if (!mData[3] && chave < hoje) chave = `${ano + 1}-${doisDig(mes)}-${doisDig(dia)}`;
    } else if (/\bdepois de amanha\b/.test(t)) chave = somarDias(hoje, 2);
    else if (/\bamanha\b/.test(t)) chave = somarDias(hoje, 1);
    else if (/\bhoje\b/.test(t)) chave = hoje;
    if (!chave) return null;
    const resto = mData ? t.replace(mData[0], ' ') : t;
    const mHora = resto.match(/\b(\d{1,2})\s*(?::|h)\s*(\d{2})?\b|\b(\d{1,2})\s*horas?\b/);
    if (!mHora) return { chave };
    const h = +(mHora[1] || mHora[3]), m = +(mHora[2] || 0);
    if (h > 23 || m > 59) return { invalido: true };
    const [a, mes, d] = separarChave(chave);
    return { chave, data: dataLocal(a, mes, d, h, m) };
}

// ------------------------------------------------------- link assinado -----
const b64 = (s) => Buffer.from(s).toString('base64url');
function assinar(payload) {
    if (!segredo) throw new Error('agenda.init({ segredo }) não foi chamado');
    return crypto.createHmac('sha256', segredo).update(payload).digest('base64url').slice(0, 22);
}
// Gera o código do link de agendamento ligado a um contato e a uma conversa.
// Compacto para o link não ficar enorme no WhatsApp.
const SUFIXO_WA = '@s.whatsapp.net';
function criarToken(dados, validadeHoras = 48) {
    const c = { c: dados.c, q: dados.q, e: Math.floor((Date.now() + validadeHoras * 3600 * 1000) / 1000).toString(36) };
    c.u = String(dados.u || '').endsWith(SUFIXO_WA) ? String(dados.u).slice(0, -SUFIXO_WA.length) : '~' + dados.u;
    if (dados.j && dados.j !== dados.u) c.j = dados.j;
    if (dados.o === 'INSTAGRAM') c.o = 'I';
    const payload = b64(JSON.stringify(c));
    return `${payload}.${assinar(payload)}`;
}
function lerToken(token) {
    const [payload, assinatura] = String(token || '').split('.');
    if (!payload || !assinatura || !segredo) return null;
    const esperado = assinar(payload);
    const a = Buffer.from(assinatura), b = Buffer.from(esperado);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!c.e || Date.now() > parseInt(c.e, 36) * 1000) return { expirado: true };
        const u = String(c.u || '').startsWith('~') ? String(c.u).slice(1) : String(c.u) + SUFIXO_WA;
        return { c: c.c, q: c.q, u, j: c.j || u, o: c.o === 'I' ? 'INSTAGRAM' : 'WHATSAPP' };
    } catch (e) { return null; }
}

// --------------------------------------------------- aviso ao gestor -----
async function avisarGestor(sock, cliente, texto) {
    if (!cliente || !cliente.numeroNotificacao || !sock) return;
    let numG = String(cliente.numeroNotificacao).replace(/\D/g, '');
    if (numG.length === 10 || numG.length === 11) numG = '55' + numG;
    const candidatos = [numG];
    if (numG.startsWith('55') && numG.length === 13) candidatos.push(numG.slice(0, 4) + numG.slice(5));
    else if (numG.startsWith('55') && numG.length === 12) candidatos.push(numG.slice(0, 4) + '9' + numG.slice(4));
    let jid = candidatos[0] + '@s.whatsapp.net';
    try {
        for (const c of candidatos) {
            const [r] = (await sock.onWhatsApp(c + '@s.whatsapp.net')) || [];
            if (r && r.exists) { jid = r.jid; break; }
        }
    } catch (e) {}
    sock.sendMessage(jid, { text: texto }).catch(e => console.error('❌ Falha ao avisar gestor:', e.message));
}

module.exports = {
    TZ, DURACOES, SEMANA_CURTA, SEMANA_LONGA, init,
    partes, dataLocal, chaveDe, somarDias, diaDaSemana, inicioDoDia, paraMinutos, deMinutos,
    hora, dataCurta, dataBR, rotuloDia, textoCompleto,
    configDe, validarConfig, padraoLegado, resumoHorario,
    ocupacoes, horariosDoDia, livresNoDia, proximosDias, verificarHorario, reservar, normalizarNumero,
    interpretarTexto, criarToken, lerToken, avisarGestor
};
