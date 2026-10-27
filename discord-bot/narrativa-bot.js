/**
 * Narrativa Bot — comunidade/suporte do Narrativa IA (servidor separado, 22/10/26)
 * Espelha o CenaDrop Bot, com uma diferença central: o Narrativa não tem chave — o aluno entra com
 * e-mail e senha. Então a prova de identidade acontece DENTRO do app: Perfil › "Ligar ao Discord" gera
 * um código de uso único (NV-XXXX, 15 min, tabela narrativa_discord_codigos) e aqui o /ativar troca o
 * código pela conta. O Discord nunca vê e-mail nem senha.
 *
 * - /ativar <código> ou botão "🔑 Ativar meu acesso" no #ativar-acesso → confere a conta (ativa e sem vencer,
 *   venha de onde vier a compra), grava discord_id/discord_nome na conta e dá Cliente Narrativa + Comunidade
 * - Quem sai e volta recupera o cargo sozinho (pelo discord_id gravado na conta)
 * - A cada 30 min confere quem tem o cargo: conta desativada/vencida ou Discord desligado no Perfil → perde
 *   o cargo; conta ativa de novo → recebe de volta. `!conferir-narrativa` no Staff roda na hora.
 * - Botões 🔕 só suporte / 💬 comunidade (cargo Comunidade = #geral e #dicas)
 * - Ao ligar, garante as mensagens fixas de #boas-vindas, #conheça-o-narrativa e #ativar-acesso
 * - Tudo fica registrado no #ativacoes-narrativa do Staff ("Estagiário")
 *
 * Env: NARRATIVA_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY
 * Ids: PRODUTOS/Narrativa IA/suporte/discord-ids.json (montar-servidor.py)
 */

const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const APP_ID      = '1562532541683077203';
const GUILD_ID    = '1562531582462394459';
const STAFF_GUILD = '1555367221541208105';
const ROLE_CLIENTE    = '1562683754038829086';
const ROLE_COMUNIDADE = '1562683758862270514';
const CH = {
  boasVindas: '1562683766718333060',
  avisos:     '1562683768723214507',
  conheca:    '1562683773735407686',
  ativar:     '1562683775878561833',
  geral:      '1562683779623948319',
  dicas:      '1562683781712715850',
  aulas:      '1562683792383025162',
  suporte:    '1562683796900290617',
  faq:        '1562683799593164800',
  ativacoes:  '1562683831763337246', // Staff
};
const APP     = 'https://narrativaia.com.br/narrativa-ia';
const PERFIL  = `${APP}/perfil`;
const PLANOS  = 'https://narrativaia.com.br/planos';
const COR = 0x7C5CF8;
const CONFERIR_A_CADA = 30 * 60 * 1000;

const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
/** acesso ativo = conta ligada e sem data vencida (a origem da compra não importa: avulsa, Elite, Combo, promo…) */
const contaAtiva = (u) => !!u && u.active !== false && (!u.expires_at || new Date(u.expires_at).getTime() > Date.now());
// acha o NV-XXXX no meio do que for colado ("/ativar codigo:NV-AB12", "nv ab12", "Seu código: NV-AB12 vale…") — caso real 26/10
const normalizarCodigo = (t) => {
  const bruto = String(t || '').toUpperCase();
  const m = bruto.match(/\bNV[\s:_-]*([A-Z0-9]{4})\b/);
  return m ? `NV-${m[1]}` : bruto.trim();
};
const mascararEmail = (e) => String(e || '').replace(/^(.).*?(.)?@/, (_, a, b) => `${a}***${b || ''}@`);

const client = new Client({ intents: [
  GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
] });

async function logStaff(texto) {
  try {
    const ch = await client.channels.fetch(CH.ativacoes);
    await ch.send({ content: texto, allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[Narrativa] falha ao registrar no Staff:', err.message);
  }
}

const linha = (...botoes) => [new ActionRowBuilder().addComponents(...botoes)];
const btnLink = (rotulo, emoji, url) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(rotulo).setEmoji(emoji).setURL(url);
const botoesPreferencia = () => linha(
  new ButtonBuilder().setCustomId('nvpref:suporte').setStyle(ButtonStyle.Secondary).setLabel('Só quero suporte e avisos').setEmoji('🔕'),
  new ButtonBuilder().setCustomId('nvpref:comunidade').setStyle(ButtonStyle.Secondary).setLabel('Quero participar da comunidade').setEmoji('💬'),
);

const comandos = [
  new SlashCommandBuilder()
    .setName('ativar')
    .setDescription('Libere a área de alunos com o código gerado no seu Perfil do Narrativa')
    .addStringOption((o) => o.setName('codigo').setDescription('O código do Perfil (ex.: NV-7K2P)').setRequired(true)),
].map((c) => c.toJSON());

// ── /ativar ─────────────────────────────────────────────────────────────────
async function ativar(inter) {
  const codigo = normalizarCodigo(inter.isModalSubmit() ? inter.fields.getTextInputValue('codigo') : inter.options.getString('codigo'));
  const user = inter.user;
  const comoGerar = `Gere um código novo no seu **Perfil do Narrativa** › *Comunidade e suporte no Discord* (<${PERFIL}>) e tente de novo.`;

  const { data: cod, error } = await db().from('narrativa_discord_codigos')
    .select('codigo, user_id, expira, usado_em').eq('codigo', codigo).maybeSingle();
  if (error) throw error;

  if (!cod) {
    await logStaff(`❓ /ativar com código inexistente · **${user.username}** \`${user.id}\` · \`${codigo.slice(0, 12)}\``);
    return inter.editReply({ content: `❌ **Não encontrei esse código.** Ele tem o formato \`NV-XXXX\`.\n${comoGerar}` });
  }
  if (cod.usado_em) return inter.editReply({ content: `⚠️ **Esse código já foi usado.** Cada código vale uma vez.\n${comoGerar}` });
  if (new Date(cod.expira).getTime() < Date.now()) return inter.editReply({ content: `⏰ **Esse código venceu** (vale 15 minutos).\n${comoGerar}` });

  const { data: conta, error: e2 } = await db().from('narrativa_users')
    .select('id, email, name, active, expires_at, origin, discord_id').eq('id', cod.user_id).maybeSingle();
  if (e2) throw e2;

  if (!contaAtiva(conta)) {
    await logStaff(`⛔ /ativar com conta sem acesso · **${user.username}** \`${user.id}\` · ${mascararEmail(conta?.email)} · ${conta?.origin || ''}`);
    return inter.editReply({
      content: '⛔ **Sua conta do Narrativa está sem acesso ativo** (assinatura vencida, cancelada ou reembolsada).\nPara voltar, escolha um plano:',
      components: linha(btnLink('Ver planos', '🛒', PLANOS)),
    });
  }

  if (conta.discord_id && conta.discord_id !== user.id) {
    await logStaff(`⚠️ **Conta já ligada a outro Discord** · tentou: **${user.username}** \`${user.id}\` · ligado: \`${conta.discord_id}\` · ${mascararEmail(conta.email)}`);
    return inter.editReply({
      content: '⚠️ **Essa conta do Narrativa já está ligada a outro Discord.**\nSe a outra conta também é sua, entre por ela — ou desligue o Discord antigo no seu Perfil do Narrativa e gere um código novo.',
    });
  }

  // este Discord já está em OUTRA conta do Narrativa? (o índice único do banco também barra)
  const { data: outra } = await db().from('narrativa_users').select('id, email').eq('discord_id', user.id).neq('id', conta.id).maybeSingle();
  if (outra) {
    await logStaff(`⚠️ **Discord já ligado a outra conta** · **${user.username}** \`${user.id}\` · conta atual: ${mascararEmail(outra.email)} · tentou: ${mascararEmail(conta.email)}`);
    return inter.editReply({ content: '⚠️ **Este Discord já está ligado a outra conta do Narrativa.** Cada Discord liga uma conta. Desligue no Perfil da outra conta e tente de novo.' });
  }

  const agora = new Date().toISOString();
  const { error: e3 } = await db().from('narrativa_users')
    .update({ discord_id: user.id, discord_nome: user.username, discord_linked_at: conta.discord_id ? undefined : agora })
    .eq('id', conta.id);
  if (e3) throw e3;
  await db().from('narrativa_discord_codigos').update({ usado_em: agora, discord_id: user.id }).eq('codigo', cod.codigo);

  const membro = await inter.guild.members.fetch(user.id);
  await membro.roles.add([ROLE_CLIENTE, ROLE_COMUNIDADE], 'Ativou com código do Perfil do Narrativa');

  const primeiro = (conta.name || '').split(' ')[0];
  await logStaff(`✅ Ativou · **${user.username}** \`${user.id}\` · ${conta.name || '—'} · ${mascararEmail(conta.email)} · ${conta.origin || ''}`);
  return inter.editReply({
    content:
      `✅ **Acesso liberado${primeiro ? `, ${primeiro}` : ''}!** Bem-vindo à comunidade do Narrativa.\n\n` +
      `💬 Apresente-se em <#${CH.geral}>\n` +
      `🛟 Dúvida ou problema? Abra um post em <#${CH.suporte}>\n` +
      `🎓 Aulas e lives em <#${CH.aulas}>\n\n` +
      '-# Prefere só o essencial (suporte e avisos), sem a conversa da comunidade? Use o botão abaixo — dá pra voltar quando quiser.',
    components: botoesPreferencia(),
  });
}

// ── "só suporte" × "comunidade" ─────────────────────────────────────────────
async function preferencia(inter) {
  try {
    const membro = inter.member ?? await inter.guild.members.fetch(inter.user.id);   // já vem na interação: evita 1 ida à API
    if (!membro.roles.cache.has(ROLE_CLIENTE)) {
      return inter.reply({ content: `🔑 Primeiro ative seu acesso no <#${CH.ativar}>.`, flags: MessageFlags.Ephemeral });
    }
    if (inter.customId === 'nvpref:suporte') {
      await membro.roles.remove(ROLE_COMUNIDADE, 'Escolheu só suporte e avisos');
      logStaff(`🔕 Só suporte · **${inter.user.username}** \`${inter.user.id}\``);   // sem await: responder dentro dos 3 s do Discord
      return inter.reply({ content: '🔕 Pronto! Você vê só o essencial: **#avisos**, **#suporte**, **#perguntas-frequentes** e as aulas. O #dicas saiu da sua lista e o #geral fica só pra leitura.', flags: MessageFlags.Ephemeral });
    }
    await membro.roles.add(ROLE_COMUNIDADE, 'Quer participar da comunidade');
    return inter.reply({ content: '💬 Bem-vindo de volta à comunidade! Você pode conversar no **#geral** e o **#dicas-e-prompts** voltou pra sua lista.', flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error('[Narrativa] preferência:', err.message);
    try { await inter.reply({ content: '😕 Algo deu errado. Tente de novo em instantes.', flags: MessageFlags.Ephemeral }); } catch (_) {}
  }
}

// ── conferência de acesso ───────────────────────────────────────────────────
let conferindo = false;
async function conferirAcessos() {
  if (conferindo) return { ignorado: true };
  conferindo = true;
  try {
    const { data, error } = await db().from('narrativa_users')
      .select('id, active, expires_at, discord_id').not('discord_id', 'is', null);
    if (error) throw error;
    const ativo = new Map(data.map((u) => [u.discord_id, contaAtiva(u)]));

    const guild = await client.guilds.fetch(GUILD_ID);
    const membros = await guild.members.fetch();
    // trava contra estrago em massa (banco devolvendo vazio/errado): mede ANTES quantos perderiam o cargo e só aborta
    // se for muita gente de uma vez. A trava do CenaDrop ("0 ligadas e alguém com cargo") barrava o caso legítimo de
    // um aluno só desligar o Discord no Perfil (teste de 26/10).
    const comCargo = membros.filter((m) => !m.user.bot && m.roles.cache.has(ROLE_CLIENTE));
    const perderiam = comCargo.filter((m) => !ativo.get(m.id)).size;
    if (perderiam >= 5 && perderiam > comCargo.size / 2) {
      throw new Error(`${perderiam} de ${comCargo.size} membros perderiam o cargo de uma vez — conferência abortada (confira o banco antes)`);
    }

    let removidos = 0, devolvidos = 0;
    for (const m of membros.values()) {
      if (m.user.bot) continue;
      const temCargo = m.roles.cache.has(ROLE_CLIENTE);
      if (temCargo && !ativo.get(m.id)) {
        const motivo = ativo.has(m.id) ? 'conta sem acesso ativo' : 'Discord não ligado a nenhuma conta';
        await m.roles.remove([ROLE_CLIENTE, ROLE_COMUNIDADE].filter((r) => m.roles.cache.has(r)), `Conferência: ${motivo}`);
        removidos++;
        await logStaff(`🚫 Perdeu o acesso · **${m.user.username}** \`${m.id}\` · ${motivo}`);
        if (ativo.has(m.id)) {
          await m.send({
            content: '👋 Seu acesso à área de alunos do **Narrativa IA** foi encerrado porque a sua conta está sem acesso ativo (assinatura vencida, cancelada ou reembolsada).\nVocê continua no servidor e pode voltar quando quiser.',
            components: linha(btnLink('Ver planos', '🛒', PLANOS)),
          }).catch(() => {});
        }
      } else if (!temCargo && ativo.get(m.id)) {
        await m.roles.add(ROLE_CLIENTE, 'Conferência: conta ativa');
        devolvidos++;
        await logStaff(`♻️ Acesso devolvido (conta ativa) · **${m.user.username}** \`${m.id}\``);
      }
    }
    console.log(`[Narrativa] conferência: ${membros.size} membros · ${removidos} removidos · ${devolvidos} devolvidos`);
    return { membros: membros.size, removidos, devolvidos };
  } finally {
    conferindo = false;
  }
}
async function conferirComAviso() {
  try { return await conferirAcessos(); }
  catch (err) {
    console.error('[Narrativa] erro na conferência:', err);
    await logStaff(`🔴 Erro na conferência de acessos · ${String(err.message || err).slice(0, 300)}`);
    return { erro: err.message };
  }
}

// ── mensagens fixas dos canais de entrada (posta uma vez; se já existe, edita) ──
const FIXAS = {
  [CH.boasVindas]: {
    embeds: [{
      title: '👋 Bem-vindo à comunidade do Narrativa IA',
      description:
        'Aqui é o lugar dos alunos do **Narrativa IA**: do nicho ao vídeo pronto, com roteiro, Studio e Elo IA.\n\n' +
        `**1.** Já é aluno? Libere sua área no <#${CH.ativar}> — leva 1 minuto.\n` +
        '**2.** Depois de ativar, abrem pra você o **#suporte** (o bot responde na hora e, se não resolver, a equipe assume), ' +
        'as **#perguntas-frequentes**, as **aulas** e a **comunidade**.\n\n' +
        `Novidades da ferramenta saem no <#${CH.avisos}>.`,
      color: COR, footer: { text: 'Equipe Narrativa' },
    }],
  },
  [CH.conheca]: {
    embeds: [{
      title: '📖 O que é o Narrativa IA',
      description:
        'Uma ferramenta pra montar canais de vídeo com IA, etapa por etapa:\n\n' +
        '🧭 **Nicho Lab** — Radar, Dobra de Nicho e Video Filter pra achar o que funciona\n' +
        '⚙️ **Canal** — configuração, personagens e kit do canal\n' +
        '📄 **Roteiro** — títulos, Fase 1 (narração) e Fase 2 (cenas)\n' +
        '🎬 **Studio** — voz, sincronização, thumbnail e o vídeo montado\n' +
        '⚡ **Elo IA** — o app que liga o Narrativa às IAs do seu computador',
      color: COR, footer: { text: 'Equipe Narrativa' },
    }],
    components: linha(btnLink('Ver os planos', '🛒', PLANOS)),
  },
  [CH.ativar]: {
    embeds: [{
      title: '🔑 Ative seu acesso',
      description:
        '**1.** No Narrativa, abra o seu **Perfil** › *Comunidade e suporte no Discord*.\n' +
        '**2.** Clique em **Gerar código** — aparece um código tipo `NV-7K2P` (vale 15 minutos).\n' +
        '**3.** Aqui, clique em **🔑 Ativar meu acesso** e cole o código.\n\n' +
        '-# Seu e-mail e sua senha nunca passam pelo Discord: o código é a prova de que a conta é sua.',
      color: COR, footer: { text: 'Equipe Narrativa' },
    }],
    components: linha(
      new ButtonBuilder().setCustomId('nv:ativar').setStyle(ButtonStyle.Primary).setLabel('Ativar meu acesso').setEmoji('🔑'),
      btnLink('Abrir meu Perfil', '👤', PERFIL),
    ),
  },
};
async function garantirFixas() {
  for (const [canalId, msg] of Object.entries(FIXAS)) {
    try {
      const canal = await client.channels.fetch(canalId);
      const minhas = (await canal.messages.fetch({ limit: 20 })).filter((m) => m.author.id === client.user.id);
      const existente = minhas.last();
      if (existente) await existente.edit(msg); else await canal.send(msg);
    } catch (err) {
      console.error('[Narrativa] mensagem fixa', canalId, err.message);
    }
  }
}

// ── eventos ─────────────────────────────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`✅ Narrativa Bot online: ${client.user.tag}`);
  try {
    await new REST().setToken(process.env.NARRATIVA_BOT_TOKEN).put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body: comandos });
    console.log('[Narrativa] comando /ativar registrado');
  } catch (err) {
    console.error('[Narrativa] erro ao registrar comandos:', err.message);
  }
  await garantirFixas();
  setTimeout(conferirComAviso, 60 * 1000);
  setInterval(conferirComAviso, CONFERIR_A_CADA);
});

client.on('interactionCreate', async (inter) => {
  if (inter.guildId !== GUILD_ID) return;
  if (inter.isButton() && inter.customId === 'nv:ativar') {
    return inter.showModal(new ModalBuilder().setCustomId('nv:modal-ativar').setTitle('Ativar meu acesso').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('codigo').setLabel('Código do seu Perfil do Narrativa')
        .setStyle(TextInputStyle.Short).setPlaceholder('NV-XXXX').setRequired(true).setMaxLength(20)),
    )).catch(() => {});
  }
  if (inter.isButton() && inter.customId.startsWith('nvpref:')) return preferencia(inter);
  const ehAtivar = (inter.isModalSubmit() && inter.customId === 'nv:modal-ativar') || (inter.isChatInputCommand() && inter.commandName === 'ativar');
  if (!ehAtivar) return;
  try {
    await inter.deferReply({ flags: MessageFlags.Ephemeral });   // resposta sempre privada
    await ativar(inter);
  } catch (err) {
    console.error('[Narrativa] erro no /ativar:', err);
    await logStaff(`🔴 Erro no /ativar · **${inter.user.username}** \`${inter.user.id}\` · ${String(err.message || err).slice(0, 300)}`);
    const msg = { content: '😕 Algo deu errado do nosso lado. Tente de novo em alguns minutos — a equipe já foi avisada.' };
    try { inter.deferred ? await inter.editReply(msg) : await inter.reply({ ...msg, flags: MessageFlags.Ephemeral }); } catch (_) {}
  }
});

// quem sai e volta: devolve o cargo se a conta ligada a ele continua ativa
client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  try {
    const { data } = await db().from('narrativa_users').select('active, expires_at').eq('discord_id', member.id).maybeSingle();
    if (contaAtiva(data)) {
      await member.roles.add([ROLE_CLIENTE, ROLE_COMUNIDADE], 'Voltou ao servidor com conta ativa');
      await logStaff(`↩️ Voltou e recuperou o cargo · **${member.user.username}** \`${member.id}\``);
    }
  } catch (err) {
    console.error('[Narrativa] erro no guildMemberAdd:', err.message);
  }
});

// código colado como mensagem comum (sem o botão/comando) → apaga e explica; !conferir-narrativa no Staff
const PADRAO_CODIGO = /\bNV[\s-]?[A-Z2-9]{4}\b/i;
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (msg.guildId === STAFF_GUILD && /^!conferir-narrativa\b/i.test(msg.content.trim())) {
    const r = await conferirComAviso();
    return msg.reply(r.erro ? `🔴 ${r.erro}` : `✅ Conferência do Narrativa: ${r.membros} membros · ${r.removidos} removidos · ${r.devolvidos} devolvidos`).catch(() => {});
  }
  if (msg.guildId === GUILD_ID && PADRAO_CODIGO.test(msg.content)) {
    await msg.delete().catch(() => {});
    await msg.channel.send({
      content: `<@${msg.author.id}> apaguei sua mensagem pra ninguém usar o seu código. Use o botão **🔑 Ativar meu acesso** no <#${CH.ativar}> — só você vê a resposta.`,
      allowedMentions: { users: [msg.author.id] },
    }).then((m) => setTimeout(() => m.delete().catch(() => {}), 20_000)).catch(() => {});
  }
});

// ── suporte (F3/E4, 26/10/26): o MESMO motor do CenaDrop (cenadrop-suporte.js) com o cfg do Narrativa ──
// Desligado até o Rayner ligar a env NARRATIVA_SUPORTE=1 no Railway. Sem diagnóstico N-XXXX por enquanto (E7) e base
// de respostas vazia até a E5 (o bot responde "ainda não tenho resposta pronta" e o post vira chamado no Estagiário).
const STAFF_SUP = { chamados: '1562683808803725312', fila: '1562683811118973029', diag: '1562683817611755530' };
if (process.env.NARRATIVA_SUPORTE === '1') {
  require('./cenadrop-suporte')(client, {
    db, logStaff,
    cfg: {
      produto: 'narrativa',
      guild: GUILD_ID,
      staffGuild: STAFF_GUILD,
      canais: { suporte: CH.suporte, faq: CH.faq, ...STAFF_SUP },
      cor: COR,
      equipe: 'Equipe Narrativa',
      padraoDiag: /\bN-[A-Z2-9]{4}\b/,
      diag: false,
      pedirDiag: false,
      kbArquivo: [],
      assuntosNaoTecnicos: ['Conta e acesso', 'Planos e outros'],
      outroProduto: null,
      etiquetasExtras: (assunto) => (assunto === 'Elo IA' ? ['Elo IA'] : []),
      contaDoDiscord: async (discordId) => {
        const { data: u } = await db().from('narrativa_users')
          .select('name, email, origin, active, expires_at').eq('discord_id', discordId).maybeSingle();
        if (!u) return { campo: 'Conta', texto: 'Discord não ligado a nenhuma conta do Narrativa' };
        const vence = u.expires_at ? ` · vence ${new Date(u.expires_at).toLocaleDateString('pt-BR')}` : '';
        return { campo: 'Conta', texto: `${u.name || '—'} · ${mascararEmail(u.email)} · ${u.origin || '—'}${vence} · ${contaAtiva(u) ? 'ativa ✅' : 'SEM ACESSO ⛔'}` };
      },
    },
  });
  console.log('[Narrativa] suporte ligado (NARRATIVA_SUPORTE=1)');
}

client.on('error', (err) => console.error('[Narrativa] client error:', err.message));

if (process.env.NARRATIVA_BOT_TOKEN) {
  client.login(process.env.NARRATIVA_BOT_TOKEN);
} else {
  console.warn('[Narrativa] NARRATIVA_BOT_TOKEN ausente — bot do Narrativa não iniciado');
}

module.exports = client;
