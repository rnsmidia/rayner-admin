/**
 * CenaDrop Bot — rascunhos da IA pra comunidade (#rascunhos do Staff)
 *
 * O script `rodada-comunidade` (Mac do Rayner, 13h e 19h, via Elo IA) posta cada sugestão
 * como embed no #rascunhos com rodapé `alvo:reply:<canal>:<msg>` ou `alvo:post:<canal>`.
 * Aqui só tratamos os botões:
 *   ✅ Publicar   → o bot responde/posta no servidor CenaDrop como "Equipe CenaDrop"
 *   ✏️ Editar     → abre uma caixa com o texto; ao enviar, publica a versão editada
 *   🗑️ Descartar  → marca como descartado
 *   🔁 Reescrever → caixa "como você quer a resposta?"; o rascunho fica marcado `|reescrever`
 *                   e o Mac (rodada.py --reescritas, a cada 1 min) devolve a nova versão pra aprovar
 */

const {
  ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');

const GUILD_ID = '1555365917578240130';
const COR = 0x7C3AED;

module.exports = function rascunhos(client, { logStaff }) {
  const alvoDe = (msg) => msg.embeds[0]?.footer?.text?.split('|')[0].match(/^alvo:(reply|post):(\d+)(?::(\d+))?/);

  async function publicar(rascunho, texto, quem) {
    const alvo = alvoDe(rascunho);
    if (!alvo) throw new Error('rascunho sem destino');
    const [, tipo, canalId, msgId] = alvo;
    const canal = await client.channels.fetch(canalId);
    if (canal.guildId !== GUILD_ID) throw new Error('destino fora do servidor CenaDrop');
    const embed = { author: { name: 'Equipe CenaDrop', icon_url: client.user.displayAvatarURL() }, description: texto.slice(0, 4000), color: COR };
    let enviada;
    if (tipo === 'reply') {
      const original = await canal.messages.fetch(msgId);
      enviada = await original.reply({ embeds: [embed], allowedMentions: { users: [original.author.id], repliedUser: true } });
    } else {
      enviada = await canal.send({ embeds: [embed], allowedMentions: { parse: [] } });
    }
    const e = rascunho.embeds[0].toJSON();
    await rascunho.edit({
      embeds: [{ ...e, description: texto.slice(0, 4000), color: 0x22C55E, title: `✅ Publicado por ${quem}` }],
      components: [],
      content: enviada.url,
    });
    await logStaff(`💬 Interação da IA publicada por ${quem} · ${enviada.url}`);
  }

  client.on('interactionCreate', async (inter) => {
    try {
      if (inter.isButton() && inter.customId.startsWith('rasc:')) {
        const msg = inter.message;
        if (inter.customId === 'rasc:pub') {
          await inter.deferUpdate();
          return publicar(msg, msg.embeds[0].description || '', inter.user.username);
        }
        if (inter.customId === 'rasc:del') {
          const e = msg.embeds[0].toJSON();
          return inter.update({ embeds: [{ ...e, color: 0x6B7280, title: `🗑️ Descartado por ${inter.user.username}` }], components: [] });
        }
        if (inter.customId === 'rasc:reesc') {
          const modal = new ModalBuilder().setCustomId(`rasc:reescmodal:${msg.id}`).setTitle('Como você quer a resposta?');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('orientacao').setLabel('Escreva do seu jeito; a IA ajusta o tom')
              .setStyle(TextInputStyle.Paragraph).setMaxLength(1500).setRequired(true)
              .setPlaceholder('Ex.: agradece, diz que foto de frente ajuda no personagem e manda ver o vídeo 003'),
          ));
          return inter.showModal(modal);
        }
        if (inter.customId === 'rasc:edit') {
          const modal = new ModalBuilder().setCustomId(`rasc:modal:${msg.id}`).setTitle('Editar antes de publicar');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('texto').setLabel('Texto que vai ser publicado')
              .setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true)
              .setValue((msg.embeds[0].description || '').slice(0, 4000)),
          ));
          return inter.showModal(modal);
        }
      }
      if (inter.isModalSubmit() && inter.customId.startsWith('rasc:reescmodal:')) {
        const msg = await inter.channel.messages.fetch(inter.customId.split(':')[2]);
        const e = msg.embeds[0].toJSON();
        const alvo = (e.footer?.text || '').split('|')[0];
        const campos = (e.fields || []).filter((f) => f.name !== 'Sua orientação');
        await msg.edit({
          embeds: [{ ...e, color: 0x3B82F6, title: `🔁 Reescrevendo com a orientação de ${inter.user.username}…`,
            fields: [...campos, { name: 'Sua orientação', value: inter.fields.getTextInputValue('orientacao').slice(0, 1000) }],
            footer: { text: `${alvo}|reescrever` } }],
          components: [],
        });
        return inter.reply({ content: '🔁 Pedido enviado. A nova versão chega aqui no #rascunhos em 1–2 min (precisa do Mac e do Elo IA ligados).', flags: MessageFlags.Ephemeral });
      }
      if (inter.isModalSubmit() && inter.customId.startsWith('rasc:modal:')) {
        await inter.deferReply({ flags: MessageFlags.Ephemeral });
        const msg = await inter.channel.messages.fetch(inter.customId.split(':')[2]);
        await publicar(msg, inter.fields.getTextInputValue('texto'), inter.user.username);
        return inter.editReply('✅ Publicado com a sua edição.');
      }
    } catch (err) {
      console.error('[Rascunhos] erro:', err);
      const r = { content: `🔴 Não consegui publicar: ${err.message}`, flags: MessageFlags.Ephemeral };
      try { inter.deferred || inter.replied ? await inter.followUp(r) : await inter.reply(r); } catch (_) {}
    }
  });
};
