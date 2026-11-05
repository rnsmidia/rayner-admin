/**
 * Narrativa Bot — diagnósticos do site no Discord (#diagnosticos-narrativa do Estagiário). E7, 05/11/26.
 *
 * Mesmo fluxo do cenadrop-diagnosticos.js. A cada 2 min, o N-XXXX enviado pelo 🛟 (tipo 'botao') vira cartão-arquivo:
 *   1. o aluno já citou o código num chamado → o cartão aponta pra ele
 *   2. conta ligada ao Discord → sem chamado em 10 min, o bot abre o post no #suporte em nome do aluno
 *   3. sem Discord (ou fora do servidor) → chamado 📧 na hora: a resposta sai por e-mail
 * O automático (tipo 'auto') não abre chamado: vai junto quando o aluno pedir ajuda (cfg.diagRecente).
 * O cartão leva o pacote inteiro em anexo (N-XXXX.json): no Narrativa não há tela de diagnósticos no Admin.
 */

const INTERVALO = 2 * 60 * 1000;
const ESPERA = 10 * 60 * 1000;            // tempo pro aluno abrir o post sozinho
const RECENTE = 24 * 3600 * 1000;
const DESDE = '2026-11-05T14:30:00Z';     // os de antes eram testes da equipe: não viram cartão
const PERFIL = 'https://narrativaia.com.br/narrativa-ia';

const mascararEmail = (e) => (e || '').replace(/^(.).*?(.)?@/, (_, a, b) => `${a}***${b || ''}@`);
const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textoElo = (e) => (e?.ok ? `Elo v${e.versao || '?'}${e.agentes?.length ? ` (${e.agentes.join(', ')})` : ''}` : 'Elo fechado');

async function enviarEmail({ para, nome, codigo, texto }) {
  if (!para) throw new Error('aluno sem Discord ligado e sem e-mail');
  const primeiro = (nome || '').split(' ')[0] || 'tudo bem';
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f1d2b">
      <p style="font-size:13px;color:#7C5CF8;font-weight:bold;letter-spacing:.5px">NARRATIVA IA · SUPORTE</p>
      <h2 style="margin:4px 0 16px">Analisamos o seu pedido de ajuda ${esc(codigo)}</h2>
      <p>Oi, ${esc(primeiro)}!</p>
      <div style="background:#f4f1fb;border-left:4px solid #7C5CF8;padding:14px 16px;border-radius:6px;white-space:pre-wrap">${esc(texto)}</div>
      <p style="margin-top:20px"><b>Para responder, não use este e-mail:</b> abra o Narrativa e clique em <b>🛟 Preciso de ajuda</b> de novo. A sua mensagem cai na mesma conversa.</p>
      <p><a href="${PERFIL}" style="background:#7C5CF8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Abrir o Narrativa</a></p>
      <p style="color:#888;font-size:12px;margin-top:24px">Equipe Narrativa</p></div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Narrativa IA <suporte@narrativaia.com.br>', to: para, subject: `Resposta da equipe sobre o seu pedido ${codigo}`, html }),
  });
  if (!r.ok) throw new Error(`e-mail recusado (${r.status})`);
}

const textoDiag = (d, codigo) => {
  if (!codigo) return '⚠️ Sem diagnóstico ainda';
  if (!d) return `\`${codigo}\` (não encontrado)`;
  return [`\`${d.codigo}\` · ${d.pagina || '?'} · ${d.navegador || '?'} · ${d.sistema || '?'} · ${textoElo(d.elo)} · ${d.n_linhas || 0} linhas`,
    d.resumo ? `Resumo: ${d.resumo}` : null, d.mensagem ? `Recado: "${d.mensagem}"` : null,
    'Pacote completo no cartão do #diagnosticos-narrativa'].filter(Boolean).join('\n').slice(0, 1000);
};

function tagDoDiag(d, tags) {
  const p = d.pagina || '';
  if (p.startsWith('/studio/sync')) return tags['Studio Sync e CapCut'];
  if (p.startsWith('/studio/voz')) return tags['Studio Voz'];
  if (/^\/canal\/\d+\/roteiro/.test(p)) return tags['Roteiro'];
  if (/nicho/.test(p)) return tags['Nicho Lab'];
  if (p.startsWith('/perfil')) return tags['Conta e acesso'];
  return tags['Canal e Config'];
}

// o que o motor de suporte precisa saber do diagnóstico do Narrativa (entra no cfg dele)
const cfg = (db, contaAtiva) => {
  const contaDoUsuario = async (userId) => {
    const { data } = await db().from('narrativa_users')
      .select('name, email, origin, active, expires_at, discord_id').eq('id', userId).maybeSingle();
    return data;
  };
  return {
    diag: true,
    pedirDiag: true,
    tabelaDiag: 'narrativa_diagnosticos',
    camposDiag: 'codigo, criado, pagina, navegador, sistema, mensagem, resumo, n_linhas, elo',
    camposAluno: 'user_id',
    textoDiag,
    linhaCaso: (d) => `${d.codigo} · ${d.pagina || '?'} · ${textoElo(d.elo)} · ${d.resumo || 'nada fora do normal'}${d.mensagem ? ` · recado: "${d.mensagem}"` : ''}`,
    tagDoDiag,
    enviarEmail,
    contaDoDiag: async (d) => {
      const u = await contaDoUsuario(d.user_id);
      if (!u) return { campo: 'Conta', texto: 'conta não encontrada' };
      const vence = u.expires_at ? ` · vence ${new Date(u.expires_at).toLocaleDateString('pt-BR')}` : '';
      return { campo: 'Conta', texto: `${u.origin || '—'}${vence} · ${contaAtiva(u) ? 'ativa ✅' : 'SEM ACESSO ⛔'}` };
    },
    diagRecente: async (discordId) => {
      const { data: u } = await db().from('narrativa_users').select('id').eq('discord_id', discordId).maybeSingle();
      if (!u) return null;
      const { data } = await db().from('narrativa_diagnosticos').select('codigo')
        .eq('user_id', u.id).not('status', 'in', '(respondido,encerrado)')
        .gte('criado', new Date(Date.now() - RECENTE).toISOString()).order('criado', { ascending: false }).limit(1);
      return data?.[0]?.codigo || null;
    },
    embedDiag: {
      title: '📋 Falta só uma coisa: o diagnóstico',
      description: 'Ele mostra pra equipe exatamente o que aconteceu no seu Narrativa. Sem ele, a gente teria que te pedir prints e a resposta demora mais.\n\n' +
        '**1.** Abra o Narrativa, no mesmo computador e na tela onde deu o problema.\n' +
        '**2.** Clique em **🛟 Preciso de ajuda**, no menu da esquerda.\n' +
        '**3.** Escreva em uma frase o que aconteceu e clique em **Enviar diagnóstico**.\n' +
        '**4.** Clique em **Copiar código** e **cole aqui neste post** (ex.: `N-4KJ9`).\n\n' +
        '✅ Você **não perde a sua posição na fila** enquanto faz isso.',
      color: 0x3B82F6,
    },
    contaDoUsuario,
  };
};

function diagnosticos(client, { db, logStaff, suporte, canal: CANAL, contaDoUsuario, contaAtiva }) {
  const tentados = new Set(); // diagnósticos que já tentaram abrir chamado (não repete se falhar)

  async function avisarNovos() {
    const { data: novos, error } = await db().from('narrativa_diagnosticos').select('*')
      .eq('tipo', 'botao').is('avisado_em', null).gte('criado', DESDE).order('criado').limit(5);
    if (error) throw error;
    if (!novos?.length) return;
    const canal = await client.channels.fetch(CANAL);
    for (const d of novos) {
      const u = await contaDoUsuario(d.user_id);
      const chamado = suporte.chamadoComCodigo(d.codigo);
      const destino = chamado ? '📌 tem chamado aberto'
        : u?.discord_id ? '📌 vai virar chamado (se o aluno não abrir post em 10 min, o bot abre por ele)'
          : '📧 sem Discord → virou chamado 📧 (a resposta sai por e-mail)';
      const trabalhos = (d.linha_tempo || []).slice(-3).map((w) => `${w.tipo}: ${w.desfecho}${w.motivo ? ` · ${String(w.motivo).slice(0, 120)}` : ''}`).join('\n');
      const m = await canal.send({
        embeds: [{
          title: `🩺 ${d.codigo} · ${d.nome || 'sem nome'}`,
          description: d.mensagem ? `**Recado do aluno:** "${d.mensagem.slice(0, 1500)}"` : '_(sem recado)_',
          color: 0xEAB308,
          fields: [
            { name: 'Resumo', value: (d.resumo || 'nada fora do normal').slice(0, 1000), inline: false },
            { name: 'Ambiente', value: `${d.pagina || '?'} · ${d.navegador || '?'} · ${d.sistema || '?'} · ${textoElo(d.elo)} · CenaDrop ${d.cenadrop?.ok ? `v${d.cenadrop.versao || '?'}` : 'desligado'} · ${d.n_linhas || 0} linhas`, inline: false },
            ...(trabalhos ? [{ name: 'Últimos trabalhos', value: trabalhos.slice(0, 1000), inline: false }] : []),
            { name: 'Aluno', value: `${mascararEmail(d.email)} · ${u ? `${u.origin || '—'} · ${contaAtiva(u) ? 'ativa ✅' : 'SEM ACESSO ⛔'}` : 'conta não encontrada'}`, inline: false },
            { name: 'A resposta vai por', value: destino, inline: false },
          ],
          footer: { text: `Detalhe completo: arquivo ${d.codigo}.json · diag:${d.id}` },
          timestamp: d.criado,
        }],
        files: [{ attachment: Buffer.from(JSON.stringify(d, null, 1)), name: `${d.codigo}.json` }],
      });
      await db().from('narrativa_diagnosticos').update({ avisado_em: new Date().toISOString(), staff_msg_id: m.id }).eq('id', d.id);
      if (chamado) await suporte.ligarCartaoDiag(d.codigo, suporte.staffDe(chamado));
      else if (!u?.discord_id) await suporte.abrirChamadoEmail(d).catch((e) => console.error('[Diagnósticos Narrativa] chamado 📧:', e.message));
    }
    await logStaff(`🩺 ${novos.length} diagnóstico(s) novo(s) no #diagnosticos-narrativa`);
  }

  // Fila única: diagnóstico sem chamado há 10 min → o bot abre o post no #suporte
  async function abrirPendentes() {
    const { data, error } = await db().from('narrativa_diagnosticos')
      .select('id, codigo, user_id, pagina, staff_msg_id, criado')
      .eq('tipo', 'botao').not('staff_msg_id', 'is', null)
      .not('status', 'in', '(respondido,encerrado)')
      .lte('criado', new Date(Date.now() - ESPERA).toISOString());
    if (error) throw error;
    for (const d of data || []) {
      if (tentados.has(d.id) || suporte.chamadoComCodigo(d.codigo)) continue;
      tentados.add(d.id);
      const u = await contaDoUsuario(d.user_id);
      try {
        const aberto = u?.discord_id ? await suporte.abrirChamadoDoDiagnostico(d, u.discord_id) : null;
        if (!aberto) await suporte.abrirChamadoEmail(d);
      } catch (err) {
        console.error('[Diagnósticos Narrativa] abrir chamado:', err.message);
        await logStaff(`🔴 Não abri o chamado do diagnóstico ${d.codigo}: ${String(err.message).slice(0, 200)}`);
      }
    }
  }

  const rodar = () => avisarNovos()
    .catch((err) => console.error('[Diagnósticos Narrativa] aviso:', err.message))
    .then(() => abrirPendentes())
    .catch((err) => console.error('[Diagnósticos Narrativa] pendentes:', err.message));
  client.once('clientReady', () => {
    setTimeout(rodar, 45 * 1000);
    setInterval(rodar, INTERVALO);
  });
  return { rodar };
}

module.exports = { diagnosticos, cfg };
