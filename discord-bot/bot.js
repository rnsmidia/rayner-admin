/**
 * EDA Bot — Elite Dark Academy
 * - Atribui cargo "Membro Elite" quando aluno entra
 * - Rastreia qual invite foi usado → salva discord_user_id no Supabase
 * - Remove cargo quando Hotmart notifica cancelamento/reembolso
 */

const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
  ],
});

const GUILD_ID        = '1508895864540626986';
const ROLE_ID         = '1508900115459477535';
const WELCOME_CHANNEL = '1508898202294816778';

// Cache local de uses por invite code
let inviteCache = new Map();

function supabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

client.once('ready', async () => {
  console.log(`✅ EDA Bot online: ${client.user.tag}`);
  // Carrega todos os invites existentes no cache
  try {
    const guild   = client.guilds.cache.get(GUILD_ID);
    const invites = await guild.invites.fetch();
    inviteCache   = new Map(invites.map(inv => [inv.code, inv.uses]));
    console.log(`📋 Cache de invites carregado: ${inviteCache.size} invites`);
  } catch (err) {
    console.error('❌ Erro ao carregar cache de invites:', err.message);
  }
});

client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== GUILD_ID) return;

  try {
    // Atribui o cargo Membro Elite
    await member.roles.add(ROLE_ID);
    console.log(`✅ Cargo atribuído: ${member.user.username}`);

    // Descobre qual invite foi usado comparando cache anterior com o atual
    try {
      const newInvites = await member.guild.invites.fetch();
      const newMap = new Map(newInvites.map(inv => [inv.code, inv.uses]));

      // Caso 1: invite ainda existe mas com mais usos
      let usedCode = null;
      for (const [code, cachedUses] of inviteCache.entries()) {
        const currentUses = newMap.get(code);
        if (currentUses !== undefined && currentUses > cachedUses) {
          usedCode = code;
          break;
        }
      }

      // Caso 2: invite desapareceu da lista (max_uses=1 e foi usado → deletado pelo Discord)
      if (!usedCode) {
        for (const [code] of inviteCache.entries()) {
          if (!newMap.has(code)) {
            usedCode = code;
            break;
          }
        }
      }

      // Atualiza cache com o estado atual
      inviteCache.clear();
      newMap.forEach((uses, code) => inviteCache.set(code, uses));

      if (usedCode) {
        await supabase()
          .from('discord_invites')
          .update({ discord_user_id: member.user.id, used: true })
          .eq('invite_code', usedCode);
        console.log(`🔗 Invite ${usedCode} vinculado ao usuário ${member.user.id}`);
      } else {
        // Fallback: não identificou o invite pelo cache → vincula ao registro mais recente sem discord_user_id
        console.warn(`⚠️ Não foi possível identificar o invite usado por ${member.user.username} — usando fallback`);
        const { data: fallbackInvite } = await supabase()
          .from('discord_invites')
          .select('id, invite_code')
          .is('discord_user_id', null)
          .eq('revoked', false)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (fallbackInvite) {
          await supabase()
            .from('discord_invites')
            .update({ discord_user_id: member.user.id, used: true })
            .eq('id', fallbackInvite.id);
          console.log(`🔗 Fallback: invite ${fallbackInvite.invite_code} vinculado ao usuário ${member.user.id}`);
        } else {
          console.error(`❌ Fallback também falhou: nenhum invite pendente para ${member.user.username}`);
        }
      }
    } catch (invErr) {
      console.error('⚠️ Erro ao rastrear invite:', invErr.message);
    }

    // Mensagem de boas-vindas no canal
    const channel = member.guild.channels.cache.get(WELCOME_CHANNEL);
    if (channel) {
      await channel.send(
        `👑 Bem-vindo ao **Elite Dark Academy**, **${member.displayName}**!\n\n` +
        `Fico feliz em te ver aqui. Você acabou de entrar em um espaço exclusivo onde acompanha de perto o dia a dia de Marcos de Castro — bastidores reais, ferramentas, pesquisas e encontros ao vivo.\n\n` +
        `📌 **Para começar:**\n` +
        `→ Apresente-se no canal **#💬 geral**\n` +
        `→ Veja a agenda dos próximos encontros em **#📅 agenda**\n` +
        `→ Explore os bastidores em **#🎬 nos-bastidores**\n\n` +
        `Qualquer dúvida, é só chamar no **#💬 geral**. Estamos aqui!`
      );
    }

    // DM de boas-vindas
    try {
      await member.send(
        `Olá, **${member.displayName}**! 👑\n\n` +
        `Seu acesso ao **Elite Dark Academy** está confirmado. Seja muito bem-vindo!\n\n` +
        `Aqui estão os primeiros passos:\n\n` +
        `1️⃣ Abra o servidor pelo Discord (pode ser pelo celular ou computador)\n` +
        `2️⃣ Vá no canal **#💬 geral** e se apresente para a comunidade\n` +
        `3️⃣ Confira o canal **#📅 agenda** para não perder nenhum encontro ao vivo\n\n` +
        `Se tiver qualquer dificuldade para navegar, escreva no **#💬 geral** que te ajudamos.\n\n` +
        `Até breve! 🙌`
      );
    } catch (_) {
      // DM desativada pelo aluno — sem problema
    }

  } catch (err) {
    console.error(`❌ Erro ao processar entrada de ${member.user.username}:`, err.message);
  }
});

client.on('error', err => console.error('❌ Discord client error:', err.message));
client.on('warn',  msg => console.warn('⚠️ Discord warn:', msg));

process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException:', err.message);
});

client.login(process.env.DISCORD_BOT_TOKEN);
