/**
 * CenaDrop Bot — comunidade/suporte do CenaDrop (servidor separado do EDA)
 * - /ativar <chave>        → confere a licença, liga o Discord à chave e dá o cargo Cliente
 * - /minha-chave <e-mail>  → reenvia a chave ativa para o e-mail da compra
 * - Quem sai e volta recupera o cargo sozinho (pelo discord_id gravado na licença)
 * - A cada 30 min confere quem tem o cargo: chave desativada (reembolso, cancelamento,
 *   desativada no Admin) perde o cargo; chave reativada recebe de volta.
 *   `!conferir` no servidor Staff roda na hora.
 * - Tudo fica registrado no #ativacoes do servidor Staff
 *
 * Env: CENADROP_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY
 */

const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const APP_ID       = '1555368816140361778';
const GUILD_ID     = '1555365917578240130';
const STAFF_GUILD  = '1555367221541208105';
const ROLE_CLIENTE = '1555372672534454282';
const CH = {
  geral:    '1555365918278684775',
  suporte:  '1555372720517283931',
  vitrine:  '1555372703131766795',
  ativacoes: '1555372746572177519', // servidor Staff
};
const PLANOS   = 'https://www.cenadrop.com.br/planos';
const TEMPLATE = 'https://www.cenadrop.com.br/emails/cenadrop/reenvio-chave.html';
const COR = 0x7C3AED;
const CONFERIR_A_CADA = 30 * 60 * 1000;

// Linhas da tabela licenses que não são CenaDrop
const PRODUTOS_FORA = new Set(['nx_visit', 'nxsaude']);

const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ativa = (l) => l.active !== false && l.status !== 'inactive';
const ehCenaDrop = (l) => !PRODUTOS_FORA.has(l.product) && !/test postback/i.test(l.product || '');
const mascarar = (k) => k.length > 8 ? `${k.slice(0, 3)}…${k.slice(-4)}` : '…';
const mascararEmail = (e) => e.replace(/^(.).*?(.)?@/, (_, a, b) => `${a}***${b || ''}@`);

const client = new Client({ intents: [
  GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
] });

async function logStaff(texto) {
  try {
    const ch = await client.channels.fetch(CH.ativacoes);
    await ch.send({ content: texto, allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[CenaDrop] falha ao registrar no Staff:', err.message);
  }
}

function botaoPlanos() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Ver planos').setEmoji('🛒').setURL(PLANOS),
  )];
}

const comandos = [
  new SlashCommandBuilder()
    .setName('ativar')
    .setDescription('Libere a comunidade e o suporte com a sua chave do CenaDrop')
    .addStringOption((o) => o.setName('chave').setDescription('Sua chave (ex.: CD-XXXX-XXXX-XXXX)').setRequired(true)),
  new SlashCommandBuilder()
    .setName('minha-chave')
    .setDescription('Reenvia a sua chave para o e-mail usado na compra')
    .addStringOption((o) => o.setName('email').setDescription('O e-mail da compra').setRequired(true)),
].map((c) => c.toJSON());

// ── /ativar ─────────────────────────────────────────────────────────────────
async function ativar(inter) {
  const chave = inter.options.getString('chave').trim().toUpperCase();
  const user = inter.user;

  const { data: lic, error } = await db()
    .from('licenses')
    .select('key, email, name, active, status, source, product, discord_id')
    .eq('key', chave)
    .maybeSingle();
  if (error) throw error;

  if (!lic || !ehCenaDrop(lic)) {
    await logStaff(`❓ /ativar com chave inexistente · **${user.username}** \`${user.id}\` · \`${mascarar(chave)}\``);
    return inter.editReply({
      content: '❌ **Não encontrei essa chave.**\nConfira se copiou inteira, no formato `CD-XXXX-XXXX-XXXX`.\nNão tem a chave em mãos? Use `/minha-chave` com o e-mail da compra.',
    });
  }

  if (!ativa(lic)) {
    await logStaff(`⛔ /ativar com chave desativada · **${user.username}** \`${user.id}\` · ${mascararEmail(lic.email || '')} · ${lic.source || ''}`);
    return inter.editReply({
      content: '⛔ **Essa chave está desativada.** Isso acontece quando a assinatura foi cancelada ou reembolsada.\nPara voltar a usar o CenaDrop, escolha um plano:',
      components: botaoPlanos(),
    });
  }

  if (lic.discord_id && lic.discord_id !== user.id) {
    await logStaff(`⚠️ **Chave já ligada a outro Discord** · tentou: **${user.username}** \`${user.id}\` · dono atual: \`${lic.discord_id}\` · ${mascararEmail(lic.email || '')} · \`${mascarar(lic.key)}\``);
    return inter.editReply({
      content: '⚠️ **Essa chave já foi ativada por outra conta do Discord.**\nCada chave libera uma conta. Se a outra conta também é sua, entre por ela.\nAvisamos a equipe e, se for o caso, ela entra em contato.',
    });
  }

  if (!lic.discord_id) {
    const { error: upErr } = await db()
      .from('licenses')
      .update({ discord_id: user.id, discord_linked_at: new Date().toISOString() })
      .eq('key', lic.key);
    if (upErr) throw upErr;
  }

  const membro = await inter.guild.members.fetch(user.id);
  await membro.roles.add(ROLE_CLIENTE, 'Ativou com chave CenaDrop');

  const primeiro = (lic.name || '').split(' ')[0];
  await logStaff(`✅ Ativou · **${user.username}** \`${user.id}\` · ${lic.name || '—'} · ${mascararEmail(lic.email || '')} · ${lic.source || ''}`);
  return inter.editReply({
    content:
      `✅ **Acesso liberado${primeiro ? `, ${primeiro}` : ''}!** Bem-vindo à comunidade CenaDrop.\n\n` +
      `💬 Apresente-se em <#${CH.geral}>\n` +
      `🛟 Dúvida ou problema? Abra um post em <#${CH.suporte}>\n` +
      `✨ Mostre suas melhores cenas na <#${CH.vitrine}>`,
  });
}

// ── /minha-chave ────────────────────────────────────────────────────────────
const pedidos = new Map(); // userId → timestamps (limite de 3 por hora)

async function minhaChave(inter) {
  const email = inter.options.getString('email').trim().toLowerCase();
  const user = inter.user;
  const resposta = '📧 **Pronto.** Se esse e-mail tiver uma compra ativa do CenaDrop, a chave foi enviada para ele agora.\nConfira também a caixa de **spam** e a aba **Promoções**.';

  const agora = Date.now();
  const recentes = (pedidos.get(user.id) || []).filter((t) => agora - t < 3600e3);
  if (recentes.length >= 3) {
    return inter.editReply({ content: '⏳ Você já pediu o reenvio 3 vezes na última hora. Aguarde um pouco e confira o spam.' });
  }
  pedidos.set(user.id, [...recentes, agora]);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return inter.editReply({ content: '❌ Esse e-mail parece incompleto. Digite o e-mail inteiro usado na compra.' });
  }

  const { data: lista, error } = await db()
    .from('licenses')
    .select('key, email, name, active, status, source, product, created_at')
    .ilike('email', email)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const lic = (lista || []).filter(ehCenaDrop).find(ativa);
  if (!lic) {
    const motivo = (lista || []).some(ehCenaDrop) ? 'só chave desativada' : 'e-mail sem compra';
    await logStaff(`📭 /minha-chave sem envio (${motivo}) · **${user.username}** \`${user.id}\` · ${mascararEmail(email)}`);
    return inter.editReply({ content: resposta });
  }

  const html = (await (await fetch(TEMPLATE)).text())
    .replace(/\{\{PRIMEIRO_NOME\}\}/g, (lic.name || 'Cliente').split(' ')[0])
    .replace(/\{\{CHAVE\}\}/g, lic.key)
    .replace(/\{\{LINK_DOWNLOAD\}\}/g, 'https://cenadrop.com.br/download');

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'CenaDrop <contato@cenadrop.com.br>',
      to: lic.email,
      subject: '🔑 Sua chave CenaDrop Flow',
      html,
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);

  await logStaff(`📧 Chave reenviada pelo /minha-chave · **${user.username}** \`${user.id}\` · ${mascararEmail(lic.email)}`);
  return inter.editReply({ content: resposta });
}


// ── conferência de acesso (reembolso/cancelamento tira o cargo) ─────────────
let conferindo = false;
async function conferirAcessos() {
  if (conferindo) return { ignorado: true };
  conferindo = true;
  try {
    const { data, error } = await db()
      .from('licenses')
      .select('key, active, status, product, discord_id')
      .not('discord_id', 'is', null);
    if (error) throw error;

    // discord_id → tem alguma chave CenaDrop ativa?
    const ativo = new Map();
    for (const l of data.filter(ehCenaDrop)) {
      ativo.set(l.discord_id, ativo.get(l.discord_id) || ativa(l));
    }

    const guild = await client.guilds.fetch(GUILD_ID);
    const membros = await guild.members.fetch();

    // Trava: banco devolveu vazio mas tem gente com cargo → algo errado, não remove ninguém
    const comCargo = membros.filter((m) => m.roles.cache.has(ROLE_CLIENTE)).size;
    if (ativo.size === 0 && comCargo > 0) {
      throw new Error(`banco devolveu 0 licenças ligadas mas ${comCargo} membros têm o cargo — conferência abortada`);
    }
    let removidos = 0, devolvidos = 0;

    for (const m of membros.values()) {
      if (m.user.bot) continue;
      const temCargo = m.roles.cache.has(ROLE_CLIENTE);

      if (temCargo && !ativo.get(m.id)) {
        const motivo = ativo.has(m.id) ? 'chave desativada' : 'sem chave ligada';
        await m.roles.remove(ROLE_CLIENTE, `Conferência: ${motivo}`);
        removidos++;
        await logStaff(`🚫 Perdeu o acesso · **${m.user.username}** \`${m.id}\` · ${motivo}`);
        if (motivo === 'chave desativada') {
          await m.send({
            content: '👋 Seu acesso à área de clientes do **CenaDrop** foi encerrado porque a sua chave foi desativada (assinatura cancelada ou reembolso).\nVocê continua no servidor e pode voltar quando quiser: é só escolher um plano e ativar a chave nova com `/ativar`.',
            components: botaoPlanos(),
          }).catch(() => {});
        }
      } else if (!temCargo && ativo.get(m.id)) {
        await m.roles.add(ROLE_CLIENTE, 'Conferência: chave ativa');
        devolvidos++;
        await logStaff(`♻️ Acesso devolvido (chave ativa de novo) · **${m.user.username}** \`${m.id}\``);
      }
    }
    console.log(`[CenaDrop] conferência: ${membros.size} membros · ${removidos} removidos · ${devolvidos} devolvidos`);
    return { membros: membros.size, removidos, devolvidos };
  } finally {
    conferindo = false;
  }
}

async function conferirComAviso() {
  try {
    return await conferirAcessos();
  } catch (err) {
    console.error('[CenaDrop] erro na conferência:', err);
    await logStaff(`🔴 Erro na conferência de acessos · ${String(err.message || err).slice(0, 300)}`);
    return { erro: err.message };
  }
}

// ── eventos ─────────────────────────────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`✅ CenaDrop Bot online: ${client.user.tag}`);
  try {
    await new REST().setToken(process.env.CENADROP_BOT_TOKEN)
      .put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body: comandos });
    console.log('[CenaDrop] comandos /ativar e /minha-chave registrados');
  } catch (err) {
    console.error('[CenaDrop] erro ao registrar comandos:', err.message);
  }
  setTimeout(conferirComAviso, 60 * 1000);
  setInterval(conferirComAviso, CONFERIR_A_CADA);
});

client.on('interactionCreate', async (inter) => {
  if (!inter.isChatInputCommand() || inter.guildId !== GUILD_ID) return;
  try {
    // Resposta sempre privada: chave e e-mail nunca aparecem pros outros
    await inter.deferReply({ flags: MessageFlags.Ephemeral });
    if (inter.commandName === 'ativar') await ativar(inter);
    else if (inter.commandName === 'minha-chave') await minhaChave(inter);
  } catch (err) {
    console.error(`[CenaDrop] erro no /${inter.commandName}:`, err);
    await logStaff(`🔴 Erro no /${inter.commandName} · **${inter.user.username}** \`${inter.user.id}\` · ${String(err.message || err).slice(0, 300)}`);
    const msg = { content: '😕 Algo deu errado do nosso lado. Tente de novo em alguns minutos — a equipe já foi avisada.' };
    try { inter.deferred ? await inter.editReply(msg) : await inter.reply({ ...msg, flags: MessageFlags.Ephemeral }); } catch (_) {}
  }
});

// Quem sai e volta: devolve o cargo se a chave ligada a ele ainda está ativa
client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  try {
    const { data } = await db()
      .from('licenses')
      .select('key, active, status, product')
      .eq('discord_id', member.id);
    if ((data || []).filter(ehCenaDrop).some(ativa)) {
      await member.roles.add(ROLE_CLIENTE, 'Voltou ao servidor com chave ativa');
      await logStaff(`↩️ Voltou e recuperou o cargo · **${member.user.username}** \`${member.id}\``);
    }
  } catch (err) {
    console.error('[CenaDrop] erro no guildMemberAdd:', err.message);
  }
});

// Chave colada como mensagem comum (sem usar o comando) → apaga na hora
const PADRAO_CHAVE = /\bCD-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b|\bRN-\d{6}\b/i;
client.on('messageCreate', async (msg) => {
  // `!conferir` no Staff roda a conferência na hora
  if (msg.guildId === STAFF_GUILD && !msg.author.bot && msg.content.trim().toLowerCase() === '!conferir') {
    const r = await conferirComAviso();
    const txt = r.erro ? `🔴 Erro: ${r.erro}` : r.ignorado ? '⏳ Já tem uma conferência rodando.'
      : `🔎 Conferência feita · ${r.membros} membros · ${r.removidos} perderam o acesso · ${r.devolvidos} recuperaram`;
    return msg.reply(txt).catch(() => {});
  }
  if (msg.guildId !== GUILD_ID || msg.author.bot || !PADRAO_CHAVE.test(msg.content)) return;
  try {
    await msg.delete();
    const aviso = '🔒 Apagamos a sua mensagem porque ela tinha uma **chave do CenaDrop** — chave é pessoal e não deve ficar visível.\nPara ativar, digite `/ativar` e **clique na opção que aparece no menu**; aí a chave vai direto pro bot, sem ninguém ver.';
    try { await msg.author.send(aviso); }
    catch (_) {
      const r = await msg.channel.send({ content: `<@${msg.author.id}> ${aviso}` });
      setTimeout(() => r.delete().catch(() => {}), 30000);
    }
    await logStaff(`🔒 Chave apagada de mensagem pública · **${msg.author.username}** \`${msg.author.id}\` · #${msg.channel.name}`);
  } catch (err) {
    console.error('[CenaDrop] erro ao apagar chave exposta:', err.message);
  }
});

client.on('error', (err) => console.error('[CenaDrop] client error:', err.message));

if (process.env.CENADROP_BOT_TOKEN) {
  client.login(process.env.CENADROP_BOT_TOKEN);
} else {
  console.warn('[CenaDrop] CENADROP_BOT_TOKEN ausente — bot do CenaDrop não iniciado');
}

module.exports = client;
