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
      from: 'Narrativa IA <contato@cenadrop.com.br>',
      to:   email,
      subject: '✨ Seu acesso ao Narrativa IA Studio está pronto',
      html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        body{margin:0;padding:0;background:#09090f;font-family:'Segoe UI',Arial,sans-serif;}
        .w{max-width:560px;margin:0 auto;padding:40px 20px;}
        .c{background:#0d0d1e;border:1px solid rgba(124,92,248,.25);border-radius:16px;overflow:hidden;}
        .h{background:linear-gradient(135deg,#1a0a3e,#0a0a1e);padding:40px 32px;text-align:center;border-bottom:1px solid rgba(124,92,248,.15);}
        .logo{font-size:26px;font-weight:800;color:#fff;letter-spacing:2px;}
        .logo span{background:linear-gradient(135deg,#9b7fff,#4169ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
        .b{padding:36px 32px;}
        .g{font-size:22px;color:#eeeef8;font-weight:700;margin-bottom:12px;}
        .t{color:#8888aa;font-size:15px;line-height:1.7;margin-bottom:24px;}
        .kb{background:#0a0a16;border:1px solid rgba(124,92,248,.3);border-radius:12px;padding:24px;margin:28px 0;}
        .krow{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);}
        .krow:last-child{border-bottom:none;}
        .kl{color:#55557a;font-size:12px;text-transform:uppercase;letter-spacing:1px;}
        .kv{color:#9b7fff;font-size:14px;font-weight:700;font-family:monospace;}
        .btn{display:inline-block;background:linear-gradient(135deg,#6234e2,#4169ff);color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:14px 32px;border-radius:12px;}
        .f{padding:24px 32px;border-top:1px solid rgba(255,255,255,.05);text-align:center;}
        .f p{color:#33334a;font-size:12px;margin:4px 0;}
      </style></head><body><div class="w"><div class="c">
        <div class="h"><div class="logo">NARRATIVA <span>IA</span></div></div>
        <div class="b">
          <div class="g">Bem-vindo, ${firstName}! ✨</div>
          <p class="t">Sua compra foi confirmada. Use as credenciais abaixo para acessar o <strong style="color:#ccc">Narrativa IA Studio</strong>:</p>
          <div class="kb">
            <div class="krow"><span class="kl">Email</span><span class="kv">${email}</span></div>
            <div class="krow"><span class="kl">Senha</span><span class="kv">${password}</span></div>
          </div>
          <div style="text-align:center;margin:24px 0;">
            <a href="https://narrativaia.com.br" class="btn">✨ Acessar Narrativa IA</a>
          </div>
          <p class="t" style="font-size:13px;color:#55557a;">Recomendamos alterar sua senha após o primeiro acesso. Em caso de dúvidas, responda este email.</p>
        </div>
        <div class="f">
          <p>© ${new Date().getFullYear()} Narrativa IA Studio</p>
          <p>Você recebeu este email porque realizou uma compra.</p>
        </div>
      </div></div></body></html>`,
    });

    console.log(`✅ Acesso Narrativa IA criado para ${email} — ordem ${order}`);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('❌ Erro ao provisionar acesso Narrativa IA:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
