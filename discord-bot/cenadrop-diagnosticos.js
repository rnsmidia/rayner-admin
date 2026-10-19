/**
 * CenaDrop Bot — diagnósticos da extensão no Discord (#diagnosticos do Staff)
 *
 * A cada 2 min: diagnóstico novo enviado pelo BOTÃO do aluno (tipo 'botao', avisado_em vazio)
 * vira um cartão no #diagnosticos. Desde 16/10/26 a FILA É ÚNICA: responde-se no #suporte.
 *   1. aluno já abriu chamado citando o código → cartão ganha 📌 Abrir o chamado
 *   2. chave ligada ao Discord e nenhum chamado em 10 min → o bot abre o post no #suporte
 *      em nome do aluno (abrirChamadoDoDiagnostico) e o cartão ganha 📌 Abrir o chamado
 *   3. sem Discord (ou saiu do servidor) → chamado 📧 no #chamados (passo 2, 19/10/26): responde lá, sai por e-mail
 * Desde o passo 2 o cartão daqui é só ARQUIVO técnico (sem botões): tudo se responde no #chamados.
 * O diagnóstico guarda status (visto/respondido), a resposta, quem, quando e por onde.
 */

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const { enviarEmailDiag } = require('./cenadrop-email');

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
  const ESPERA = 10 * 60 * 1000;            // tempo pro aluno abrir o chamado sozinho
  const encerrar = (id) => new ButtonBuilder().setCustomId(`diag:encerrar:${id}`).setStyle(ButtonStyle.Secondary).setLabel('Encerrar sem resposta').setEmoji('✔️');
  const botoesEmail = (id) => [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`diag:resp:${id}`).setStyle(ButtonStyle.Primary).setLabel('Responder por e-mail').setEmoji('📧'),
    encerrar(id),
  )];
  const botoesDiscord = (id) => [new ActionRowBuilder().addComponents(encerrar(id))];
  const tentados = new Set(); // diagnósticos que já tentaram abrir chamado (não repete se falhar)

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
      const destino = chamado ? '📌 tem chamado aberto no #suporte'
        : lic?.discord_id ? '📌 vai virar chamado no #chamados (se o aluno não abrir post em 10 min, o bot abre por ele)'
          : '📧 sem Discord → virou chamado 📧 no #chamados (a resposta sai por e-mail)';
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
          footer: { text: `Detalhe completo: Admin › CenaDrop › Diagnósticos · diag:${d.id}` },
          timestamp: d.criado,
        }],
        components: [],
      });
      await db().from('cenadrop_diagnosticos')
        .update({ avisado_em: new Date().toISOString(), staff_msg_id: m.id, status: 'novo' }).eq('id', d.id);
      if (chamado) await suporte.ligarCartaoDiag(d.codigo, suporte.staffDe(chamado));
      else if (!lic?.discord_id) await suporte.abrirChamadoEmail(d).catch((e) => console.error('[Diagnósticos] chamado 📧:', e.message));
    }
    await logStaff(`🩺 ${novos.length} diagnóstico(s) novo(s) no #diagnosticos`);
  }

  // Fila única: diagnóstico sem chamado há 15 min → o bot abre o chamado no #suporte
  async function abrirPendentes() {
    const agora = Date.now();
    const { data, error } = await db().from('cenadrop_diagnosticos')
      .select('id, codigo, chave, plataforma, staff_msg_id, criado')
      .eq('tipo', 'botao').not('staff_msg_id', 'is', null)
      .or('status.is.null,status.not.in.(respondido,encerrado)')
      .lte('criado', new Date(agora - ESPERA).toISOString());
    if (error) throw error;
    for (const d of data || []) {
      if (tentados.has(d.id) || suporte.chamadoComCodigo(d.codigo)) continue;
      tentados.add(d.id);
      const lic = await licencaDe(d.chave);
      try {
        // nada fica órfão: com Discord → post no #suporte em nome do aluno; sem Discord (ou fora do servidor) → chamado 📧
        const aberto = lic?.discord_id ? await suporte.abrirChamadoDoDiagnostico(d, lic.discord_id) : null;
        if (!aberto) await suporte.abrirChamadoEmail(d);
      } catch (err) {
        console.error('[Diagnósticos] abrir chamado:', err.message);
        await logStaff(`🔴 Não abri o chamado do diagnóstico ${d.codigo}: ${String(err.message).slice(0, 200)}`);
      }
    }
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
    await enviarEmailDiag({ para: d.email || lic?.email, nome: d.nome || lic?.name, codigo: d.codigo, texto });
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
          return inter.update({ embeds: [{ ...e, color: 0x3B82F6, title: `👀 ${e.title.replace(/^🩺 /, '')} · visto por ${inter.user.username}` }], components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`diag:resp:${id}`).setStyle(ButtonStyle.Primary).setLabel('Responder').setEmoji('💬'),
            new ButtonBuilder().setCustomId(`diag:encerrar:${id}`).setStyle(ButtonStyle.Secondary).setLabel('Encerrar sem resposta').setEmoji('✔️'))] });
        }
        // teste da equipe, diagnóstico sem pedido, aluno que já resolveu → dá baixa sem mandar nada pro aluno
        if (acao === 'encerrar') {
          await db().from('cenadrop_diagnosticos').update({
            status: 'encerrado', respondido_por: inter.user.username, respondido_em: new Date().toISOString(), respondido_via: 'encerrado',
          }).eq('id', id);
          const e = inter.message.embeds[0].toJSON();
          await logStaff(`✔️ Diagnóstico encerrado sem resposta por ${inter.user.username} · ${e.title.replace(/^(🩺|👀) /, '').split(' · ')[0]}`);
          return inter.update({ embeds: [{ ...e, color: 0x6B7280, title: `✔️ ${e.title.replace(/^(🩺|👀) /, '').split(' · ')[0]} · encerrado sem resposta por ${inter.user.username}`,
            fields: (e.fields || []).filter((f) => f.name !== 'A resposta vai por') }], components: [] });
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
    const rodar = () => avisarNovos()
      .catch((err) => console.error('[Diagnósticos] aviso:', err.message))
      .then(() => abrirPendentes())
      .catch((err) => console.error('[Diagnósticos] pendentes:', err.message));
    setTimeout(rodar, 45 * 1000);
    setInterval(rodar, INTERVALO);
  });
};
