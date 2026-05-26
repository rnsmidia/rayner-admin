/**
 * EDA Bot — Elite Dark Academy
 * Atribui cargo "Membro Elite" automaticamente quando aluno entra no servidor.
 * Roda 24/7 no Railway.
 */

const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

const GUILD_ID          = '1508895864540626986';
const ROLE_ID           = '1508900115459477535';
const WELCOME_CHANNEL   = '1508898202294816778';

client.once('ready', () => {
  console.log(`✅ EDA Bot online: ${client.user.tag}`);
});

client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== GUILD_ID) return;

  try {
    // Atribui o cargo Membro Elite
    await member.roles.add(ROLE_ID);
    console.log(`✅ Cargo atribuído: ${member.user.username}`);

    // Mensagem de boas-vindas no canal
    const channel = member.guild.channels.cache.get(WELCOME_CHANNEL);
    if (channel) {
      await channel.send(
        `👑 **${member.displayName}** acaba de entrar no círculo.\n` +
        `Bem-vindo ao **Elite Dark Academy**. Explore os canais e aproveite.`
      );
    }

    // DM de boas-vindas para o aluno
    try {
      await member.send(
        `Olá, **${member.displayName}**! 👑\n\n` +
        `Seu acesso ao **Elite Dark Academy** está confirmado.\n\n` +
        `Você agora faz parte de um círculo seleto. ` +
        `Explore os canais, acompanhe os bastidores e participe dos encontros ao vivo.\n\n` +
        `Qualquer dúvida, estamos nos canais.`
      );
    } catch (_) {
      // DM desativada pelo aluno — sem problema
    }

  } catch (err) {
    console.error(`❌ Erro ao processar entrada de ${member.user.username}:`, err.message);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
