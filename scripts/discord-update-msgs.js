/**
 * Atualiza as mensagens do EDA Bot nos canais #boas-vindas e #regras.
 * Busca a primeira mensagem de cada canal e edita via API do Discord.
 *
 * node scripts/discord-update-msgs.js
 */

const fs = require('fs');
const path = require('path');

(function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch (_) {}
})();

const TOKEN    = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = '1508895864540626986';

const api = async (method, endpoint, body) => {
  const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bot ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  return res.json();
};

const NOVAS_MENSAGENS = {
  'boas-vindas': [
    `👑 **Bem-vindo ao Elite Dark Academy!**`,
    ``,
    `Fico feliz em te ver aqui. Você acabou de entrar em um espaço exclusivo onde acompanha de perto o dia a dia de Marcos de Castro — bastidores reais, ferramentas, pesquisas e encontros ao vivo.`,
    ``,
    `📌 **Para começar:**`,
    `→ Apresente-se no canal **#💬 geral**`,
    `→ Veja a agenda dos próximos encontros em **#📅 agenda**`,
    `→ Explore os bastidores em **#🎬 nos-bastidores**`,
    ``,
    `Qualquer dúvida, é só chamar no **#💬 geral**. Estamos aqui!`,
    ``,
    `_Este canal é somente leitura._`,
  ].join('\n'),

  'regras': [
    `📋 **Regras do Elite Dark Academy**`,
    ``,
    `Este é um espaço de respeito, aprendizado e troca. Para que todos se sintam bem aqui, pedimos atenção a alguns pontos:`,
    ``,
    `**1. Respeite todos os membros** — trate as pessoas como gostaria de ser tratado.`,
    `**2. Sem divulgação de outros produtos ou serviços** — este espaço é exclusivo para nossa comunidade.`,
    `**3. Dúvidas e conversas** — use o canal **#💬 geral**.`,
    `**4. O conteúdo aqui é exclusivo** — por favor, não compartilhe fora do servidor.`,
    ``,
    `Ao permanecer no servidor você concorda com estas regras.`,
    `Em caso de dúvida sobre as regras, fale com a equipe no **#💬 geral**. 😊`,
  ].join('\n'),
};

async function main() {
  console.log('\n🔧 Atualizando mensagens do EDA Bot...\n');

  const channels = await api('GET', `/guilds/${GUILD_ID}/channels`);
  if (!Array.isArray(channels)) {
    console.error('❌ Erro ao buscar canais. Verifique o DISCORD_BOT_TOKEN.');
    process.exit(1);
  }

  for (const [nomeCanal, novoTexto] of Object.entries(NOVAS_MENSAGENS)) {
    const ch = channels.find(c => c.type === 0 && c.name.includes(nomeCanal));
    if (!ch) {
      console.log(`⚠️  Canal "${nomeCanal}" não encontrado — pulando`);
      continue;
    }

    // Busca as últimas mensagens e encontra a do bot
    const msgs = await api('GET', `/channels/${ch.id}/messages?limit=10`);
    if (!Array.isArray(msgs) || !msgs.length) {
      console.log(`⚠️  Nenhuma mensagem em #${ch.name} — pulando`);
      continue;
    }

    // Pega a mensagem mais antiga do bot (geralmente a primeira postada)
    const botMsg = msgs.reverse().find(m => m.author?.bot);
    if (!botMsg) {
      console.log(`⚠️  Nenhuma mensagem do bot em #${ch.name} — pulando`);
      continue;
    }

    const result = await api('PATCH', `/channels/${ch.id}/messages/${botMsg.id}`, {
      content: novoTexto,
    });

    if (result?.id) {
      console.log(`✅ #${ch.name} — mensagem atualizada (ID: ${botMsg.id})`);
    } else {
      console.log(`❌ #${ch.name} — erro ao atualizar:`, JSON.stringify(result));
    }
  }

  console.log('\n✅ Concluído!\n');
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
