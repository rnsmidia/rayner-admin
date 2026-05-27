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
        `👑 Bem-vindo ao **Elite Dark Academy**, **${member.displayName}**!\n\n` +
        `Fico feliz em te ver aqui. Você acabou de entrar em um espaço exclusivo onde acompanha de perto o dia a dia de Marcos de Castro — bastidores reais, ferramentas, pesquisas e encontros ao vivo.\n\n` +
        `📌 **Para começar:**\n` +
        `→ Apresente-se no canal **#💬 geral**\n` +
        `→ Veja a agenda dos próximos encontros em **#📅 agenda**\n` +
        `→ Explore os bastidores em **#🎬 nos-bastidores**\n\n` +
        `Qualquer dúvida, é só chamar no **#💬 geral**. Estamos aqui!`
      );
    }

    // DM de boas-vindas para o aluno
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

client.login(process.env.DISCORD_BOT_TOKEN);
