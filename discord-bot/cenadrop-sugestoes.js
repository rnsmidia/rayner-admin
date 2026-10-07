/**
 * CenaDrop Bot — sugestão de resposta da IA dentro do chamado (#chamados do Staff)
 *
 * O Mac (rodada.py --reescritas, a cada 1 min, via Elo IA) posta no chamado um embed
 * "🤖 Sugestão de resposta" com rodapé `sug:<threadDoCliente>`. Aqui tratamos os botões:
 *   ✅ Enviar     → vai pro aluno como Equipe CenaDrop (mesmo caminho da resposta manual)
 *   ✏️ Editar     → caixa com o texto; ao enviar, vai a versão editada
 *   🔁 Reescrever → caixa "como você quer?"; rodapé ganha `|reescrever` e o Mac devolve outra versão
 *   🗑️ Descartar  → some; você responde do jeito de sempre, escrevendo no chamado
 */
const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');

module.exports = function sugestoes(client, { suporte, logStaff }) {
  const cidDe = (msg) => msg.embeds[0]?.footer?.text?.split('|')[0].match(/^sug:(\d+)/)?.[1];

  async function enviar(inter, msg, texto) {
    const cid = cidDe(msg);
    if (!cid) throw new Error('sugestão sem chamado ligado');
    // leva junto o "📚 Pra aprender mais" e os botões de vídeo/manual da sugestão
    const aprender = msg.embeds[0]?.fields?.find((f) => f.name === '📚 Pra aprender mais')?.value || null;
    const links = msg.components.flatMap((r) => r.components).filter((c) => c.url).map((c) => ({ label: c.label, url: c.url, emoji: c.emoji?.name }));
    await suporte.enviarAoCliente(cid, texto, [], inter.user.username, { aprender, links });
    const e = msg.embeds[0].toJSON();
    await msg.edit({ embeds: [{ ...e, color: 0x22C55E, title: `✅ Enviada ao aluno por ${inter.user.username}`, description: texto.slice(0, 4000) }], components: [] });
    await logStaff(`🤖✅ Sugestão da IA enviada por ${inter.user.username} · <#${msg.channelId}>`);
  }

  client.on('interactionCreate', async (inter) => {
    try {
      if (inter.isButton() && inter.customId.startsWith('sug:')) {
        const msg = inter.message;
        if (inter.customId === 'sug:enviar') { await inter.deferUpdate(); return enviar(inter, msg, msg.embeds[0].description || ''); }
        if (inter.customId === 'sug:del') {
          const e = msg.embeds[0].toJSON();
          return inter.update({ embeds: [{ ...e, color: 0x6B7280, title: `🗑️ Descartada por ${inter.user.username} — responda escrevendo no chamado` }], components: [] });
        }
        if (inter.customId === 'sug:edit') {
          return inter.showModal(new ModalBuilder().setCustomId(`sug:m-edit:${msg.id}`).setTitle('Editar antes de enviar').addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('texto').setLabel('Texto que vai pro aluno')
              .setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true).setValue((msg.embeds[0].description || '').slice(0, 4000)))));
        }
        if (inter.customId === 'sug:reesc') {
          return inter.showModal(new ModalBuilder().setCustomId(`sug:m-reesc:${msg.id}`).setTitle('Como você quer a resposta?').addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('orientacao').setLabel('Escreva do seu jeito; a IA ajusta o tom')
              .setStyle(TextInputStyle.Paragraph).setMaxLength(1500).setRequired(true)
              .setPlaceholder('Ex.: pede pra ele mandar o diagnóstico e explica que é a conta do Flow'))));
        }
        return;
      }
      if (inter.isModalSubmit() && inter.customId.startsWith('sug:m-')) {
        const [, tipo, id] = inter.customId.split(':');
        const msg = await inter.channel.messages.fetch(id);
        if (tipo === 'm-edit') {
          await inter.deferReply({ flags: MessageFlags.Ephemeral });
          await enviar(inter, msg, inter.fields.getTextInputValue('texto'));
          return inter.editReply('✅ Enviada ao aluno com a sua edição.');
        }
        if (tipo === 'm-reesc') {
          const e = msg.embeds[0].toJSON();
          const alvo = (e.footer?.text || '').split('|')[0];
          const campos = (e.fields || []).filter((f) => f.name !== 'Sua orientação');
          await msg.edit({
            embeds: [{ ...e, color: 0x3B82F6, title: `🔁 Reescrevendo com a orientação de ${inter.user.username}…`,
              fields: [...campos, { name: 'Sua orientação', value: inter.fields.getTextInputValue('orientacao').slice(0, 1000) }],
              footer: { text: `${alvo}|reescrever` } }],
            components: [],
          });
          return inter.reply({ content: '🔁 Pedido enviado. A nova versão chega aqui no chamado em 1–2 min (Mac e Elo IA ligados).', flags: MessageFlags.Ephemeral });
        }
      }
    } catch (err) {
      console.error('[Sugestões] erro:', err);
      const r = { content: `🔴 Não consegui: ${err.message}`, flags: MessageFlags.Ephemeral };
      try { inter.deferred || inter.replied ? await inter.followUp(r) : await inter.reply(r); } catch (_) {}
    }
  });
};
