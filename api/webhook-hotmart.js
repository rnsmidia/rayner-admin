// api/webhook-hotmart.js
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body  = req.body;
    const event = body?.event || body?.type || '';
    const data  = body?.data  || body;

    const approvedEvents = ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE', 'purchase.approved'];
    if (!approvedEvents.includes(event)) {
      return res.status(200).json({ ok: true, message: `Evento ${event} ignorado` });
    }

    const buyer = data?.buyer || data?.purchase?.buyer || data?.customer || {};
    const name        = buyer.name || buyer.full_name || 'Aluno';
    const email       = buyer.email || '';
    const phone       = buyer.phone || buyer.checkout_phone || '';
    const productName = data?.product?.name || 'CenaDrop';

    if (!email) return res.status(400).json({ error: 'Email não encontrado' });

    const { data: existing } = await supabase
      .from('licenses').select('key, status').eq('email', email).eq('status', 'active').single();

    if (existing) {
      await sendWelcomeEmail({ name, email, key: existing.key, productName });
      return res.status(200).json({ ok: true, message: 'Chave já existente, email reenviado' });
    }

    const key = await generateUniqueKey();

    await supabase.from('licenses').insert({
      key, email, name, phone, status: 'active', source: 'hotmart', product: productName,
      created_at: new Date().toISOString(),
      notes: `Compra automática via Hotmart em ${new Date().toLocaleDateString('pt-BR')}`
    });

    await sendWelcomeEmail({ name, email, key, productName });

    return res.status(200).json({ ok: true, key, email });

  } catch (err) {
    console.error('[Hotmart] Erro:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
};

async function sendWelcomeEmail({ name, email, key, productName }) {
  const firstName = name.split(' ')[0];
  await resend.emails.send({
    from: 'CenaDrop <onboarding@resend.dev>',
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
        <p class="t">Seu acesso ao <strong style="color:#ccc">${productName}</strong> foi aprovado. Sua chave exclusiva:</p>
        <div class="kb"><div class="kl">Chave de Acesso</div><div class="kv">${key}</div></div>
        <p class="t" style="font-size:13px;color:#555;">Instale a extensão, clique em "Ativar Licença" e cole sua chave. Problemas? Responda este email.</p>
      </div>
      <div class="f"><p>© ${new Date().getFullYear()} CenaDrop</p></div>
    </div></div></body></html>`
  });
}
