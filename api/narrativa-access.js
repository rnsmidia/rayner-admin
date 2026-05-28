/**
 * POST /api/narrativa-access
 * Recebe webhook do Hotmart → cria/desativa usuário no Narrativa IA.
 *
 * Configurar no Hotmart: Webhooks → URL: https://raynern.com.br/api/narrativa-access
 * Eventos: PURCHASE_APPROVED, PURCHASE_CANCELED, PURCHASE_REFUNDED, PURCHASE_CHARGEBACK
 */

const { createClient }      = require('@supabase/supabase-js');
const { Resend }            = require('resend');
const { pbkdf2Sync, randomBytes } = require('crypto');
const { renderEmail }       = require('../emails/render');

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

const REVOKE_STATUSES = new Set(['CANCELED', 'REFUNDED', 'CHARGEBACK']);
const REVOKE_EVENTS   = new Set([
  'PURCHASE_CANCELED', 'PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK',
  'SUBSCRIPTION_CANCELLATION',
]);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body   = req.body;
  const hottok = req.headers['x-hotmart-hottok'] || body.hottok;

  if (hottok !== process.env.HOTMART_HOTTOK_NARRATIVA) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const event  = body?.event || '';
  const status = body?.data?.purchase?.status || '';
  const email  = body?.data?.buyer?.email?.toLowerCase();
  const name   = body?.data?.buyer?.name || '';
  const order  = body?.data?.purchase?.order_id || body?.data?.purchase?.transaction || '';

  if (!email) return res.status(400).json({ error: 'email ausente' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── REVOGAÇÃO ────────────────────────────────────────────────────────────────
  if (REVOKE_EVENTS.has(event) || REVOKE_STATUSES.has(status)) {
    console.log(`🚫 Revogação Narrativa IA: ${email} — evento ${event || status}`);
    try {
      const { error } = await supabase
        .from('narrativa_users')
        .update({ active: false })
        .eq('email', email);

      if (error) throw new Error(error.message);
      console.log(`✅ Acesso Narrativa IA desativado: ${email}`);
      return res.status(200).json({ ok: true, revoked: true });
    } catch (err) {
      console.error('❌ Erro na revogação Narrativa IA:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── APROVAÇÃO ────────────────────────────────────────────────────────────────
  if (status !== 'APPROVED') {
    return res.status(200).json({ ok: true, skipped: event || status });
  }

  try {
    // Verifica se usuário já existe (recompra ou webhook duplicado)
    const { data: existing } = await supabase
      .from('narrativa_users')
      .select('id, active')
      .eq('email', email)
      .single();

    if (existing) {
      if (!existing.active) {
        await supabase.from('narrativa_users').update({ active: true }).eq('id', existing.id);
        console.log(`♻️ Usuário reativado: ${email}`);
      } else {
        console.log(`ℹ️ Usuário já existe e ativo: ${email} — ordem ${order}`);
      }
      return res.status(200).json({ ok: true, existing: true });
    }

    // Cria novo usuário
    const password      = randomBytes(6).toString('hex');
    const password_hash = hashPassword(password);

    const { error: insertError } = await supabase
      .from('narrativa_users')
      .insert({ email, name, password_hash, active: true });

    if (insertError) throw new Error(insertError.message);

    // Envia email com credenciais
    const resend    = new Resend(process.env.RESEND_API_KEY);
    const firstName = name.split(' ')[0];

    await resend.emails.send({
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
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('❌ Erro ao provisionar acesso Narrativa IA:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
