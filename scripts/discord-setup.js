/**
 * Script de configuração automática do servidor Elite Dark Academy.
 * Executa uma única vez para organizar tudo via API do Discord.
 *
 * node scripts/discord-setup.js
 */

const fs = require('fs');
const path = require('path');

// Carrega .env.local
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
const ROLE_MEMBRO_ELITE = '1508900115459477535';

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

// Canais somente leitura (Membro Elite não pode enviar mensagens)
const READONLY_CHANNELS = ['boas-vindas', 'regras', 'agenda', 'nos-bastidores'];

// Mensagem inicial de cada canal
const MENSAGENS = {
  'boas-vindas': `👑 **Bem-vindo ao Elite Dark Academy.**\n\nVocê agora faz parte de um círculo seleto.\n\nAqui você acompanha de perto como Marcos de Castro constrói — bastidores reais, ferramentas, pesquisas e encontros ao vivo.\n\n_Este canal é somente leitura. Use o **#💬geral** para interagir._`,
  'regras': `📋 **Regras do Elite Dark Academy**\n\n**1.** Respeito acima de tudo — com Marcos, com os outros membros e com o espaço.\n**2.** Sem spam, sem links não solicitados, sem autopublicidade.\n**3.** Dúvidas e conversas no **#💬geral**.\n**4.** Conteúdo compartilhado aqui é exclusivo — não reproduza fora do servidor.\n**5.** Membros que desrespeitarem as regras serão removidos sem aviso prévio.\n\n_Ao permanecer no servidor você concorda com estas regras._`,
};

async function main() {
  console.log('\n🔧 Iniciando configuração do Elite Dark Academy...\n');

  // 1. Busca todos os canais do servidor
  const channels = await api('GET', `/guilds/${GUILD_ID}/channels`);
  console.log(`📡 ${channels.length} canais encontrados`);

  // 2. Deleta todos os convites ativos
  console.log('\n🗑️  Deletando convites ativos...');
  const invites = await api('GET', `/guilds/${GUILD_ID}/invites`);
  if (!Array.isArray(invites)) {
    console.log(`  ⚠️  Sem permissão para listar convites — pulando`);
  } else if (!invites.length) {
    console.log('  Nenhum convite ativo.');
  } else {
    for (const inv of invites) {
      await api('DELETE', `/invites/${inv.code}`);
      console.log(`  ❌ Convite deletado: ${inv.code} (criado por ${inv.inviter?.username})`);
    }
  }

  // 3. Configura permissões dos canais somente leitura
  console.log('\n🔒 Configurando permissões dos canais...');
  for (const ch of channels) {
    if (ch.type !== 0) continue; // Somente canais de texto

    const isReadonly = READONLY_CHANNELS.some(name => ch.name.includes(name));
    if (!isReadonly) continue;

    // Bloqueia envio de mensagens para Membro Elite
    await api('PUT', `/channels/${ch.id}/permissions/${ROLE_MEMBRO_ELITE}`, {
      type: 0,        // role
      allow: '1024',  // VIEW_CHANNEL
      deny: '2048',   // SEND_MESSAGES
    });
    console.log(`  🔒 ${ch.name} — Membro Elite não pode postar`);
  }

  // 4. Muda canais de tópicos para texto normal e posta mensagens iniciais
  console.log('\n📝 Postando mensagens iniciais...');
  for (const ch of channels) {
    if (ch.type !== 0) continue;

    const key = Object.keys(MENSAGENS).find(name => ch.name.includes(name));
    if (!key) continue;

    // Verifica se já tem mensagens
    const msgs = await api('GET', `/channels/${ch.id}/messages?limit=1`);
    if (msgs && msgs.length > 0 && !msgs.error) {
      console.log(`  ⏩ ${ch.name} — já tem mensagem, pulando`);
      continue;
    }

    await api('POST', `/channels/${ch.id}/messages`, { content: MENSAGENS[key] });
    console.log(`  ✅ ${ch.name} — mensagem postada`);
  }

  console.log('\n✅ Configuração concluída!\n');
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
