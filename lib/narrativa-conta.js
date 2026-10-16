// lib/narrativa-conta.js — conta do Narrativa IA: criar/reativar e revogar.
// Fonte única usada por:
//   /api/narrativa-access          (compra avulsa do Narrativa — sem origin)
//   /api/webhook-hotmart?origem=COMBO (Combo Narrativa + CenaDrop — origin 'combo')
// O `origin` marca DE ONDE veio a conta, pra que o reembolso de um produto não
// derrube a conta que veio de outro (mesmo problema da licença dupla do CenaDrop).

const { Resend }                  = require('resend');
const { pbkdf2Sync, randomBytes } = require('crypto');
const { renderEmail }             = require('../emails/render');
const { sendEmail }               = require('../emails/send');

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

// Cria a conta (e manda o e-mail com a senha) ou reativa a existente.
// Retorna { existing: true } ou { created: true }. Lança em erro de banco ou de e-mail.
async function provisionarNarrativa(supabase, { email, name = '', phone = '', order = '', origin = null, purchasedAt = null, expiresAt = null }) {
  const { data: existing } = await supabase
    .from('narrativa_users')
    .select('id, active, origin')
    .eq('email', email)
    .single();

  if (existing) {
    const upd = {};
    if (!existing.active) {
      upd.active = true;
      // Conta reativada por um produto com origin passa a ser dele — o reembolso desse produto a desfaz.
      if (origin) {
        upd.origin = origin;
        if (purchasedAt) upd.purchased_at = purchasedAt;
        if (expiresAt)   upd.expires_at   = expiresAt;
      }
    } else if (origin && existing.origin === origin && expiresAt) {
      upd.expires_at = expiresAt;   // renovação do mesmo produto
    }
    if (phone) upd.phone = phone;   // backfill do WhatsApp em recompra
    if (Object.keys(upd).length) {
      await supabase.from('narrativa_users').update(upd).eq('id', existing.id);
      console.log(`♻️ Usuário existente atualizado (${Object.keys(upd).join(',')}): ${email}`);
    } else {
      console.log(`ℹ️ Usuário já existe e ativo: ${email} — ordem ${order}`);
    }
    return { existing: true };
  }

  const password      = randomBytes(6).toString('hex');
  const password_hash = hashPassword(password);
  const row = { email, name, phone, password_hash, active: true };
  if (origin) Object.assign(row, { origin, purchased_at: purchasedAt, expires_at: expiresAt });

  const { error: insertError } = await supabase.from('narrativa_users').insert(row);
  if (insertError) throw new Error(insertError.message);

  const resend    = new Resend(process.env.RESEND_API_KEY);
  const firstName = name.split(' ')[0];
  await sendEmail(resend, {
    from:    'Narrativa IA <contato@cenadrop.com.br>',
    to:      email,
    subject: '✨ Seu acesso ao Narrativa IA Studio está pronto',
    html:    renderEmail('narrativa/boas-vindas', {
      PRIMEIRO_NOME: firstName,
      EMAIL:         email,
      SENHA:         password,
      LINK_ACESSO:   'https://narrativaia.com.br',
    }),
  });

  console.log(`✅ Acesso Narrativa IA criado para ${email} — ordem ${order}`);
  return { created: true };
}

// Desativa a conta. Com `origin`, só a conta daquele produto (ex.: 'combo').
// Sem `origin` (compra avulsa), desativa por e-mail mas NUNCA a conta do Combo.
// Retorna quantas contas foram desativadas.
async function revogarNarrativa(supabase, email, { origin = null } = {}) {
  let q = supabase.from('narrativa_users').update({ active: false }).eq('email', email);
  q = origin ? q.eq('origin', origin) : q.or('origin.is.null,origin.neq.combo');
  const { data, error } = await q.select('id');
  if (error) throw new Error(error.message);
  return (data || []).length;
}

module.exports = { provisionarNarrativa, revogarNarrativa };
