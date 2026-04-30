// api/webhook-hotmart.js — CenaDrop v7.0
// Eventos tratados:
//   COMPRA APROVADA  → gera chave + envia email
//   CANCELAMENTO     → desativa chave
//   CHARGEBACK       → desativa chave
//   RENOVAÇÃO ANUAL  → mantém chave ativa (não faz nada, já está ativa)
//   EXPIRAÇÃO ANUAL  → desativa chave (Hotmart sinaliza via SUBSCRIPTION_CANCELLATION)

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// ─────────────────────────────────────────────────────────────
// ✅ PREENCHA QUANDO O DOMÍNIO ESTIVER VERIFICADO NO RESEND
// ─────────────────────────────────────────────────────────────
const EMAIL_FROM = 'CenaDrop <contato@cenadrop.com.br>';
// const EMAIL_FROM = 'CenaDrop <onboarding@resend.dev>'; // ← fallback temporário

// ─────────────────────────────────────────────────────────────
// ✅ HOTTOKS — um por conta Hotmart
// Rayner (RN): defina HOTMART_HOTTOK_RN nas env vars da Vercel
// Marcos (MC): defina HOTMART_HOTTOK_MC nas env vars da Vercel
// ─────────────────────────────────────────────────────────────
const HOTMART_HOTTOK_RN = process.env.HOTMART_HOTTOK_RN || process.env.HOTMART_HOTTOK || '';
const HOTMART_HOTTOK_MC = process.env.HOTMART_HOTTOK_MC || '';

// ─────────────────────────────────────────────────────────────
// Eventos de COMPRA APROVADA
// ─────────────────────────────────────────────────────────────
const APPROVED_EVENTS = [
  'PURCHASE_APPROVED',
  'PURCHASE_COMPLETE',
  'purchase.approved',
];

// ─────────────────────────────────────────────────────────────
// Eventos de CANCELAMENTO / CHARGEBACK / EXPIRAÇÃO
// ─────────────────────────────────────────────────────────────
const CANCEL_EVENTS = [
  'PURCHASE_REFUNDED',
  'PURCHASE_CHARGEBACK',
  'PURCHASE_CANCELLED',
  'PURCHASE_PROTEST',
  'SUBSCRIPTION_CANCELLATION', // ← expiração anual sem renovação
];

// ─────────────────────────────────────────────────────────────
// Gerador de chave único
// ─────────────────────────────────────────────────────────────
function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `CD-${seg()}-${seg()}-${seg()}`;
}

async function generateUniqueKey() {
  let key, exists = true;
  while (exists) {
    key = generateKey();
    const { data } = await supabase.from('licenses').select('key').eq('key', key).single();
    exists = !!data;
  }
  return key;
}

// ─────────────────────────────────────────────────────────────
// Handler principal
// ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Identifica a origem da chamada: ?origem=RN ou ?origem=MC
  const origem = (req.query?.origem || '').toUpperCase().replace(/[^A-Z]/g, '');

  // Validação do Hottok — aceita o token de qualquer uma das contas
  const validTokens = [HOTMART_HOTTOK_RN, HOTMART_HOTTOK_MC].filter(Boolean);
  if (validTokens.length > 0) {
    const hottok = req.headers['x-hotmart-hottok'] || req.query?.hottok || '';
    if (!validTokens.includes(hottok)) {
      console.warn('[Hotmart] Hottok inválido:', hottok);
      return res.status(401).json({ error: 'Não autorizado' });
    }
  }

  try {
    const body  = req.body;
    const event = body?.event || body?.type || '';
    const data  = body?.data  || body;

    console.log(`[Hotmart] Evento recebido: ${event}`);

    // ── COMPRA APROVADA ──────────────────────────────────────
    if (APPROVED_EVENTS.includes(event)) {
      const buyer = data?.buyer || data?.purchase?.buyer || data?.customer || {};
      const name        = buyer.name || buyer.full_name || 'Cliente';
      const email       = buyer.email || '';
      const phone       = buyer.phone || buyer.checkout_phone || '';
      const productName = data?.product?.name || 'CenaDrop Flow';

      if (!email) return res.status(400).json({ error: 'Email não encontrado no payload' });

      // Verifica se já tem chave ativa para esse email
      const { data: existing } = await supabase
        .from('licenses')
        .select('key, status')
        .eq('email', email)
        .eq('status', 'active')
        .single();

      if (existing) {
        // Já tem chave — só reenvia o email
        await sendWelcomeEmail({ name, email, key: existing.key, productName });
        console.log(`[Hotmart] Chave já existente para ${email}, email reenviado`);
        return res.status(200).json({ ok: true, message: 'Chave já existente, email reenviado' });
      }

      // Gera nova chave
      const key = await generateUniqueKey();

      await supabase.from('licenses').insert({
        key,
        email,
        name,
        phone,
        status: 'active',
        active: true,
        source: origem ? `hotmart-${origem}` : 'hotmart',
        product: productName,
        created_at: new Date().toISOString(),
        notes: `Compra automática via Hotmart${origem ? ` (${origem})` : ''} em ${new Date().toLocaleDateString('pt-BR')}`,
      });

      await sendWelcomeEmail({ name, email, key, productName });

      console.log(`[Hotmart] Nova chave gerada para ${email}: ${key}`);
      return res.status(200).json({ ok: true, key, email });
    }

    // ── CANCELAMENTO / CHARGEBACK / EXPIRAÇÃO ────────────────
    if (CANCEL_EVENTS.includes(event)) {
      const buyer = data?.buyer || data?.purchase?.buyer || data?.subscriber || data?.customer || {};
      const email = buyer.email || '';

      if (!email) {
        console.warn(`[Hotmart] Evento de cancelamento sem email: ${event}`);
        return res.status(200).json({ ok: true, message: 'Cancelamento sem email, ignorado' });
      }

      // Desativa todas as licenças ativas desse email
      const { error } = await supabase
        .from('licenses')
        .update({
          status: 'inactive',
          active: false,
          notes: `Desativado automaticamente via Hotmart — evento: ${event} em ${new Date().toLocaleDateString('pt-BR')}`,
        })
        .eq('email', email)
        .eq('status', 'active');

      if (error) {
        console.error(`[Hotmart] Erro ao desativar licença de ${email}:`, error);
        return res.status(500).json({ error: 'Erro ao desativar licença' });
      }

      console.log(`[Hotmart] Licença desativada para ${email} — evento: ${event}`);
      return res.status(200).json({ ok: true, message: `Licença desativada para ${email}` });
    }

    // ── EVENTO IGNORADO ──────────────────────────────────────
    console.log(`[Hotmart] Evento ignorado: ${event}`);
    return res.status(200).json({ ok: true, message: `Evento ${event} ignorado` });

  } catch (err) {
    console.error('[Hotmart] Erro interno:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
};

// ─────────────────────────────────────────────────────────────
// Email de boas-vindas com a chave
// ─────────────────────────────────────────────────────────────
async function sendWelcomeEmail({ name, email, key, productName }) {
  const firstName = name.split(' ')[0];
  await resend.emails.send({
    from: EMAIL_FROM,
    to: email,
    subject: `🎬 Seu acesso ao ${productName} chegou!`,
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      body{margin:0;padding:0;background:#0a0a0a;font-family:'Segoe UI',Arial,sans-serif;}
      .w{max-width:560px;margin:0 auto;padding:40px 20px;}
      .c{background:#111;border:1px solid #222;border-radius:16px;overflow:hidden;}
      .h{background:linear-gradient(135deg,#1a1a2e,#0f0f1a);padding:40px 32px;text-align:center;border-bottom:1px solid #222;}
      .logo{font-size:28px;font-weight:800;color:#fff;}.logo span{color:#6c63ff;}
      .b{padding:36px 32px;}.g{font-size:22px;color:#fff;font-weight:700;margin-bottom:12px;}
      .t{color:#888;font-size:15px;line-height:1.7;margin-bottom:24px;}
      .kb{background:#0d0d0d;border:2px solid #6c63ff;border-radius:12px;padding:24px;text-align:center;margin:28px 0;}
      .kl{color:#555;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-bottom:10px;}
      .kv{font-size:26px;font-weight:800;color:#6c63ff;letter-spacing:3px;font-family:'Courier New',monospace;}
      .f{padding:24px 32px;border-top:1px solid #1a1a1a;text-align:center;}
      .f p{color:#444;font-size:12px;margin:4px 0;}
    </style></head><body><div class="w"><div class="c">
      <div class="h"><div class="logo">Cena<span>Drop</span></div></div>
      <div class="b">
        <div class="g">Olá, ${firstName}! 🎉</div>
        <p class="t">Seu acesso ao <strong style="color:#ccc">${productName}</strong> foi aprovado. Sua chave exclusiva está abaixo:</p>
        <div class="kb">
          <div class="kl">Chave de Acesso</div>
          <div class="kv">${key}</div>
        </div>
        <div style="text-align:center;margin:24px 0;">
          <a href="https://raynern.com.br/cenadrop/download" style="display:inline-block;background:linear-gradient(135deg,#6c63ff,#9f7aea);color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:14px 32px;border-radius:12px;letter-spacing:0.3px;">⬇ Baixar CenaDrop Flow</a>
        </div>
        <p class="t" style="font-size:13px;color:#555;">
          Baixe a extensão, instale no Chrome, clique em "Ativar Licença" e cole sua chave.<br><br>
          Problemas? Responda este email que te ajudamos.
        </p>
      </div>
      <div class="f">
        <p>© ${new Date().getFullYear()} CenaDrop — cenadrop.com.br</p>
      </div>
    </div></div></body></html>`,
  });
}
