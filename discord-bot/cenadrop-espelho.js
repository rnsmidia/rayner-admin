/**
 * CenaDrop Bot — ESPELHO das abas públicas do servidor CenaDrop dentro do Staff (16/10/26)
 *
 * O Rayner nunca entra no servidor CenaDrop com a conta pessoal (regra). Pra ele VER a comunidade
 * como o aluno vê, cada mensagem das abas abaixo é copiada ao vivo pra categoria 📡 ESPELHO CENADROP
 * do Staff, por webhook (sai com o nome e a foto de quem escreveu; vídeo/imagem anexados tocam ali).
 * Edição e exclusão acompanham (enquanto o bot estiver ligado desde a mensagem). Canais só leitura.
 * Ao ligar, recupera o que chegou com o bot desligado (depois da última cópia; espelho vazio = últimas 30).
 * Pra responder lá: !geral / !responder e os ✅ do #rascunhos — o espelho é só pra ver.
 */

const GUILD = '1555365917578240130';
const AULAS = '1560389544917082123';            // fórum #aulas-e-lives
const PARES = {                                  // origem (CenaDrop) → espelho (Staff)
  '1555365918278684775': '1560645413785305248',  // #geral
  '1555372692742340718': '1560645416062816286',  // #avisos
  [AULAS]:               '1560645418730266634',  // #aulas-e-lives (mensagens dentro dos posts)
  '1555372703131766795': '1560645420773019829',  // #vitrine
  '1555372711763513364': '1560645422530429042',  // #dicas-e-prompts
};
const NOME_HOOK = 'Espelho CenaDrop';
const LIMITE_ANEXO = 9.5 * 1024 * 1024;          // acima disso vai como link
const HISTORICO = 30;

module.exports = function espelho(client) {
  const hooks = new Map();     // canal do espelho → webhook
  const copias = new Map();    // id da mensagem original → { hook, id da cópia }

  const origemDe = (msg) => {
    if (msg.guildId !== GUILD) return null;
    if (PARES[msg.channelId]) return msg.channelId;
    if (msg.channel?.isThread?.() && msg.channel.parentId === AULAS) return AULAS;
    return null;
  };

  async function hookDe(espelhoId) {
    if (hooks.has(espelhoId)) return hooks.get(espelhoId);
    const canal = await client.channels.fetch(espelhoId);
    const todos = await canal.fetchWebhooks();
    const h = todos.find((w) => w.name === NOME_HOOK && w.owner?.id === client.user.id) || await canal.createWebhook({ name: NOME_HOOK });
    hooks.set(espelhoId, h);
    return h;
  }

  // menções do outro servidor viram texto (senão aparecem como "#desconhecido" / "@usuário-desconhecido")
  function textoLegivel(msg) {
    let t = msg.content || '';
    t = t.replace(/<@!?(\d+)>/g, (_, id) => `@${msg.mentions.users.get(id)?.displayName || msg.mentions.users.get(id)?.username || 'alguém'}`);
    t = t.replace(/<@&(\d+)>/g, (_, id) => `@${msg.guild?.roles.cache.get(id)?.name || 'cargo'}`);
    t = t.replace(/<#(\d+)>/g, (_, id) => `#${msg.guild?.channels.cache.get(id)?.name || 'canal'}`);
    return t;
  }

  async function montar(msg) {
    const partes = [];
    if (msg.channel?.isThread?.() && msg.channel.parentId === AULAS) partes.push(`📚 **${msg.channel.name}**`);
    if (msg.type === 7) partes.push(`👋 **${msg.member?.displayName || msg.author.username}** entrou no servidor`);
    if (msg.reference?.messageId) {
      const ref = await msg.fetchReference().catch(() => null);
      if (ref) partes.push(`-# ↪️ em resposta a **${ref.member?.displayName || ref.author.username}**: ${(ref.content || ref.embeds[0]?.description || '').replace(/\s+/g, ' ').slice(0, 80)}`);
    }
    const corpo = textoLegivel(msg);
    if (corpo) partes.push(corpo);
    const files = [];
    for (const a of msg.attachments.values()) {
      if (a.size <= LIMITE_ANEXO) files.push({ attachment: a.url, name: a.name });
      else partes.push(`📎 ${a.name}: ${a.url}`);
    }
    const embeds = msg.embeds.filter((e) => !e.data.type || e.data.type === 'rich').map((e) => e.toJSON()).slice(0, 10);
    const content = partes.join('\n').slice(0, 2000);
    if (!content && !embeds.length && !files.length) return null;
    const eBot = msg.author.id === client.user.id;
    return {
      username: (msg.type === 7 ? 'CenaDrop' : eBot ? 'Equipe CenaDrop' : (msg.member?.displayName || msg.author.globalName || msg.author.username)).slice(0, 80),
      avatarURL: eBot || msg.type === 7 ? client.user.displayAvatarURL() : (msg.member?.displayAvatarURL() || msg.author.displayAvatarURL()),
      content: content || undefined, embeds, files, allowedMentions: { parse: [] },
    };
  }

  async function copiar(msg) {
    const origem = origemDe(msg);
    if (!origem || ![0, 7, 19, 20, 23].includes(msg.type)) return;
    const dados = await montar(msg);
    if (!dados) return;
    const hook = await hookDe(PARES[origem]);
    const enviada = await hook.send(dados);
    copias.set(msg.id, { hook, id: enviada.id });
  }

  client.on('messageCreate', (msg) => { copiar(msg).catch((e) => console.error('[Espelho] copiar:', e.message)); });
  client.on('messageUpdate', async (_antes, depois) => {
    const c = copias.get(depois.id);
    if (!c) return;
    try {
      const d = await montar(depois.partial ? await depois.fetch() : depois);
      if (d) await c.hook.editMessage(c.id, { content: d.content ?? '', embeds: d.embeds, allowedMentions: { parse: [] } });
    } catch (e) { console.error('[Espelho] editar:', e.message); }
  });
  client.on('messageDelete', async (msg) => {
    const c = copias.get(msg.id);
    if (!c) return;
    copias.delete(msg.id);
    await c.hook.deleteMessage(c.id).catch((e) => console.error('[Espelho] apagar:', e.message));
  });

  // espelho vazio → traz as últimas mensagens da aba (1ª vez / canal limpo)
  let jaRodou = false;
  async function historico() {
    if (jaRodou) return;
    jaRodou = true;
    for (const [origem, destino] of Object.entries(PARES)) {
      try {
        // recupera o que chegou enquanto o bot estava desligado: tudo depois da última cópia (ou as últimas 30, se vazio)
        const alvo = await client.channels.fetch(destino);
        const ultima = (await alvo.messages.fetch({ limit: 1 })).first();
        const desde = ultima ? ultima.createdTimestamp : 0;
        let msgs = [];
        if (origem === AULAS) {
          const forum = await client.channels.fetch(AULAS);
          const ativos = await forum.threads.fetchActive();
          for (const th of ativos.threads.values()) msgs.push(...(await th.messages.fetch({ limit: HISTORICO })).values());
        } else {
          const canal = await client.channels.fetch(origem);
          msgs = [...(await canal.messages.fetch({ limit: HISTORICO })).values()];
        }
        msgs = msgs.filter((m) => m.createdTimestamp > desde);
        msgs.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
        for (const m of msgs) await copiar(m).catch((e) => console.error('[Espelho] histórico:', e.message));
        console.log(`[Espelho] histórico de ${origem}: ${msgs.length} mensagem(ns)`);
      } catch (e) { console.error('[Espelho] histórico:', e.message); }
    }
  }

  client.once('clientReady', () => { setTimeout(() => historico(), 20 * 1000); });
  return { historico };
};
