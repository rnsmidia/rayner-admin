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
 *
 * Estado da fila mora no próprio Discord (rodapé do chamado + etiquetas) → sobrevive a reinício.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const KB = require('./base-conhecimento.json');

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
const KB_NORM = KB.map((e) => ({ ...e, _kw: e.palavras.map(norm).filter((k) => k.length >= 3) }));

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
  // customerThreadId → { staffId, cardId, status: 'fila'|'atendimento', criado, titulo, cliente }
  const chamados = new Map();
  const doStaff = new Map(); // staffThreadId → customerThreadId
  const cartaoTexto = new Map(); // cardId → último texto (evita editar à toa)
  const codigosDe = new Map(); // customerThreadId → Set de códigos D-XXXX citados no chamado
  const anotarCodigo = (cid, codigo) => { if (!codigo) return; if (!codigosDe.has(cid)) codigosDe.set(cid, new Set()); codigosDe.get(cid).add(codigo); };

  const tagsDe = (forum) => Object.fromEntries(forum.availableTags.map((t) => [t.name, t.id]));
  const nomeTag = (forum, id) => forum.availableTags.find((t) => t.id === id)?.name;
  const STATUS = ['Na fila', 'Em atendimento', 'Resolvido'];

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
      const assunto = thread.appliedTags.map((id) => nomeTag(thread.parent, id)).find(Boolean);
      const achados = procurar(thread.name, inicial?.content || '', assunto);
      const embeds = achados.length
        ? achados.map((e) => ({
          title: `💡 ${e.pergunta}`.slice(0, 256), description: e.resposta.slice(0, 4000), color: COR,
          ...(e.aprender ? { fields: [{ name: '📚 Pra aprender mais', value: e.aprender.slice(0, 1024) }] } : {}),
        }))
        : [{ title: '🔎 Ainda não tenho uma resposta pronta pra isso', description: `Dá uma olhada no <#${FAQ}> (dá pra buscar). Se não achar, clique em **🙋 Ainda preciso de ajuda** e você entra na fila da equipe.`, color: COR }];
      if (achados.length) embeds.push({ description: 'Não resolveu? Clique em **🙋 Ainda preciso de ajuda** e você entra na fila da equipe.', color: 0x6B7280 });

      await thread.send({
        content: `Oi <@${thread.ownerId}>! ${achados.length ? 'Veja se isso resolve:' : ''}`,
        embeds: embeds.slice(0, 10),
        components: [...linksDe(achados), ...botoes(!achados.length)],
        allowedMentions: { users: [thread.ownerId] },
      });
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
      if (inter.user.id !== thread.ownerId) {
        return inter.reply({ content: 'Só quem abriu este post pode usar esses botões. Se você tem um problema parecido, abra o seu próprio post no #suporte. 🙂', flags: MessageFlags.Ephemeral });
      }
      if (inter.customId === 'sup:ok') {
        await inter.update({ components: [] });
        if (chamados.has(thread.id)) await resolver(thread.id, 'cliente');
        else await marcarStatus(thread, 'Resolvido');
        await thread.send('✅ Que bom que resolveu! Marquei como **resolvido**. Se voltar a acontecer, é só escrever aqui.');
        await logStaff(`✅ Resolvido pela base (cliente clicou) · "${thread.name}"`);
        return;
      }
      if (inter.customId === 'sup:fila') {
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

  async function atualizarFila() {
    const fila = naFila();
    for (const [cid, c] of chamados) {
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
      const linhas = [
        `**🟡 Na fila (${fila.length})**`,
        ...(fila.length ? fila.map(([, c], i) => `${i + 1}. <#${c.staffId}> · ${c.cliente} · esperando há ${haQuanto(c.criado)}`) : ['— ninguém esperando 🎉']),
        '',
        `**💬 Em atendimento (${atend.length})**`,
        ...(atend.length ? atend.map(([, c]) => `• <#${c.staffId}> · ${c.cliente} · aberto há ${haQuanto(c.criado)}`) : ['—']),
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

  async function abrirChamado(thread, user) {
    const card = await thread.send({ embeds: [cartao('fila', naFila().length + 1)] });
    const jaTem = await procurarCodigo(thread);
    await thread.send({ embeds: [jaTem
      ? { description: `✅ Recebemos o seu diagnóstico **${jaTem}** — ele já vai junto pra equipe.`, color: 0x22C55E }
      : EMBED_DIAG] });
    const criado = Date.now();
    const { data: lics } = await db().from('licenses')
      .select('key, active, status, source, product').eq('discord_id', user.id);
    const lic = (lics || []).find((l) => l.active !== false && l.status !== 'inactive') || (lics || [])[0];
    const codigo = await procurarCodigo(thread);
    const diag = await diagnostico(codigo);
    const inicial = await thread.fetchStarterMessage().catch(() => null);
    const assunto = thread.appliedTags.map((id) => nomeTag(thread.parent, id)).find((n) => n && !STATUS.includes(n));
    const anexos = inicial ? [...inicial.attachments.values()].map((a) => a.url) : [];

    const staffForum = await client.channels.fetch(CHAMADOS);
    const staffTags = tagsDe(staffForum);
    const staff = await staffForum.threads.create({
      name: `${thread.name}`.slice(0, 95),
      appliedTags: [staffTags['Na fila']].filter(Boolean),
      message: {
        // texto solto = prévia que aparece na lista do fórum
        content: `🎫 **${user.username}** · ${assunto || 'sem assunto'} · ${(inicial?.content || '').replace(/\s+/g, ' ').slice(0, 140)}`,
        allowedMentions: { parse: [] },
        embeds: [{
          title: thread.name.slice(0, 256),
          url: linkThread(GUILD_ID, thread.id),
          description: (inicial?.content || '(sem texto)').slice(0, 3500),
          color: 0xEAB308,
          fields: [
            { name: 'Cliente', value: `**${user.username}** \`${user.id}\``, inline: true },
            { name: 'Assunto', value: assunto || '—', inline: true },
            { name: 'Licença', value: lic ? `${mascarar(lic.key)} · ${lic.source || '—'} · ${lic.active !== false && lic.status !== 'inactive' ? 'ativa ✅' : 'DESATIVADA ⛔'}` : 'sem chave ligada', inline: false },
            { name: 'Diagnóstico', value: textoDiag(diag, codigo), inline: false },
            ...(anexos.length ? [{ name: 'Anexos', value: anexos.slice(0, 5).join('\n').slice(0, 1000) }] : []),
          ],
          footer: { text: `ref:${thread.id}:${card.id}` },
        }],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('sup:resolver').setStyle(ButtonStyle.Success).setLabel('Marcar como resolvido').setEmoji('✅'),
        )],
      },
    });
    const cliente = user.username;
    chamados.set(thread.id, { staffId: staff.id, cardId: card.id, status: 'fila', criado, titulo: thread.name, cliente });
    anotarCodigo(thread.id, codigo);
    doStaff.set(staff.id, thread.id);
    await marcarStatus(thread, 'Na fila');
    await logStaff(`🎫 Novo chamado na fila · **${cliente}** · "${thread.name}" · <#${staff.id}>`);
    await atualizarFila();
  }

  // Reposta o cartão da fila no fim da conversa (o antigo some) — pra posição não ficar escondida lá em cima
  async function descerCartao(th) {
    const c = chamados.get(th.id);
    if (!c) return;
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
    chamados.delete(cid);
    doStaff.delete(c.staffId);
    try {
      const th = await client.channels.fetch(cid);
      const card = await th.messages.fetch(c.cardId).catch(() => null);
      if (card) await card.edit({ embeds: [cartao('resolvido')] });
      await marcarStatus(th, 'Resolvido');
      if (quem === 'equipe') await th.send({ embeds: [{ description: '✅ A equipe marcou este chamado como **resolvido**. Se voltar a acontecer, é só escrever aqui.', color: 0x22C55E }] });
    } catch (err) { console.error('[Suporte] resolver/cliente:', err.message); }
    try {
      const st = await client.channels.fetch(c.staffId);
      await marcarStatus(st, 'Resolvido');
      await st.send(quem === 'equipe' ? '✅ Fechado.' : '✅ O cliente marcou como resolvido.');
      await st.setArchived(true);
    } catch (err) { console.error('[Suporte] resolver/staff:', err.message); }
    await atualizarFila();
  }

  // Resposta da equipe → post do cliente (usado pelo relay do Staff e pelo #diagnosticos)
  async function enviarAoCliente(cid, txt, files = [], quem = 'equipe') {
    const th = await client.channels.fetch(cid);
    if (th.archived) await th.setArchived(false);
    await th.send({
      content: `<@${th.ownerId}>`, // marca o cliente: o servidor só notifica menções
      embeds: txt ? [{ author: { name: 'Equipe CenaDrop', icon_url: client.user.displayAvatarURL() }, description: txt.slice(0, 4000), color: COR }] : [],
      files,
      allowedMentions: { users: [th.ownerId] },
    });
    const c = chamados.get(cid);
    if (c && c.status === 'fila') {
      c.status = 'atendimento';
      await marcarStatus(th, 'Em atendimento');
      const st = await client.channels.fetch(c.staffId).catch(() => null);
      if (st) await marcarStatus(st, 'Em atendimento');
      await atualizarFila();
    }
    // diagnósticos citados neste chamado passam a "respondido"
    const codigos = [...(codigosDe.get(cid) || [])];
    if (codigos.length && txt) {
      await db().from('cenadrop_diagnosticos')
        .update({ status: 'respondido', resposta: txt.slice(0, 4000), respondido_em: new Date().toISOString(), respondido_por: quem, respondido_via: 'chamado' })
        .in('codigo', codigos).or('status.is.null,status.neq.respondido');
    }
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
          if (resolvido && msg.author.id === msg.channel.ownerId) {
            await marcarStatus(msg.channel, null);
            await msg.channel.send({ content: 'Voltou a acontecer? Se precisar da equipe, clique abaixo. 👇', components: botoes(true) });
          }
          return;
        }
        const st = await client.channels.fetch(c.staffId);
        if (st.archived) await st.setArchived(false);
        const quem = msg.author.id === msg.channel.ownerId ? '🙋 Cliente' : `👥 Outro membro (${msg.author.username})`;
        await st.send({
          content: `**${quem}:** ${msg.content || ''}`.slice(0, 2000),
          files: [...msg.attachments.values()].map((a) => ({ attachment: a.url, name: a.name })),
          allowedMentions: { parse: [] },
        });
        const codigo = msg.content.match(PADRAO_DIAG)?.[0];
        anotarCodigo(msg.channel.id, codigo);
        if (codigo) await msg.reply({ content: `✅ Recebemos o diagnóstico **${codigo}** — já está com a equipe.`, allowedMentions: { parse: [] } }).catch(() => {});
        if (msg.author.id === msg.channel.ownerId) await descerCartao(msg.channel);
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
      const status = nomes.includes('Em atendimento') ? 'atendimento' : nomes.includes('Na fila') ? 'fila' : null;
      if (!status) continue;
      const ini = await st.fetchStarterMessage().catch(() => null);
      const ref = ini?.embeds?.[0]?.footer?.text?.match(/^ref:(\d+):(\d+)$/);
      if (!ref) continue;
      const cliente = ini.embeds[0].fields?.find((f) => f.name === 'Cliente')?.value?.match(/\*\*(.+?)\*\*/)?.[1] || '?';
      chamados.set(ref[1], { staffId: st.id, cardId: ref[2], status, criado: st.createdTimestamp, titulo: st.name, cliente });
      anotarCodigo(ref[1], ini.embeds[0].fields?.find((f) => f.name === 'Diagnóstico')?.value?.match(PADRAO_DIAG)?.[0]);
      doStaff.set(st.id, ref[1]);
    }
    console.log(`[Suporte] fila reconstruída: ${chamados.size} chamado(s) abertos`);
    await atualizarFila();
  }

  client.once('clientReady', () => {
    reconstruir().catch((err) => console.error('[Suporte] reconstruir:', err));
    setInterval(() => atualizarFila(), 10 * 60 * 1000); // "esperando há…" do painel
  });

  // usado pelo #diagnosticos: achar o chamado aberto que citou um código e responder nele
  return {
    chamadoComCodigo: (codigo) => [...codigosDe.entries()].find(([cid, set]) => set.has(codigo) && chamados.has(cid))?.[0] || null,
    enviarAoCliente,
  };
};

module.exports.procurar = procurar;
