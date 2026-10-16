/**
 * POST /api/narrativa-access
 * Recebe webhook do Hotmart → cria/desativa usuário no Narrativa IA.
 *
 * Configurar no Hotmart: Webhooks → URL: https://raynern.com.br/api/narrativa-access
 * Eventos: PURCHASE_APPROVED, PURCHASE_CANCELED, PURCHASE_REFUNDED, PURCHASE_CHARGEBACK
 */

const { createClient } = require('@supabase/supabase-js');
// Criar/reativar/revogar a conta mora em lib/narrativa-conta.js (também usado pelo Combo).
const { provisionarNarrativa, revogarNarrativa } = require('../lib/narrativa-conta');

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
  const phone  = body?.data?.buyer?.phone || body?.data?.buyer?.checkout_phone || '';
  const order  = body?.data?.purchase?.order_id || body?.data?.purchase?.transaction || '';

  if (!email) return res.status(400).json({ error: 'email ausente' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── REVOGAÇÃO ────────────────────────────────────────────────────────────────
  if (REVOKE_EVENTS.has(event) || REVOKE_STATUSES.has(status)) {
    console.log(`🚫 Revogação Narrativa IA: ${email} — evento ${event || status}`);
    try {
      // Avulso não derruba a conta que veio do Combo (origin 'combo').
      await revogarNarrativa(supabase, email);
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
    const r = await provisionarNarrativa(supabase, { email, name, phone, order });
    return res.status(200).json(r.existing ? { ok: true, existing: true } : { ok: true });

  } catch (err) {
    console.error('❌ Erro ao provisionar acesso Narrativa IA:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
