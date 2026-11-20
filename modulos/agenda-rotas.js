// ============================================================================
// ROTAS DA AGENDA
// - Painel (dono do bot): eventos, criar/mover/bloquear, horário de atendimento
// - Página pública /agendar/:token: o contato escolhe o horário pelo link
//   que o robô mandou no WhatsApp/Instagram
// ============================================================================
const agenda = require('./agenda');

const CORES = ['#039be5', '#33b679', '#8e24aa', '#e67c73', '#f6bf26', '#f4511e', '#3f51b5', '#0b8043', '#d50000', '#616161'];
const MINUTO = 60 * 1000;

function registrarRotas(app, deps) {
    const { prisma, isAuth, exigirPermissao, exigirDonoDoBot, exigirDonoDoLembrete, whatsapp, engine, sessions } = deps;
    const permAgenda = exigirPermissao ? exigirPermissao('agenda') : (req, res, next) => next();
    const seguro = (fn) => async (req, res) => {
        try { await fn(req, res); }
        catch (e) { console.error('[AGENDA] Erro:', e.message); if (!res.headersSent) res.status(500).json({ success: false, error: 'Não foi possível concluir. Tente de novo.' }); }
    };
    const numeroVisivel = (n) => String(n || '').split('@')[0].replace(/\D/g, '');

    // ------------------------------------------------------------- painel -----
    app.get('/dashboard/agenda', isAuth, permAgenda, seguro(async (req, res) => {
        const robos = await prisma.cliente.findMany({ where: { donoId: req.session.userId }, orderBy: { criadoEm: 'asc' } });
        const bots = robos.map((c, i) => ({
            id: c.id, nome: c.nome, numero: c.numero || '', plataforma: c.plataforma, cor: CORES[i % CORES.length],
            horario: agenda.configDe(c), resumo: agenda.resumoHorario(c),
            numeroNotificacao: numeroVisivel(c.numeroNotificacao), tempoLembrete1: c.tempoLembrete1, tempoLembrete2: c.tempoLembrete2
        }));
        res.render('agenda', { bots, duracoes: agenda.DURACOES });
    }));

    const meusBots = async (req) => (await prisma.cliente.findMany({ where: { donoId: req.session.userId }, select: { id: true, horarioAtendimento: true, usarHorarioComercial: true } }));

    function paraEvento(l, cfgPorBot) {
        const cfg = cfgPorBot[l.clienteId] || agenda.padraoLegado();
        const bloqueio = l.status === 'BLOQUEADO';
        const ini = new Date(l.dataAgendada);
        const fim = l.fim ? new Date(l.fim) : new Date(+ini + cfg.duracao * MINUTO);
        return {
            id: String(l.id), botId: l.clienteId, tipo: bloqueio ? 'bloqueio' : 'agendamento',
            title: bloqueio ? (l.mensagem && !/HORÁRIO RESTRITO/.test(l.mensagem) ? l.mensagem : 'Indisponível') : (l.nome || 'Agendamento'),
            start: ini.toISOString(), end: fim.toISOString(),
            nome: l.nome || '', numero: bloqueio ? '' : (l.numero || ''), cpf: l.cpf && !['S/N', 'BLOQUEIO'].includes(l.cpf) ? l.cpf : '',
            status: l.status, manual: l.mensagem === 'Agendamento Manual'
        };
    }

    app.get('/api/agenda/eventos', isAuth, permAgenda, seguro(async (req, res) => {
        const bots = await meusBots(req);
        const cfgPorBot = Object.fromEntries(bots.map(b => [b.id, agenda.configDe(b)]));
        const inicio = new Date(req.query.inicio || Date.now() - 31 * 24 * 3600 * 1000);
        const fim = new Date(req.query.fim || Date.now() + 62 * 24 * 3600 * 1000);
        if (isNaN(inicio) || isNaN(fim)) return res.status(400).json({ success: false, error: 'Período inválido.' });
        const lista = await prisma.lembrete.findMany({
            where: {
                clienteId: { in: bots.map(b => b.id) }, dataAgendada: { lt: fim },
                OR: [{ dataAgendada: { gte: new Date(+inicio - 4 * 3600 * 1000) } }, { fim: { gt: inicio } }]
            },
            orderBy: { dataAgendada: 'asc' }
        });
        res.json(lista.map(l => paraEvento(l, cfgPorBot)));
    }));

    // Conflitos com outros eventos do mesmo bot no período
    async function conflitos(clienteId, ini, fim, ignorarId) {
        const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
        const cfg = agenda.configDe(cliente);
        const ocup = await agenda.ocupacoes(prisma, clienteId, +ini, +fim, cfg.duracao);
        return ocup.filter(o => o.id !== ignorarId && o.ini < +fim && o.fim > +ini);
    }

    function lerPeriodo(body, cliente) {
        const ini = new Date(body.inicio);
        if (isNaN(ini)) return { erro: 'Escolha a data e a hora.' };
        let fim = body.fim ? new Date(body.fim) : new Date(+ini + agenda.configDe(cliente).duracao * MINUTO);
        if (isNaN(fim) || +fim <= +ini) return { erro: 'O fim precisa ser depois do início.' };
        if (+fim - +ini > 14 * 24 * 3600 * 1000) return { erro: 'O período pode ter no máximo 14 dias.' };
        return { ini, fim };
    }

    // Novo agendamento manual
    app.post('/api/agenda/eventos', isAuth, permAgenda, exigirDonoDoBot(req => req.body && req.body.clienteId), seguro(async (req, res) => {
        const b = req.body || {};
        const cliente = await prisma.cliente.findUnique({ where: { id: String(b.clienteId) } });
        const nome = String(b.nome || '').trim().slice(0, 80);
        const numero = agenda.normalizarNumero(b.whatsapp);
        if (!nome) return res.status(400).json({ success: false, error: 'Digite o nome da pessoa.' });
        if (numero.length < 12 || numero.length > 13) return res.status(400).json({ success: false, error: 'Digite o WhatsApp com DDD, ex: 21 99999-0000.' });
        const p = lerPeriodo(b, cliente);
        if (p.erro) return res.status(400).json({ success: false, error: p.erro });
        const choque = await conflitos(cliente.id, p.ini, p.fim);
        if (choque.length && !b.forcar) return res.status(409).json({ success: false, conflito: true, error: 'Já existe algo marcado nesse horário.' });
        const usaDuracaoPadrao = +p.fim - +p.ini === agenda.configDe(cliente).duracao * MINUTO;
        const l = await prisma.lembrete.create({
            data: { nome, numero, cpf: String(b.cpf || '').replace(/\D/g, '').slice(0, 11) || 'S/N', dataAgendada: p.ini, fim: usaDuracaoPadrao ? null : p.fim, clienteId: cliente.id, status: 'PENDENTE', mensagem: 'Agendamento Manual' }
        });
        res.json({ success: true, id: l.id });
    }));

    // Bloquear um período (almoço, folga, feriado...)
    app.post('/api/agenda/bloqueios', isAuth, permAgenda, exigirDonoDoBot(req => req.body && req.body.clienteId), seguro(async (req, res) => {
        const b = req.body || {};
        const cliente = await prisma.cliente.findUnique({ where: { id: String(b.clienteId) } });
        const p = lerPeriodo(b, cliente);
        if (p.erro) return res.status(400).json({ success: false, error: p.erro });
        const motivo = String(b.motivo || '').trim().slice(0, 60) || 'Indisponível';
        const l = await prisma.lembrete.create({
            data: { numero: 'SISTEMA', cpf: 'BLOQUEIO', status: 'BLOQUEADO', mensagem: motivo, dataAgendada: p.ini, fim: p.fim, clienteId: cliente.id }
        });
        res.json({ success: true, id: l.id });
    }));

    // Mover ou editar
    app.put('/api/agenda/eventos/:id', isAuth, permAgenda, exigirDonoDoLembrete(req => req.params.id), seguro(async (req, res) => {
        const b = req.body || {};
        const atual = await prisma.lembrete.findUnique({ where: { id: req.params.id } });
        const cliente = await prisma.cliente.findUnique({ where: { id: atual.clienteId } });
        const bloqueio = atual.status === 'BLOQUEADO';
        const dados = {};
        if (b.inicio) {
            const p = lerPeriodo(b, cliente);
            if (p.erro) return res.status(400).json({ success: false, error: p.erro });
            const choque = await conflitos(cliente.id, p.ini, p.fim, atual.id);
            if (choque.length && !b.forcar) return res.status(409).json({ success: false, conflito: true, error: 'Já existe algo marcado nesse horário.' });
            const padrao = +p.fim - +p.ini === agenda.configDe(cliente).duracao * MINUTO;
            dados.dataAgendada = p.ini;
            dados.fim = bloqueio || !padrao ? p.fim : null;
            // Mudou o horário: os lembretes voltam a ser enviados
            if (!bloqueio && +p.ini !== +new Date(atual.dataAgendada)) { dados.status = 'PENDENTE'; dados.lembreteEnviado = false; }
        }
        if (bloqueio && b.motivo !== undefined) dados.mensagem = String(b.motivo).trim().slice(0, 60) || 'Indisponível';
        if (!bloqueio) {
            if (b.nome !== undefined) {
                const nome = String(b.nome).trim().slice(0, 80);
                if (!nome) return res.status(400).json({ success: false, error: 'Digite o nome da pessoa.' });
                dados.nome = nome;
            }
            if (b.whatsapp !== undefined) {
                const numero = agenda.normalizarNumero(b.whatsapp);
                if (numero.length < 12 || numero.length > 13) return res.status(400).json({ success: false, error: 'Digite o WhatsApp com DDD.' });
                dados.numero = numero;
            }
        }
        await prisma.lembrete.update({ where: { id: atual.id }, data: dados });
        res.json({ success: true });
    }));

    // Horário de atendimento de um bot
    app.post('/api/agenda/horario/:id', isAuth, permAgenda, exigirDonoDoBot(req => req.params.id), seguro(async (req, res) => {
        let cfg;
        try { cfg = agenda.validarConfig(req.body && req.body.horario); }
        catch (e) { return res.status(400).json({ success: false, error: e.message }); }
        const atualizado = await prisma.cliente.update({ where: { id: req.params.id }, data: { horarioAtendimento: cfg } });
        res.json({ success: true, horario: cfg, resumo: agenda.resumoHorario(atualizado) });
    }));

    // Avisos: número do gestor e quando lembrar o cliente
    app.post('/api/agenda/avisos/:id', isAuth, permAgenda, exigirDonoDoBot(req => req.params.id), seguro(async (req, res) => {
        const b = req.body || {};
        const numero = agenda.normalizarNumero(b.numeroDono);
        if (numero && (numero.length < 12 || numero.length > 13)) return res.status(400).json({ success: false, error: 'Digite o WhatsApp do gestor com DDD.' });
        const t1 = Math.round(Number(b.tempoLembrete1)), t2 = Math.round(Number(b.tempoLembrete2) || 0);
        if (!(t1 >= 1 && t1 <= 168)) return res.status(400).json({ success: false, error: 'O primeiro lembrete deve ser entre 1 e 168 horas antes.' });
        if (t2 < 0 || t2 > 168 || (t2 && t2 >= t1)) return res.status(400).json({ success: false, error: 'O segundo lembrete precisa ser mais perto do horário que o primeiro (ou 0 para desligar).' });
        await prisma.cliente.update({ where: { id: req.params.id }, data: { numeroNotificacao: numero ? numero + '@s.whatsapp.net' : null, tempoLembrete1: t1, tempoLembrete2: t2 } });
        res.json({ success: true });
    }));

    // ------------------------------------------------- página pública -----
    async function lerConvite(token) {
        const dados = agenda.lerToken(token);
        if (!dados) return { estado: 'invalido' };
        if (dados.expirado) return { estado: 'expirado' };
        const cliente = await prisma.cliente.findUnique({ where: { id: String(dados.c) } });
        if (!cliente) return { estado: 'invalido' };
        return { estado: 'ok', dados, cliente };
    }
    const assinaturaDe = (token) => String(token).split('.')[1] || '';

    app.get('/agendar/:token', seguro(async (req, res) => {
        const c = await lerConvite(req.params.token);
        res.set('Cache-Control', 'no-store');
        if (c.estado !== 'ok') return res.status(c.estado === 'expirado' ? 410 : 404).render('agendar', { estado: c.estado, negocio: null, token: null, nome: '', voltar: null, resumo: '' });
        const dadosSessao = (sessions && await sessions.getDadosUsuario(c.dados.u).catch(() => ({}))) || {};
        const numeroBot = String(c.cliente.numero || '').replace(/\D/g, '');
        res.render('agendar', {
            estado: 'ok', negocio: c.cliente.nome, token: req.params.token,
            nome: dadosSessao.nome_cliente || dadosSessao.nome || '',
            voltar: c.dados.o === 'INSTAGRAM' ? 'https://ig.me/m/' + (c.cliente.instagramUser || '') : (numeroBot ? 'https://wa.me/' + numeroBot : null),
            resumo: agenda.resumoHorario(c.cliente)
        });
    }));

    app.get('/api/agendar/:token/horarios', seguro(async (req, res) => {
        const c = await lerConvite(req.params.token);
        if (c.estado !== 'ok') return res.status(410).json({ success: false, error: 'Este link expirou. Peça um novo na conversa.' });
        const cfg = agenda.configDe(c.cliente);
        const dias = await agenda.proximosDias(prisma, c.cliente, { quantidade: 400 });
        res.set('Cache-Control', 'no-store');
        res.json({
            success: true, duracao: cfg.duracao, hoje: agenda.chaveDe(Date.now()), ultimo: agenda.somarDias(agenda.chaveDe(Date.now()), cfg.diasAFrente),
            dias: dias.map(d => ({ chave: d.chave, horas: d.livres.map(x => ({ hora: agenda.hora(x), inicio: x.toISOString() })) }))
        });
    }));

    app.post('/api/agendar/:token', seguro(async (req, res) => {
        const c = await lerConvite(req.params.token);
        if (c.estado !== 'ok') return res.status(410).json({ success: false, error: 'Este link expirou. Peça um novo na conversa.' });
        const { dados, cliente } = c;
        const nome = String((req.body && req.body.nome) || '').trim().slice(0, 80);
        if (nome.length < 2) return res.status(400).json({ success: false, error: 'Digite seu nome.' });
        const dadosSessao = (await sessions.getDadosUsuario(dados.u).catch(() => ({}))) || {};
        if (dadosSessao.agenda_link_usado === assinaturaDe(req.params.token)) {
            return res.status(409).json({ success: false, usado: true, error: 'Você já marcou um horário por este link. Para marcar outro, peça um novo link na conversa.' });
        }
        const inicio = new Date(req.body && req.body.inicio);
        const numero = dadosSessao.telefone_lembrete || (dados.o === 'INSTAGRAM' ? '' : String(dados.u).split('@')[0]);
        const r = await agenda.reservar(prisma, cliente, { data: inicio, nome, numero, cpf: dadosSessao.cpf_cliente || dadosSessao.cpf || dadosSessao.cpf_usuario });
        if (!r.ok) {
            const msg = { ocupado: 'Esse horário acabou de ser reservado. Escolha outro.', fechado: 'Esse horário está fora do atendimento.', passado: 'Esse horário já passou. Escolha outro.', longe: 'Essa data ainda não está aberta.', invalido: 'Escolha um horário da lista.' };
            return res.status(409).json({ success: false, motivo: r.motivo, error: msg[r.motivo] || msg.invalido });
        }
        await sessions.salvarDadosUsuario(dados.u, 'agenda_link_usado', assinaturaDe(req.params.token));
        await sessions.salvarDadosUsuario(dados.u, 'agenda_estado', null);
        await sessions.salvarDadosUsuario(dados.u, 'data_agendamento', `${agenda.dataCurta(inicio)} ${agenda.hora(inicio)}`);
        if (!dadosSessao.nome_cliente) await sessions.salvarDadosUsuario(dados.u, 'nome_cliente', nome);

        // Confirma na conversa e segue o fluxo do robô
        const sock = whatsapp && whatsapp.sessoes ? whatsapp.sessoes.get(cliente.id) : null;
        const igToken = cliente.instagramToken;
        agenda.avisarGestor(sock, cliente, `🚀 *NOVO AGENDAMENTO (link)*\n\n👤 *Cliente:* ${r.lembrete.nome}\n📅 *Data:* ${agenda.dataBR(inicio)}\n🕒 *Horário:* ${agenda.hora(inicio)}\n📱 *Contato:* ${r.lembrete.numero || 'Instagram'}`);
        try {
            if (sock || dados.o === 'INSTAGRAM') {
                await engine.enviarMensagemOmni(sock, dados.j, `✅ *Agendamento confirmado!*\n\n📅 ${agenda.textoCompleto(inicio)}\n\nVamos te mandar um lembrete antes. Até lá! 👋`, dados.o, igToken);
            }
            const etapa = await sessions.getEtapaUsuario(dados.u);
            const no = cliente.fluxoJson && cliente.fluxoJson.drawflow && cliente.fluxoJson.drawflow.Home && cliente.fluxoJson.drawflow.Home.data[dados.q];
            const proximo = no && no.outputs && no.outputs.output_1 && no.outputs.output_1.connections && no.outputs.output_1.connections[0] && no.outputs.output_1.connections[0].node;
            if (String(etapa) === String(dados.q) && proximo && (sock || dados.o === 'INSTAGRAM')) {
                engine.executarNo(proximo, cliente.fluxoJson, sock, dados.j, dados.u, cliente.id, prisma, nome, dados.o, igToken)
                    .catch(e => console.error('[AGENDA] Falha ao seguir o fluxo:', e.message));
            }
        } catch (e) { console.error('[AGENDA] Reserva feita, mas a confirmação na conversa falhou:', e.message); }

        res.json({ success: true, quando: agenda.textoCompleto(inicio) });
    }));
}

module.exports = { registrarRotas, CORES };
