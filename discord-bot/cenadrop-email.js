/**
 * E-mail da resposta da equipe pro aluno SEM Discord (Resend) — usado pelo chamado 📧 do #chamados
 * (passo 2 do fluxo "um lugar só", 19/10/26) e pelos cartões antigos do #diagnosticos.
 */
const CONVITE = 'https://discord.gg/SGEVxaurAw';
const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function enviarEmailDiag({ para, nome, codigo, texto }) {
  if (!para) throw new Error('aluno sem Discord ligado e sem e-mail');
  const primeiro = (nome || '').split(' ')[0] || 'tudo bem';
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f1d2b">
      <p style="font-size:13px;color:#7C3AED;font-weight:bold;letter-spacing:.5px">CENADROP · SUPORTE</p>
      <h2 style="margin:4px 0 16px">Analisamos o seu diagnóstico ${esc(codigo)}</h2>
      <p>Oi, ${esc(primeiro)}!</p>
      <div style="background:#f4f1fb;border-left:4px solid #7C3AED;padding:14px 16px;border-radius:6px;white-space:pre-wrap">${esc(texto)}</div>
      <p style="margin-top:20px">Se precisar continuar, o suporte do CenaDrop agora fica na nossa comunidade no Discord: abra um post no <b>#suporte</b> citando o código <b>${esc(codigo)}</b>.</p>
      <p><a href="${CONVITE}" style="background:#7C3AED;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Entrar na comunidade CenaDrop</a></p>
      <p style="color:#888;font-size:12px;margin-top:24px">Equipe CenaDrop<br>Pra continuar a conversa, o caminho mais rápido é o <b>#suporte</b> no Discord.</p></div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'CenaDrop <contato@cenadrop.com.br>', to: para, subject: `🩺 Seu diagnóstico ${codigo} foi analisado`, html }),
  });
  if (!r.ok) throw new Error(`e-mail recusado (${r.status})`);
}

module.exports = { enviarEmailDiag };
