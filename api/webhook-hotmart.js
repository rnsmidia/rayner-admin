// api/webhook-hotmart.js
// Recebe eventos da Hotmart e processa automaticamente

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// Gera chave no formato CD-XXXX-XXXX-XXXX
function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `CD-${seg()}-${seg()}-${seg()}`;
}

// Garante que a chave seja única no banco
async function generateUniqueKey() {
  let key, exists = true;
  while (exists) {
    key = generateKey();
    const { data } = await supabase.from('licenses').select('key').eq('key', key).single();
    exists = !!data;
  }
  return key;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;

    // Hotmart envia em diferentes formatos dependendo da versão do webhook
    // Suporta tanto o formato v1 quanto v2
    const event = body?.event || body?.type || '';
    const data  = body?.data || body;

    // Só processa compras aprovadas
    const approvedEvents = ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE', 'purchase.approved'];
    if (!approvedEvents.includes(event)) {
      console.log(`[Hotmart] Evento ignorado: ${event}`);
      return res.status(200).json({ ok: true, message: `Evento ${event} ignorado` });
    }

    // Extrai dados do comprador — Hotmart v2 usa buyer, v1 usa customer
    const buyer = data?.buyer || data?.purchase?.buyer || data?.customer || {};
    const name      = buyer.name || buyer.full_name || 'Aluno';
    const email     = buyer.email || '';
    const phone     = buyer.phone || buyer.checkout_phone || '';
    const productName = data?.product?.name || 'CenaDrop';
    const purchaseDate = new Date().toISOString();

    if (!email) {
      console.error('[Hotmart] Email não encontrado no payload');
      return res.status(400).json({ error: 'Email não encontrado' });
    }

    // Verifica se este email já tem licença ativa (evita duplicata)
    const { data: existing } = await supabase
      .from('licenses')
      .select('key, status')
      .eq('email', email)
      .eq('status', 'active')
      .single();

    if (existing) {
      console.log(`[Hotmart] Email ${email} já tem licença ativa: ${existing.key}`);
      // Reenvia o email caso o aluno não tenha recebido
      await sendWelcomeEmail(resend, { name, email, phone, key: existing.key, productName });
      return res.status(200).json({ ok: true, message: 'Chave já existente, email reenviado' });
    }

    // Gera nova chave única
    const key = await generateUniqueKey();

    // Salva no banco com todos os dados
    const { error: dbError } = await supabase.from('licenses').insert({
      key,
      email,
      name,
      phone,
      status: 'active',
      source: 'hotmart',
      product: productName,
      created_at: purchaseDate,
      notes: `Compra automática via Hotmart em ${new Date().toLocaleDateString('pt-BR')}`
    });

    if (dbError) {
      console.error('[Hotmart] Erro ao salvar no banco:', dbError);
      return res.status(500).json({ error: 'Erro ao salvar licença' });
    }

    // Envia email com a chave
    await sendWelcomeEmail(resend, { name, email, phone, key, productName });

    console.log(`[Hotmart] ✅ Licença criada para ${email}: ${key}`);
    return res.status(200).json({ ok: true, key, email });

  } catch (err) {
    console.error('[Hotmart] Erro inesperado:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}

async function sendWelcomeEmail(resend, { name, email, key, productName }) {
  const firstName = name.split(' ')[0];

  await resend.emails.send({
    from: 'CenaDrop <noreply@seudominio.com>', // ← Troque pelo seu domínio verificado no Resend
    to: email,
    subject: `🎬 Seu acesso ao ${productName} chegou!`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background: #0a0a0a; font-family: 'Segoe UI', Arial, sans-serif; }
    .wrapper { max-width: 560px; margin: 0 auto; padding: 40px 20px; }
    .card { background: #111; border: 1px solid #222; border-radius: 16px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%); padding: 40px 32px; text-align: center; border-bottom: 1px solid #222; }
    .logo { font-size: 28px; font-weight: 800; color: #fff; letter-spacing: -1px; }
    .logo span { color: #6c63ff; }
    .tagline { color: #555; font-size: 13px; margin-top: 6px; }
    .body { padding: 36px 32px; }
    .greeting { font-size: 22px; color: #fff; font-weight: 700; margin-bottom: 12px; }
    .text { color: #888; font-size: 15px; line-height: 1.7; margin-bottom: 24px; }
    .key-box { background: #0d0d0d; border: 2px solid #6c63ff; border-radius: 12px; padding: 24px; text-align: center; margin: 28px 0; }
    .key-label { color: #555; font-size: 12px; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px; }
    .key-value { font-size: 26px; font-weight: 800; color: #6c63ff; letter-spacing: 3px; font-family: 'Courier New', monospace; }
    .steps { margin: 28px 0; }
    .step { display: flex; gap: 14px; margin-bottom: 16px; align-items: flex-start; }
    .step-num { background: #6c63ff; color: #fff; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; text-align: center; line-height: 26px; }
    .step-text { color: #888; font-size: 14px; line-height: 1.6; }
    .step-text strong { color: #ccc; }
    .footer { padding: 24px 32px; border-top: 1px solid #1a1a1a; text-align: center; }
    .footer p { color: #444; font-size: 12px; margin: 4px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <div class="logo">Cena<span>Drop</span></div>
        <div class="tagline">Automação de Vídeos com IA</div>
      </div>
      <div class="body">
        <div class="greeting">Olá, ${firstName}! 🎉</div>
        <p class="text">
          Seu acesso ao <strong style="color:#ccc">${productName}</strong> foi aprovado com sucesso. 
          Abaixo está sua chave de licença exclusiva — guarde-a em local seguro.
        </p>
        <div class="key-box">
          <div class="key-label">Sua Chave de Acesso</div>
          <div class="key-value">${key}</div>
        </div>
        <div class="steps">
          <div class="step">
            <div class="step-num">1</div>
            <div class="step-text"><strong>Instale a extensão</strong> no Chrome acessando as configurações de extensões.</div>
          </div>
          <div class="step">
            <div class="step-num">2</div>
            <div class="step-text"><strong>Abra a extensão</strong> e clique em "Ativar Licença".</div>
          </div>
          <div class="step">
            <div class="step-num">3</div>
            <div class="step-text"><strong>Digite ou cole</strong> sua chave acima e confirme.</div>
          </div>
          <div class="step">
            <div class="step-num">4</div>
            <div class="step-text"><strong>Pronto!</strong> Comece a automatizar seus vídeos.</div>
          </div>
        </div>
        <p class="text" style="font-size: 13px; color: #555;">
          Problemas com sua chave? Responda este email ou entre em contato com o suporte.
        </p>
      </div>
      <div class="footer">
        <p>© ${new Date().getFullYear()} CenaDrop — Todos os direitos reservados</p>
        <p>Você recebeu este email por ter adquirido ${productName}</p>
      </div>
    </div>
  </div>
</body>
</html>
    `
  });
}
