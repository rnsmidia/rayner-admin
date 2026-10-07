/**
 * CenaDrop Bot — diagnósticos da extensão no Discord (#diagnosticos do Staff)
 *
 * A cada 2 min: diagnóstico novo enviado pelo BOTÃO do aluno (tipo 'botao', avisado_em vazio)
 * vira um cartão no #diagnosticos com 💬 Responder e 👀 Marcar como visto.
 * A resposta chega no aluno pelo melhor caminho disponível:
 *   1. chamado aberto no #suporte que citou o código → resposta no chamado (marca o aluno)
 *   2. chave ligada ao Discord → mensagem privada do bot + botão pro #suporte
 *   3. senão → e-mail (Resend) com o convite do Discord
 * O diagnóstico guarda status (visto/respondido), a resposta, quem, quando e por onde.
 */

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');

const CANAL = '1557199153254105141';           // #diagnosticos (Staff)
const SUPORTE_URL = 'https://discord.com/channels/1555365917578240130/1555372720517283931';
const CONVITE = 'https://discord.gg/SGEVxaurAw';
const INTERVALO = 2 * 60 * 1000;
const COR = 0x7C3AED;

const mascararEmail = (e) => (e || '').replace(/^(.).*?(.)?@/, (_, a, b) => `${a}***${b || ''}@`);
const resumoNavegador = (ua = '') => {
  const nav = ua.match(/(Edg|OPR|Brave|Chrome|Firefox|Safari)\/[\d.]+/)?.[0]?.split('.')[0] || '?';
  const so = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : '?';
  return `${so} · ${nav}`;
};

module.exports = function diagnosticos(client, { db, logStaff, suporte }) {
  const botoes = (id) => [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`diag:resp:${id}`).setStyle(ButtonStyle.Primary).setLabel('Responder').setEmoji('💬'),
    new ButtonBuilder().setCustomId(`diag:visto:${id}`).setStyle(ButtonStyle.Secondary).setLabel('Marcar como visto').setEmoji('👀'),
  )];

  async function licencaDe(chave) {
    if (!chave) return null;
    const { data } = await db().from('licenses').select('key, email, name, discord_id, active, status').eq('key', chave).maybeSingle();
    return data;
  }

  async function avisarNovos() {
    const { data: novos, error } = await db().from('cenadrop_diagnosticos')
      .select('id, codigo, criado, chave, email, nome, versao, plataforma, navegador, mensagem, resumo, n_linhas')
      .eq('tipo', 'botao').is('avisado_em', null).order('criado').limit(20);
    if (error) throw error;
    if (!novos?.length) return;
    const canal = await client.channels.fetch(CANAL);
    for (const d of novos) {
      const lic = await licencaDe(d.chave);
      const chamado = suporte.chamadoComCodigo(d.codigo);
      const destino = chamado ? '📌 tem chamado aberto no #suporte' : lic?.discord_id ? '💬 Discord ligado (vai por mensagem privada)' : '📧 sem Discord (vai por e-mail)';
      const m = await canal.send({
        embeds: [{
          title: `🩺 ${d.codigo} · ${d.nome || 'sem nome'}`,
          description: d.mensagem ? `**Recado do aluno:** "${d.mensagem.slice(0, 1500)}"` : '_(sem recado)_',
          color: 0xEAB308,
          fields: [
            { name: 'Ambiente', value: `v${d.versao || '?'} · ${d.plataforma || '?'} · ${resumoNavegador(d.navegador)} · ${d.n_linhas || 0} linhas de registro`, inline: false },
            { name: 'Erros', value: (d.resumo || 'nenhum registrado').slice(0, 1000), inline: false },
            { name: 'Aluno', value: `${mascararEmail(d.email || lic?.email)} · ${lic ? (lic.active !== false && lic.status !== 'inactive' ? 'chave ativa ✅' : 'chave DESATIVADA ⛔') : 'chave não encontrada'}`, inline: false },
            { name: 'A resposta vai por', value: destino, inline: false },
          ],
          footer: { text: `Detalhe completo: Admin › CenaDrop › 🩺 Diagnósticos · diag:${d.id}` },
          timestamp: d.criado,
        }],
        components: botoes(d.id),
      });
      await db().from('cenadrop_diagnosticos')
        .update({ avisado_em: new Date().toISOString(), staff_msg_id: m.id, status: 'novo' }).eq('id', d.id);
    }
    await logStaff(`🩺 ${novos.length} diagnóstico(s) novo(s) no #diagnosticos`);
  }

  async function entregar(d, texto) {
    // 1. chamado aberto que citou o código
    const chamado = suporte.chamadoComCodigo(d.codigo);
    if (chamado) {
      await suporte.enviarAoCliente(chamado, texto);
      return 'chamado';
    }
    // 2. mensagem privada no Discord
    const lic = await licencaDe(d.chave);
    if (lic?.discord_id) {
      try {
        const user = await client.users.fetch(lic.discord_id);
        await user.send({
          embeds: [{
            author: { name: 'Equipe CenaDrop', icon_url: client.user.displayAvatarURL() },
            title: `Sobre o seu diagnóstico ${d.codigo}`,
            description: texto.slice(0, 4000), color: COR,
            footer: { text: 'Precisa continuar a conversa? Abra um post no #suporte citando o código.' },
          }],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Abrir o #suporte').setEmoji('🛟').setURL(SUPORTE_URL),
          )],
        });
        return 'dm';
      } catch (_) { /* DM fechada → cai pro e-mail */ }
    }
    // 3. e-mail
    const para = d.email || lic?.email;
    if (!para) throw new Error('aluno sem Discord ligado e sem e-mail');
    const primeiro = (d.nome || lic?.name || '').split(' ')[0] || 'tudo bem';
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f1d2b">
      <p style="font-size:13px;color:#7C3AED;font-weight:bold;letter-spacing:.5px">CENADROP · SUPORTE</p>
      <h2 style="margin:4px 0 16px">Analisamos o seu diagnóstico ${d.codigo}</h2>
      <p>Oi, ${esc(primeiro)}!</p>
      <div style="background:#f4f1fb;border-left:4px solid #7C3AED;padding:14px 16px;border-radius:6px;white-space:pre-wrap">${esc(texto)}</div>
      <p style="margin-top:20px">Se precisar continuar, o suporte do CenaDrop agora fica na nossa comunidade no Discord: abra um post no <b>#suporte</b> citando o código <b>${d.codigo}</b>.</p>
      <p><a href="${CONVITE}" style="background:#7C3AED;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Entrar na comunidade CenaDrop</a></p>
      <p style="color:#888;font-size:12px;margin-top:24px">Equipe CenaDrop</p></div>`;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'CenaDrop <contato@cenadrop.com.br>', to: para, subject: `🩺 Seu diagnóstico ${d.codigo} foi analisado`, html }),
    });
    if (!r.ok) throw new Error(`e-mail recusado (${r.status})`);
    return 'email';
  }

  const VIA = { chamado: '📌 no chamado do #suporte', dm: '💬 por mensagem privada no Discord', email: '📧 por e-mail' };

  client.on('interactionCreate', async (inter) => {
    try {
      if (inter.isButton() && inter.customId.startsWith('diag:')) {
        const [, acao, id] = inter.customId.split(':');
        if (acao === 'visto') {
          await db().from('cenadrop_diagnosticos').update({ status: 'visto' }).eq('id', id).or('status.is.null,status.neq.respondido');
          const e = inter.message.embeds[0].toJSON();
          return inter.update({ embeds: [{ ...e, color: 0x3B82F6, title: `👀 ${e.title.replace(/^🩺 /, '')} · visto por ${inter.user.username}` }], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`diag:resp:${id}`).setStyle(ButtonStyle.Primary).setLabel('Responder').setEmoji('💬'))] });
        }
        if (acao === 'resp') {
          const modal = new ModalBuilder().setCustomId(`diag:modal:${id}`).setTitle('Resposta pro aluno');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('texto').setLabel('O que você analisou e o que ele deve fazer')
              .setStyle(TextInputStyle.Paragraph).setMaxLength(3500).setRequired(true),
          ));
          return inter.showModal(modal);
        }
      }
      if (inter.isModalSubmit() && inter.customId.startsWith('diag:modal:')) {
        await inter.deferReply({ flags: MessageFlags.Ephemeral });
        const id = inter.customId.split(':')[2];
        const { data: d } = await db().from('cenadrop_diagnosticos').select('id, codigo, chave, email, nome').eq('id', id).maybeSingle();
        if (!d) return inter.editReply('Diagnóstico não encontrado.');
        const texto = inter.fields.getTextInputValue('texto');
        const via = await entregar(d, texto);
        await db().from('cenadrop_diagnosticos').update({
          status: 'respondido', resposta: texto, respondido_em: new Date().toISOString(),
          respondido_por: inter.user.username, respondido_via: via,
        }).eq('id', id);
        const e = inter.message.embeds[0].toJSON();
        await inter.message.edit({
          embeds: [{ ...e, color: 0x22C55E, title: `✅ ${d.codigo} · respondido ${VIA[via]}`,
            fields: [...(e.fields || []).filter((f) => f.name !== 'A resposta vai por' && f.name !== 'Resposta'), { name: 'Resposta', value: texto.slice(0, 1000) }] }],
          components: [],
        });
        await logStaff(`✅ Diagnóstico ${d.codigo} respondido ${VIA[via]} por ${inter.user.username}`);
        return inter.editReply(`✅ Entregue ${VIA[via]}.`);
      }
    } catch (err) {
      console.error('[Diagnósticos] erro:', err);
      const r = { content: `🔴 Não consegui entregar: ${err.message}`, flags: MessageFlags.Ephemeral };
      try { inter.deferred || inter.replied ? await inter.editReply(r) : await inter.reply(r); } catch (_) {}
    }
  });

  client.once('clientReady', () => {
    const rodar = () => avisarNovos().catch((err) => console.error('[Diagnósticos] aviso:', err.message));
    setTimeout(rodar, 45 * 1000);
    setInterval(rodar, INTERVALO);
  });
};
