/**
 * CenaDrop Bot — suporte (fórum #suporte ↔ #chamados do Staff)
 *
 * 1. Cliente abre post no #suporte → o bot responde com até 2 respostas da base
 *    (base-conhecimento.json, gerada de PRODUTOS/CenaDrop Flow/suporte/base-conhecimento.md)
 *    + botões "✅ Resolveu" / "🙋 Ainda preciso de ajuda".
 * 2. "Ainda preciso" → entra na FILA: cartão no post do cliente com a posição (se atualiza
 *    sozinho) + chamado no #chamados do Staff com licença e diagnóstico D-XXXX.
 * 3. A equipe responde dentro do chamado no Staff → o bot repassa ao cliente como
 *    "Equipe CenaDrop". `//` no começo = nota interna (não vai). `!resolvido` fecha.
 * 4. O que o cliente escreve no post (com chamado aberto) aparece no chamado do Staff.
 * 6. FLUXO NOVO (19/10/26 — "um lugar só"): TODO post do #suporte vira chamado no Staff na hora.
 *    🤖 "Bot respondeu" = o bot deu a resposta da base e espera o aluno (você vê o que ele disse).
 *    Vai pra 🟡 Na fila sozinho quando: o aluno clica 🙋, OU escreve de novo no post, OU o post já
 *    chega com código D-XXXX (problema técnico: a base não resolve). Post antigo sem chamado e não
 *    resolvido (ficou "no limbo") é puxado pra fila ao ligar o bot.
 * 5. Diagnóstico enviado sem chamado → o #diagnosticos chama abrirChamadoDoDiagnostico() e o bot
 *    abre o post no #suporte EM NOME do aluno (o dono real fica em `donoDe`, lido da menção do post).
 *    Assim toda resposta sai por um lugar só: o #suporte.
 *
 * Estado da fila mora no próprio Discord (rodapé do chamado + etiquetas) → sobrevive a reinício.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const KB_ARQUIVO = require('./base-conhecimento.json'); // reserva, se o banco não responder

const GUILD_ID    = '1555365917578240130';
const SUPORTE     = '1555372720517283931';   // fórum dos clientes
const CHAMADOS    = '1555372737915134092';   // fórum do Staff
const PAINEL_FILA = '1557072944176439318';   // #fila do Staff
const FAQ         = '1557072936119308338';
const COR = 0x7C3AED;
const PADRAO_DIAG = /\bD-[A-Z2-9]{4}\b/;

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const mascarar = (k) => (k && k.length > 8 ? `${k.slice(0, 3)}…${k.slice(-4)}` : '—');
const linkThread = (g, t) => `https://discord.com/channels/${g}/${t}`;
const haQuanto = (ms) => {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} dias`;
};

// ── busca na base ───────────────────────────────────────────────────────────
// A base mora no banco (tabela suporte_base) desde 07/10/26 — recarregada a cada 5 min
const prepararBase = (lista) => lista.map((e) => ({ ...e, _kw: (e.palavras || []).map(norm).filter((k) => k.length >= 3) }));
let KB_NORM = prepararBase(KB_ARQUIVO);

function procurar(titulo, corpo, assunto) {
  const tt = norm(titulo), tc = norm(corpo);
  const notas = KB_NORM.map((e) => {
    let n = 0;
    for (const k of e._kw) {
      const peso = k.split(/\s+/).length; // frase pesa mais que palavra solta
      if (tt.includes(k)) n += peso * 3;   // o título resume o problema → vale mais
      else if (tc.includes(k)) n += peso;
    }
    if (n > 0 && assunto && e.tag === assunto) n += 2;
    return { e, n };
  }).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  if (!notas.length) return [];
  const [a, b] = notas;
  return b && b.n >= a.n * 0.6 ? [a.e, b.e] : [a.e];
}

module.exports = function suporte(client, { db, logStaff }) {
  async function carregarBase() {
    try {
      const { data, error } = await db().from('suporte_base')
        .select('id, pergunta, tag, palavras, resposta, aprender, links, escalar').eq('ativo', true);
      if (error) throw error;
      if (data?.length) KB_NORM = prepararBase(data);
    } catch (err) {
      console.error('[Suporte] base do banco indisponível, sigo com a última carregada:', err.message);
    }
  }

  // ── memória de atendimentos: cada post resolvido vira um caso (tabela suporte_casos) ──
  const idPorPergunta = (titulo) => KB_NORM.find((e) => `💡 ${e.pergunta}`.slice(0, 256) === titulo)?.id;
  async function salvarCaso(thread, { resolvidoPor, staffId = null }) {
    try {
      const msgs = [...(await thread.messages.fetch({ limit: 100 })).values()].reverse();
      const dono = await donoDe(thread);
      const inicial = await thread.fetchStarterMessage().catch(() => null);
      const conversa = [];
      const respostasBot = new Set();
      for (const m of msgs) {
        if (inicial && m.id === inicial.id) continue;
        if (m.author.id === client.user.id) {
          for (const e of m.embeds) {
            if (e.author?.name === 'Equipe CenaDrop' && e.description) conversa.push({ quem: 'equipe', texto: e.description, quando: m.createdAt.toISOString() });
            const id = e.title && idPorPergunta(e.title);
            if (id) respostasBot.add(id);
          }
          continue;
        }
        if (m.author.bot) continue;
        conversa.push({ quem: m.author.id === dono ? 'cliente' : 'membro', texto: m.content || '(anexo)', quando: m.createdAt.toISOString() });
      }
      const textoTodo = [inicial?.content || '', ...conversa.map((c) => c.texto)].join('\n');
      const codigos = [...new Set([...(codigosDe.get(thread.id) || []), ...(textoTodo.match(new RegExp(PADRAO_DIAG.source, 'g')) || [])])];
      let diagResumo = null;
      if (codigos.length) {
        const { data } = await db().from('cenadrop_diagnosticos').select('codigo, versao, plataforma, resumo, mensagem').in('codigo', codigos);
        diagResumo = (data || []).map((d) => `${d.codigo} · v${d.versao} · ${d.plataforma} · erros: ${d.resumo || 'nenhum'}${d.mensagem ? ` · recado: "${d.mensagem}"` : ''}`).join('\n') || null;
      }
      const owner = await client.users.fetch(dono).catch(() => null);
      await db().from('suporte_casos').upsert({
        thread_id: thread.id, staff_thread_id: staffId,
        aberto_em: thread.createdAt?.toISOString(), resolvido_em: new Date().toISOString(), resolvido_por: resolvidoPor,
        cliente_discord_id: dono, cliente_nome: owner?.username || null,
        assunto: thread.appliedTags.map((id) => nomeTag(thread.parent, id)).find((n) => n && !STATUS.includes(n)) || null,
        titulo: thread.name, problema: inicial?.content || null, conversa,
        resposta_equipe: conversa.filter((c) => c.quem === 'equipe').map((c) => c.texto).join('\n\n') || null,
        respostas_bot: [...respostasBot], diag_codigos: codigos, diag_resumo: diagResumo,
      }, { onConflict: 'thread_id' });
    } catch (err) {
      console.error('[Suporte] não guardei o caso:', err.message);
    }
  }

  // Post aberto pelo bot a partir de um diagnóstico: o "dono" é o aluno marcado na 1ª mensagem, não o bot
  const donos = new Map(); // customerThreadId → discord id do aluno
  async function donoDe(th) {
    if (donos.has(th.id)) return donos.get(th.id);
    if (th.ownerId !== client.user.id) return th.ownerId;
    const ini = await th.fetchStarterMessage().catch(() => null);
    const id = ini?.content?.match(/<@!?(\d+)>/)?.[1] || th.ownerId;
    donos.set(th.id, id);
    return id;
  }

  // customerThreadId → { staffId, cardId, status: 'bot'|'fila'|'atendimento', criado, titulo, cliente }
  const chamados = new Map();
  const doStaff = new Map(); // staffThreadId → customerThreadId
  const cartaoTexto = new Map(); // cardId → último texto (evita editar à toa)
  const codigosDe = new Map(); // customerThreadId → Set de códigos D-XXXX citados no chamado
  const anotarCodigo = (cid, codigo) => { if (!codigo) return; if (!codigosDe.has(cid)) codigosDe.set(cid, new Set()); codigosDe.get(cid).add(codigo); };

  const tagsDe = (forum) => Object.fromEntries(forum.availableTags.map((t) => [t.name, t.id]));
  const nomeTag = (forum, id) => forum.availableTags.find((t) => t.id === id)?.name;
  const STATUS = ['Na fila', 'Em atendimento', 'Resolvido', 'Bot respondeu'];

  async function marcarStatus(thread, status) {
    try {
      const ids = tagsDe(thread.parent);
      const assuntos = thread.appliedTags.filter((id) => !STATUS.includes(nomeTag(thread.parent, id)));
      const novas = [...assuntos, ids[status]].filter(Boolean).slice(0, 5);
      if (thread.archived) await thread.setArchived(false);
      await thread.setAppliedTags(novas);
    } catch (err) {
      console.error('[Suporte] etiqueta:', err.message);
    }
  }

  // botões de link (vídeo da playlist / seção do manual) de cada resposta — 1 linha por resposta
  const linksDe = (achados) => achados.filter((e) => e.links?.length).map((e) => new ActionRowBuilder().addComponents(
    ...e.links.slice(0, 5).map((l) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(l.label).setEmoji(l.emoji).setURL(l.url)),
  ));

  const botoes = (soFila = false) => [new ActionRowBuilder().addComponents(
    ...(soFila ? [] : [new ButtonBuilder().setCustomId('sup:ok').setStyle(ButtonStyle.Success).setLabel('Resolveu').setEmoji('✅')]),
    new ButtonBuilder().setCustomId('sup:fila').setStyle(ButtonStyle.Primary).setLabel('Ainda preciso de ajuda').setEmoji('🙋'),
  )];

  // Só aparece DEPOIS do "🙋 Ainda preciso de ajuda" e só se o código ainda não veio
  const EMBED_DIAG = {
    title: '📋 Falta só uma coisa: o código do diagnóstico',
    description: 'O código mostra pra equipe exatamente o que aconteceu no seu CenaDrop. Sem ele, a gente teria que te pedir prints e a resposta demora mais.\n\n' +
      '**1.** Abra o Google Flow ou o Vids, no mesmo projeto onde deu o problema.\n' +
      '**2.** O problema aconteceu **nas últimas horas**? Vá pro passo 3. **Já faz mais tempo, ou você fechou o Flow/Vids?** Rode de novo a cena ou o lote até o erro aparecer.\n' +
      '**3.** Logo depois do erro, no painel do CenaDrop, clique em **Diagnóstico** (no rodapé do painel).\n' +
      '**4.** Escreva em uma frase o que aconteceu (ex.: *"parou na cena 10"*) e clique em **Enviar diagnóstico**.\n' +
      '**5.** Clique em **Copiar código** e **cole aqui neste post** (ex.: `D-4KJ9`).\n\n' +
      '✅ Você **não perde a sua posição na fila** enquanto faz isso.',
    color: 0x3B82F6,
  };

  // ── 1. post novo no #suporte ──────────────────────────────────────────────
  client.on('threadCreate', async (thread, novo) => {
    if (!novo || thread.parentId !== SUPORTE) return;
    try {
      let inicial = null;
      for (let i = 0; i < 5 && !inicial; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        inicial = await thread.fetchStarterMessage().catch(() => null);
      }
      if (inicial?.author?.bot) return;
      const dono = await client.users.fetch(thread.ownerId);
      // já veio com o código do diagnóstico → é técnico, a base não resolve: direto pra fila
      if (PADRAO_DIAG.test(`${thread.name} ${inicial?.content || ''}`)) {
        await abrirChamado(thread, dono);
        await logStaff(`📝 Post novo no #suporte com código → direto pra fila · "${thread.name}"`);
        return;
      }
      const assunto = thread.appliedTags.map((id) => nomeTag(thread.parent, id)).find(Boolean);
      const achados = procurar(thread.name, inicial?.content || '', assunto);
      const embeds = achados.length
        ? achados.map((e) => ({
          title: `💡 ${e.pergunta}`.slice(0, 256), description: e.resposta.slice(0, 4000), color: COR,
          ...(e.aprender ? { fields: [{ name: '📚 Pra aprender mais', value: e.aprender.slice(0, 1024) }] } : {}),
        }))
        : [{ title: '🔎 Ainda não tenho uma resposta pronta pra isso', description: `Dá uma olhada no <#${FAQ}> (dá pra buscar). Se não achar, clique em **🙋 Ainda preciso de ajuda** ou escreva aqui mais detalhes, e você entra na fila da equipe.`, color: COR }];
      if (achados.length) embeds.push({ description: 'Não resolveu? Clique em **🙋 Ainda preciso de ajuda** ou escreva aqui o que aconteceu, e você entra na fila da equipe.', color: 0x6B7280 });

      await thread.send({
        content: `Oi <@${thread.ownerId}>! ${achados.length ? 'Veja se isso resolve:' : ''}`,
        embeds: embeds.slice(0, 10),
        components: [...linksDe(achados), ...botoes(!achados.length)],
        allowedMentions: { users: [thread.ownerId] },
      });
      const botResumo = achados.length
        ? achados.map((e) => `💡 **${e.pergunta}**\n${e.resposta.slice(0, 600)}`).join('\n\n')
        : '🔎 Não achou resposta pronta na base (mandou olhar o FAQ).';
      await abrirChamado(thread, dono, { modo: 'bot', botResumo });
      await logStaff(`📝 Post novo no #suporte · ${assunto || 'sem assunto'} · "${thread.name}" · ${achados.length ? `respondido com: ${achados.map((e) => e.id).join(', ')}` : 'sem resposta pronta'}`);
    } catch (err) {
      console.error('[Suporte] threadCreate:', err);
    }
  });

  // ── 2. botões ─────────────────────────────────────────────────────────────
  client.on('interactionCreate', async (inter) => {
    if (!inter.isButton() || !inter.customId.startsWith('sup:')) return;
    const thread = inter.channel;
    try {
      if (inter.customId === 'sup:resolver') { // botão no chamado do Staff
        const cid = doStaff.get(thread.id);
        if (!cid) return inter.reply({ content: 'Este chamado já está fechado.', flags: MessageFlags.Ephemeral });
        await inter.update({ components: [] });
        return resolver(cid, 'equipe');
      }
      if (inter.user.id !== await donoDe(thread)) {
        return inter.reply({ content: 'Só quem abriu este post pode usar esses botões. Se você tem um problema parecido, abra o seu próprio post no #suporte. 🙂', flags: MessageFlags.Ephemeral });
      }
      if (inter.customId === 'sup:ok') {
        await inter.update({ components: [] });
        if (chamados.has(thread.id)) await resolver(thread.id, 'cliente');
        else { await marcarStatus(thread, 'Resolvido'); await salvarCaso(thread, { resolvidoPor: 'bot' }); }
        await thread.send('✅ Que bom que resolveu! Marquei como **resolvido**. Se voltar a acontecer, é só escrever aqui.');
        await logStaff(`✅ Resolvido pela base (cliente clicou) · "${thread.name}"`);
        return;
      }
      if (inter.customId === 'sup:fila') {
        if (chamados.get(thread.id)?.status === 'bot') {
          await inter.update({ components: [] });
          return promover(thread.id, 'clicou em 🙋 Ainda preciso de ajuda');
        }
        if (chamados.has(thread.id)) {
          const pos = posicao(thread.id);
          return inter.reply({ content: pos ? `Você já está na fila: **nº ${pos}**.` : 'A equipe já está cuidando do seu caso. 💬', flags: MessageFlags.Ephemeral });
        }
        await inter.update({ components: [] });
        await abrirChamado(thread, inter.user);
      }
    } catch (err) {
      console.error('[Suporte] botão:', err);
      try { await inter.reply({ content: '😕 Algo deu errado. Tente de novo em instantes.', flags: MessageFlags.Ephemeral }); } catch (_) {}
    }
  });

  // ── fila ──────────────────────────────────────────────────────────────────
  const naFila = () => [...chamados.entries()].filter(([, c]) => c.status === 'fila').sort((a, b) => a[1].criado - b[1].criado);
  const posicao = (id) => { const i = naFila().findIndex(([k]) => k === id); return i < 0 ? null : i + 1; };

  function cartao(status, pos) {
    if (status === 'fila') return { title: `🎫 Você é o nº ${pos} na fila`, description: 'A equipe responde **em ordem de chegada**. Este cartão se atualiza sozinho conforme a fila anda.', color: 0xEAB308 };
    if (status === 'atendimento') return { title: '💬 Em atendimento', description: 'A equipe está cuidando do seu caso. As respostas aparecem aqui embaixo. Pode responder normalmente neste post.', color: 0x3B82F6 };
    return { title: '✅ Resolvido', description: 'Este chamado foi encerrado. Se voltar a acontecer, é só escrever aqui.', color: 0x22C55E };
  }

  const PRAZO_BOT = 3 * 24 * 60 * 60 * 1000;
  async function atualizarFila() {
    for (const [cid, c] of [...chamados.entries()]) {
      if (c.status === 'bot' && Date.now() - c.criado > PRAZO_BOT) await resolver(cid, 'prazo');
    }
    const fila = naFila();
    for (const [cid, c] of chamados) {
      if (!c.cardId) continue;   // 🤖 bot respondeu: ainda sem cartão no post
      const pos = c.status === 'fila' ? fila.findIndex(([k]) => k === cid) + 1 : null;
      const emb = cartao(c.status, pos);
      if (cartaoTexto.get(c.cardId) === emb.title) continue;
      try {
        const th = await client.channels.fetch(cid);
        const msg = await th.messages.fetch(c.cardId);
        await msg.edit({ embeds: [emb] });
        cartaoTexto.set(c.cardId, emb.title);
      } catch (err) {
        console.error('[Suporte] cartão:', err.message);
      }
    }
    // painel do Staff
    try {
      const canal = await client.channels.fetch(PAINEL_FILA);
      const atend = [...chamados.entries()].filter(([, c]) => c.status === 'atendimento');
      const doBot = [...chamados.entries()].filter(([, c]) => c.status === 'bot');
      const linhas = [
        `**🟡 Na fila (${fila.length})**`,
        ...(fila.length ? fila.map(([, c], i) => `${i + 1}. <#${c.staffId}> · ${c.cliente} · esperando há ${haQuanto(c.criado)}`) : ['— ninguém esperando 🎉']),
        '',
        `**💬 Em atendimento (${atend.length})**`,
        ...(atend.length ? atend.map(([, c]) => `• <#${c.staffId}> · ${c.cliente} · aberto há ${haQuanto(c.criado)}`) : ['—']),
        '',
        `**🤖 Bot respondeu, esperando o aluno (${doBot.length})**`,
        ...(doBot.length ? doBot.map(([, c]) => `• <#${c.staffId}> · ${c.cliente} · há ${haQuanto(c.criado)}`) : ['—']),
        '-# se o aluno escrever de novo ou clicar 🙋, vai sozinho pra fila',
        '',
        `-# Atualizado <t:${Math.floor(Date.now() / 1000)}:R> · responda dentro do chamado · \`//\` = nota interna · ✅ no topo do chamado (ou \`!resolvido\`) fecha`,
      ];
      const embed = { title: '📋 Fila de atendimento', description: linhas.join('\n').slice(0, 4000), color: COR };
      const ultimas = await canal.messages.fetch({ limit: 10 });
      const meu = ultimas.find((m) => m.author.id === client.user.id);
      if (meu) await meu.edit({ embeds: [embed] }); else await canal.send({ embeds: [embed] });
    } catch (err) {
      console.error('[Suporte] painel:', err.message);
    }
  }

  async function diagnostico(codigo) {
    if (!codigo) return null;
    const { data } = await db().from('cenadrop_diagnosticos')
      .select('codigo, criado, versao, plataforma, navegador, mensagem, resumo, n_linhas')
      .eq('codigo', codigo).maybeSingle();
    return data;
  }

  const textoDiag = (d, codigo) => {
    if (!codigo) return '⚠️ Não mandou o código ainda';
    if (!d) return `\`${codigo}\` (não encontrado no Admin)`;
    const nav = (d.navegador || '').match(/(Edg|OPR|Brave|Chrome|Firefox|Safari)\/[\d.]+/)?.[0] || '?';
    const so = /Windows/.test(d.navegador) ? 'Windows' : /Mac OS/.test(d.navegador) ? 'Mac' : '?';
    return [`\`${d.codigo}\` · v${d.versao} · ${d.plataforma} · ${so} · ${nav} · ${d.n_linhas} linhas`,
      d.resumo ? `Erros: ${d.resumo}` : null, d.mensagem ? `Recado: "${d.mensagem}"` : null,
      'Abrir em Admin › CenaDrop › Diagnósticos'].filter(Boolean).join('\n').slice(0, 1000);
  };

  async function procurarCodigo(thread) {
    const msgs = await thread.messages.fetch({ limit: 50 });
    for (const m of msgs.values()) {
      if (m.author.bot) continue;
      const c = m.content.match(PADRAO_DIAG);
      if (c) return c[0];
    }
    return null;
  }

  async function abrirChamado(thread, user, { codigoDado = null, modo = 'fila', botResumo = null } = {}) {
    const ehBot = modo === 'bot';
    const card = ehBot ? null : await thread.send({ embeds: [cartao('fila', naFila().length + 1)] });
    // diagnóstico só faz sentido em problema técnico — dúvida de licença/plano não precisa
    const assuntoTag = thread.appliedTags.map((id) => nomeTag(thread.parent, id)).find((n) => n && !STATUS.includes(n));
    // o D-XXXX é da extensão CenaDrop: Elo IA e Narrativa não têm esse diagnóstico
    const inicialTxt = (await thread.fetchStarterMessage().catch(() => null))?.content || '';
    const outroProduto = /\belo\b|elo ia|narrativa/i.test(`${thread.name} ${inicialTxt}`);
    const tecnico = !['Licença e ativação', 'Planos e outros'].includes(assuntoTag) && !outroProduto;
    const jaTem = codigoDado || await procurarCodigo(thread) || thread.name.match(PADRAO_DIAG)?.[0] || null;
    if (ehBot) { /* aluno ainda não pediu a equipe: nada de cartão/pedido de código no post */ }
    else if (jaTem && !codigoDado) await thread.send({ embeds: [{ description: `✅ Recebemos o seu diagnóstico **${jaTem}** — ele já vai junto pra equipe.`, color: 0x22C55E }] });
    else if (tecnico && !jaTem) await thread.send({ embeds: [EMBED_DIAG] });
    const criado = Date.now();
    const { data: lics } = await db().from('licenses')
      .select('key, active, status, source, product').eq('discord_id', user.id);
    const lic = (lics || []).find((l) => l.active !== false && l.status !== 'inactive') || (lics || [])[0];
    const codigo = jaTem;
    const diag = await diagnostico(codigo);
    const inicial = await thread.fetchStarterMessage().catch(() => null);
    const descricao = codigoDado ? `🩺 Chamado aberto pelo bot a partir do diagnóstico ${codigoDado} (o aluno não abriu post).${diag?.mensagem ? `\n\n**Recado do aluno:** "${diag.mensagem}"` : ''}` : inicial?.content;
    const assunto = thread.appliedTags.map((id) => nomeTag(thread.parent, id)).find((n) => n && !STATUS.includes(n));
    const anexos = inicial ? [...inicial.attachments.values()].map((a) => a.url) : [];

    const staffForum = await client.channels.fetch(CHAMADOS);
    const staffTags = tagsDe(staffForum);
    const staff = await staffForum.threads.create({
      name: `${thread.name}`.slice(0, 95),
      appliedTags: [staffTags[ehBot ? 'Bot respondeu' : 'Na fila']].filter(Boolean),
      message: {
        // texto solto = prévia que aparece na lista do fórum
        content: `${ehBot ? '🤖' : '🎫'} **${user.username}** · ${assunto || 'sem assunto'} · ${(descricao || '').replace(/\s+/g, ' ').slice(0, 140)}`,
        allowedMentions: { parse: [] },
        embeds: [{
          title: thread.name.slice(0, 256),
          url: linkThread(GUILD_ID, thread.id),
          description: (descricao || '(sem texto)').slice(0, 3500),
          color: 0xEAB308,
          fields: [
            { name: 'Cliente', value: `**${user.username}** \`${user.id}\``, inline: true },
            { name: 'Assunto', value: assunto || '—', inline: true },
            { name: 'Licença', value: lic ? `${mascarar(lic.key)} · ${lic.source || '—'} · ${lic.active !== false && lic.status !== 'inactive' ? 'ativa ✅' : 'DESATIVADA ⛔'}` : 'sem chave ligada', inline: false },
            { name: 'Diagnóstico', value: textoDiag(diag, codigo), inline: false },
            ...(anexos.length ? [{ name: 'Anexos', value: anexos.slice(0, 5).join('\n').slice(0, 1000) }] : []),
            ...(botResumo ? [{ name: '🤖 O bot respondeu no post', value: botResumo.slice(0, 1024) }] : []),
          ],
          footer: { text: `ref:${thread.id}:${card ? card.id : 0}` },
        }],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('sup:resolver').setStyle(ButtonStyle.Success).setLabel('Marcar como resolvido').setEmoji('✅'),
        )],
      },
    });
    const cliente = user.username;
    chamados.set(thread.id, { staffId: staff.id, cardId: card ? card.id : null, status: ehBot ? 'bot' : 'fila', criado, titulo: thread.name, cliente });
    anotarCodigo(thread.id, codigo);
    doStaff.set(staff.id, thread.id);
    if (codigo) await ligarCartaoDiag(codigo, staff.id);
    if (ehBot) { await atualizarFila(); return; }
    await marcarStatus(thread, 'Na fila');
    await logStaff(`🎫 Novo chamado na fila · **${cliente}** · "${thread.name}" · <#${staff.id}>`);
    await atualizarFila();
  }

  // 🤖 Bot respondeu → 🟡 Na fila (aluno clicou 🙋, escreveu de novo, ou voltou depois)
  async function promover(cid, motivo) {
    const c = chamados.get(cid);
    if (!c || c.status !== 'bot') return;
    c.status = 'fila';
    c.criado = Date.now();   // a ordem da fila conta a partir de quando ele pediu a equipe
    const th = await client.channels.fetch(cid);
    const card = await th.send({ embeds: [cartao('fila', posicao(cid))] });
    c.cardId = card.id;
    cartaoTexto.set(card.id, cartao('fila', posicao(cid)).title);
    // pede o código só se for técnico e ainda não veio
    const assuntoTag = th.appliedTags.map((id) => nomeTag(th.parent, id)).find((n) => n && !STATUS.includes(n));
    const inicialTxt = (await th.fetchStarterMessage().catch(() => null))?.content || '';
    const outroProduto = /\belo\b|elo ia|narrativa/i.test(`${th.name} ${inicialTxt}`);
    const tecnico = !['Licença e ativação', 'Planos e outros'].includes(assuntoTag) && !outroProduto;
    if (tecnico && !(codigosDe.get(cid)?.size) && !(await procurarCodigo(th))) await th.send({ embeds: [EMBED_DIAG] });
    await marcarStatus(th, 'Na fila');
    const st = await client.channels.fetch(c.staffId).catch(() => null);
    if (st) {
      await marcarStatus(st, 'Na fila');
      const ini = await st.fetchStarterMessage().catch(() => null);
      if (ini?.embeds?.[0]) await ini.edit({ embeds: [{ ...ini.embeds[0].toJSON(), color: 0xEAB308, footer: { text: `ref:${cid}:${card.id}` } }] });
      await st.send(`🟡 **Entrou na fila:** o aluno ${motivo}.`);
    }
    await logStaff(`🎫 Chamado foi pra fila (${motivo}) · **${c.cliente}** · "${c.titulo}" · <#${c.staffId}>`);
    await atualizarFila();
  }

  // Reposta o cartão da fila no fim da conversa (o antigo some) — pra posição não ficar escondida lá em cima
  async function descerCartao(th) {
    const c = chamados.get(th.id);
    if (!c || !c.cardId) return;
    try {
      const antigo = await th.messages.fetch(c.cardId).catch(() => null);
      const pos = c.status === 'fila' ? posicao(th.id) : null;
      const novo = await th.send({ embeds: [cartao(c.status, pos)] });
      if (antigo) await antigo.delete().catch(() => {});
      cartaoTexto.delete(c.cardId);
      c.cardId = novo.id;
      cartaoTexto.set(novo.id, cartao(c.status, pos).title);
      // atualiza o "endereço" no chamado do Staff (sobrevive a reinício)
      const st = await client.channels.fetch(c.staffId);
      const ini = await st.fetchStarterMessage().catch(() => null);
      if (ini?.embeds?.[0]) await ini.edit({ embeds: [{ ...ini.embeds[0].toJSON(), footer: { text: `ref:${th.id}:${novo.id}` } }] });
    } catch (err) {
      console.error('[Suporte] descer cartão:', err.message);
    }
  }

  async function resolver(cid, quem) {
    const c = chamados.get(cid);
    if (!c) return;
    const thCaso = await client.channels.fetch(cid).catch(() => null);
    if (thCaso) await salvarCaso(thCaso, { resolvidoPor: quem === 'equipe' ? 'equipe' : quem === 'prazo' ? 'bot' : 'cliente', staffId: c.staffId });
    // diagnóstico citado e que ninguém respondeu → fecha junto com o chamado
    const codigosChamado = [...(codigosDe.get(cid) || [])];
    if (codigosChamado.length) {
      const { data: fechados } = await db().from('cenadrop_diagnosticos')
        .update({ status: 'encerrado', respondido_em: new Date().toISOString(), respondido_por: quem, respondido_via: 'chamado-fechado' })
        .in('codigo', codigosChamado).or('status.is.null,status.not.in.(respondido,encerrado)').select('codigo, staff_msg_id');
      await atualizarCartoesDiag(fechados, `chamado fechado (${quem === 'equipe' ? 'pela equipe' : 'pelo aluno'})`, 0x6B7280);
    }
    chamados.delete(cid);
    doStaff.delete(c.staffId);
    try {
      const th = await client.channels.fetch(cid);
      const card = c.cardId ? await th.messages.fetch(c.cardId).catch(() => null) : null;
      if (card) await card.edit({ embeds: [cartao('resolvido')] });
      await marcarStatus(th, 'Resolvido');
      if (quem === 'equipe') await th.send({ embeds: [{ description: '✅ A equipe marcou este chamado como **resolvido**. Se voltar a acontecer, é só escrever aqui.', color: 0x22C55E }] });
      if (quem === 'prazo') await th.send({ embeds: [{ description: '✅ Como não tivemos retorno, marcamos como **resolvido**. Se ainda precisar, é só escrever aqui que você entra na fila.', color: 0x22C55E }] });
    } catch (err) { console.error('[Suporte] resolver/cliente:', err.message); }
    try {
      const st = await client.channels.fetch(c.staffId);
      await marcarStatus(st, 'Resolvido');
      await st.send(quem === 'equipe' ? '✅ Fechado.' : quem === 'prazo' ? '✅ Fechado sozinho: o bot respondeu e o aluno não voltou em 3 dias.' : '✅ O cliente marcou como resolvido.');
      await st.setArchived(true);
    } catch (err) { console.error('[Suporte] resolver/staff:', err.message); }
    await atualizarFila();
  }

  // Resposta da equipe → post do cliente (usado pelo relay do Staff e pelo #diagnosticos)
  async function enviarAoCliente(cid, txt, files = [], quem = 'equipe', { aprender = null, links = [] } = {}) {
    const th = await client.channels.fetch(cid);
    if (th.archived) await th.setArchived(false);
    const dono = await donoDe(th);
    await th.send({
      content: `<@${dono}>`, // marca o cliente: o servidor só notifica menções
      embeds: txt ? [{ author: { name: 'Equipe CenaDrop', icon_url: client.user.displayAvatarURL() }, description: txt.slice(0, 4000), color: COR,
        ...(aprender ? { fields: [{ name: '📚 Pra aprender mais', value: aprender.slice(0, 1024) }] } : {}) }] : [],
      components: links.length ? [new ActionRowBuilder().addComponents(...links.slice(0, 5).map((l) =>
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(l.label).setURL(l.url).setEmoji(l.emoji || '🔗')))] : [],
      files,
      allowedMentions: { users: [dono] },
    });
    const c = chamados.get(cid);
    if (c && (c.status === 'fila' || c.status === 'bot')) {
      c.status = 'atendimento';
      await marcarStatus(th, 'Em atendimento');
      const st = await client.channels.fetch(c.staffId).catch(() => null);
      if (st) await marcarStatus(st, 'Em atendimento');
      await atualizarFila();
    }
    // diagnósticos citados neste chamado passam a "respondido"
    const codigos = [...(codigosDe.get(cid) || [])];
    if (codigos.length && txt) {
      const { data: marcados } = await db().from('cenadrop_diagnosticos')
        .update({ status: 'respondido', resposta: txt.slice(0, 4000), respondido_em: new Date().toISOString(), respondido_por: quem, respondido_via: 'chamado' })
        .in('codigo', codigos).or('status.is.null,status.not.in.(respondido,encerrado)').select('codigo, staff_msg_id');
      await atualizarCartoesDiag(marcados, `respondido 📌 no chamado por ${quem}`, 0x22C55E, txt);
    }
  }

  // O cartão do #diagnosticos acompanha o chamado: respondido ali (verde) ou fechado sem resposta da equipe (cinza)
  const CANAL_DIAG = '1557199153254105141';
  async function atualizarCartoesDiag(linhas, situacao, cor, resposta = null) {
    if (!linhas?.length) return;
    try {
      const canal = await client.channels.fetch(CANAL_DIAG);
      for (const d of linhas) {
        if (!d.staff_msg_id) continue;
        const msg = await canal.messages.fetch(d.staff_msg_id).catch(() => null);
        if (!msg?.embeds?.[0]) continue;
        const e = msg.embeds[0].toJSON();
        const fields = (e.fields || []).filter((f) => !['A resposta vai por', 'Resposta'].includes(f.name));
        if (resposta) fields.push({ name: 'Resposta', value: resposta.slice(0, 1000) });
        await msg.edit({ embeds: [{ ...e, color: cor, title: `${cor === 0x22C55E ? '✅' : '✔️'} ${d.codigo} · ${situacao}`, fields }], components: [] });
      }
    } catch (err) {
      console.error('[Suporte] cartão do diagnóstico:', err.message);
    }
  }

  // Cartão do #diagnosticos ganha o atalho pro chamado: a resposta passa a ser dada lá
  const STAFF_GUILD = '1555367221541208105';
  async function ligarCartaoDiag(codigo, staffId) {
    try {
      const { data: d } = await db().from('cenadrop_diagnosticos').select('id, codigo, staff_msg_id, status').eq('codigo', codigo).maybeSingle();
      if (!d?.staff_msg_id || ['respondido', 'encerrado'].includes(d.status)) return;
      const canal = await client.channels.fetch(CANAL_DIAG);
      const msg = await canal.messages.fetch(d.staff_msg_id).catch(() => null);
      if (!msg?.embeds?.[0]) return;
      const e = msg.embeds[0].toJSON();
      const fields = [...(e.fields || []).filter((f) => f.name !== 'A resposta vai por'), { name: 'A resposta vai por', value: `📌 chamado no #suporte → responda em <#${staffId}>` }];
      await msg.edit({ embeds: [{ ...e, color: 0x3B82F6, title: `📌 ${d.codigo} · ${e.title.replace(/^\S+ /, '').split(' · ')[1] || 'aluno'} · chamado aberto no #suporte`, fields }],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Abrir o chamado').setEmoji('📌').setURL(linkThread(STAFF_GUILD, staffId)),
          new ButtonBuilder().setCustomId(`diag:encerrar:${d.id}`).setStyle(ButtonStyle.Secondary).setLabel('Encerrar sem resposta').setEmoji('✔️'),
        )] });
    } catch (err) {
      console.error('[Suporte] ligar cartão do diagnóstico:', err.message);
    }
  }

  // O aluno já citou o código num post do #suporte (mesmo sem ter entrado na fila)? → não abre outro
  async function postComCodigo(codigo) {
    const forum = await client.channels.fetch(SUPORTE);
    const { threads } = await forum.threads.fetchActive();
    for (const th of threads.values()) {
      if (th.parentId !== SUPORTE) continue;
      if (th.name.includes(codigo)) return th.id;
      const msgs = await th.messages.fetch({ limit: 50 }).catch(() => null);
      if (msgs?.some((m) => !m.author.bot && m.content.includes(codigo))) return th.id;
    }
    return null;
  }

  // Diagnóstico enviado e nenhum chamado em 10 min → o bot abre o post no #suporte em nome do aluno
  async function abrirChamadoDoDiagnostico(d, discordId) {
    const guild = await client.guilds.fetch(GUILD_ID);
    const membro = await guild.members.fetch(discordId).catch(() => null);
    if (!membro) return null; // saiu do servidor → o #diagnosticos segue pelo e-mail
    const jaPostou = await postComCodigo(d.codigo);
    if (jaPostou) return jaPostou; // está no post dele; quando pedir ajuda, o chamado leva o código
    const forum = await client.channels.fetch(SUPORTE);
    const tags = tagsDe(forum);
    const tag = /vids/i.test(d.plataforma || '') ? tags['Google Vids'] : tags['Google Flow'];
    const thread = await forum.threads.create({
      name: `🩺 Diagnóstico ${d.codigo}`,
      appliedTags: [tag].filter(Boolean),
      message: {
        content: `<@${discordId}>, recebemos o seu diagnóstico **${d.codigo}** e abrimos este chamado pra você. 🙂\n` +
          'A equipe responde **aqui**, em ordem de chegada (o cartão abaixo mostra a sua posição). Se quiser, conte mais detalhes aqui embaixo.',
        allowedMentions: { users: [discordId] },
      },
    });
    donos.set(thread.id, discordId);
    await abrirChamado(thread, membro.user, { codigoDado: d.codigo });
    await logStaff(`🩺 Chamado aberto pelo bot a partir do diagnóstico ${d.codigo} · ${membro.user.username} · <#${chamados.get(thread.id)?.staffId}>`);
    return thread.id;
  }

  // ── 3/4. repasse de mensagens ─────────────────────────────────────────────
  client.on('messageCreate', async (msg) => {
    if (msg.author.bot || !msg.channel.isThread?.()) return;
    try {
      // Staff → cliente
      if (msg.channel.parentId === CHAMADOS) {
        const cid = doStaff.get(msg.channel.id);
        if (!cid) return;
        const txt = msg.content.trim();
        if (txt.startsWith('//')) return msg.react('📝').catch(() => {});
        if (txt.toLowerCase() === '!resolvido') return resolver(cid, 'equipe');
        await enviarAoCliente(cid, txt, [...msg.attachments.values()].map((a) => ({ attachment: a.url, name: a.name })), msg.author.username);
        await msg.react('✅').catch(() => {});
        return;
      }
      // cliente → Staff
      if (msg.channel.parentId === SUPORTE) {
        const c = chamados.get(msg.channel.id);
        if (!c) {
          // post já resolvido e o dono voltou a escrever → oferece a fila de novo (uma vez)
          const resolvido = msg.channel.appliedTags.some((id) => nomeTag(msg.channel.parent, id) === 'Resolvido');
          if (resolvido && msg.author.id === await donoDe(msg.channel)) {
            await msg.channel.send({ content: 'Voltou a acontecer? Você entrou na fila da equipe de novo. 👇' });
            await abrirChamado(msg.channel, msg.author);
            const st = await client.channels.fetch(chamados.get(msg.channel.id)?.staffId).catch(() => null);
            if (st) await st.send({ content: `**🙋 Cliente (voltou a escrever num post resolvido):** ${msg.content || ''}`.slice(0, 2000), allowedMentions: { parse: [] } });
          }
          return;
        }
        const st = await client.channels.fetch(c.staffId);
        if (st.archived) await st.setArchived(false);
        const dono = await donoDe(msg.channel);
        const quem = msg.author.id === dono ? '🙋 Cliente' : `👥 Outro membro (${msg.author.username})`;
        if (c.status === 'bot' && msg.author.id === dono) await promover(msg.channel.id, 'escreveu de novo no post');
        await st.send({
          content: `**${quem}:** ${msg.content || ''}`.slice(0, 2000),
          files: [...msg.attachments.values()].map((a) => ({ attachment: a.url, name: a.name })),
          allowedMentions: { parse: [] },
        });
        const codigo = msg.content.match(PADRAO_DIAG)?.[0];
        const novoCodigo = codigo && !codigosDe.get(msg.channel.id)?.has(codigo);
        anotarCodigo(msg.channel.id, codigo);
        if (novoCodigo) await ligarCartaoDiag(codigo, c.staffId);
        if (codigo) await msg.reply({ content: `✅ Recebemos o diagnóstico **${codigo}** — já está com a equipe.`, allowedMentions: { parse: [] } }).catch(() => {});
        if (msg.author.id === dono && c.status !== 'fila') await descerCartao(msg.channel);
        if (codigo) await st.send({ embeds: [{ title: '🧰 Diagnóstico enviado', description: textoDiag(await diagnostico(codigo), codigo), color: 0x3B82F6 }] });
      }
    } catch (err) {
      console.error('[Suporte] repasse:', err);
      await logStaff(`🔴 Erro no repasse do suporte · ${String(err.message || err).slice(0, 300)}`);
    }
  });

  // ── reconstrói a fila a partir do Discord ao ligar ────────────────────────
  async function reconstruir() {
    const forum = await client.channels.fetch(CHAMADOS);
    const ativos = await forum.threads.fetchActive();
    const arquivados = await forum.threads.fetchArchived({ limit: 100 }).catch(() => ({ threads: new Map() }));
    const todos = [...ativos.threads.values(), ...arquivados.threads.values()];
    for (const st of todos) {
      const nomes = st.appliedTags.map((id) => nomeTag(forum, id));
      const status = nomes.includes('Em atendimento') ? 'atendimento' : nomes.includes('Na fila') ? 'fila' : nomes.includes('Bot respondeu') ? 'bot' : null;
      if (!status) continue;
      const ini = await st.fetchStarterMessage().catch(() => null);
      const ref = ini?.embeds?.[0]?.footer?.text?.match(/^ref:(\d+):(\d+)$/);
      if (!ref) continue;
      const cliente = ini.embeds[0].fields?.find((f) => f.name === 'Cliente')?.value?.match(/\*\*(.+?)\*\*/)?.[1] || '?';
      chamados.set(ref[1], { staffId: st.id, cardId: ref[2] === '0' ? null : ref[2], status, criado: st.createdTimestamp, titulo: st.name, cliente });
      const idCliente = ini.embeds[0].fields?.find((f) => f.name === 'Cliente')?.value?.match(/`(\d+)`/)?.[1];
      if (idCliente) donos.set(ref[1], idCliente);
      anotarCodigo(ref[1], ini.embeds[0].fields?.find((f) => f.name === 'Diagnóstico')?.value?.match(PADRAO_DIAG)?.[0]);
      doStaff.set(st.id, ref[1]);
    }
    console.log(`[Suporte] fila reconstruída: ${chamados.size} chamado(s) abertos`);
    await puxarDoLimbo();
    await atualizarFila();
  }

  // Post do #suporte sem chamado e não resolvido (o aluno nunca clicou 🙋) = ficou invisível pra equipe → vai pra fila
  async function puxarDoLimbo() {
    try {
      const forum = await client.channels.fetch(SUPORTE);
      const ativos = await forum.threads.fetchActive();
      for (const th of ativos.threads.values()) {
        if (th.parentId !== SUPORTE || chamados.has(th.id)) continue;
        if (th.appliedTags.some((id) => nomeTag(forum, id) === 'Resolvido')) continue;
        const dono = await client.users.fetch(await donoDe(th)).catch(() => null);
        if (!dono) continue;
        await th.send({ content: `<@${dono.id}>, seu caso ainda estava sem resposta da equipe: você entrou na fila agora. Se já resolveu, é só escrever aqui avisando. 🙂`, allowedMentions: { users: [dono.id] } });
        await abrirChamado(th, dono);
        await logStaff(`🧲 Post parado no #suporte puxado pra fila · "${th.name}"`);
      }
    } catch (err) { console.error('[Suporte] limbo:', err.message); }
  }

  client.once('clientReady', () => {
    carregarBase();
    setInterval(carregarBase, 5 * 60 * 1000);
    reconstruir().catch((err) => console.error('[Suporte] reconstruir:', err));
    setInterval(() => atualizarFila(), 10 * 60 * 1000); // "esperando há…" do painel
  });

  // usado pelo #diagnosticos: achar o chamado aberto que citou um código e responder nele
  return {
    chamadoComCodigo: (codigo) => [...codigosDe.entries()].find(([cid, set]) => set.has(codigo) && chamados.has(cid))?.[0] || null,
    enviarAoCliente,
    abrirChamadoDoDiagnostico,
    ligarCartaoDiag,
    staffDe: (cid) => chamados.get(cid)?.staffId,
  };
};

module.exports.procurar = procurar;
