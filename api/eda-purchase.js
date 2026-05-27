/**
 * POST /api/eda-purchase
 * Webhook unificado do Hotmart para o Elite Dark Academy.
 *
 * APROVAÇÃO → cria: convite Discord + chave CenaDrop + conta Narrativa IA
 *             → envia UM email premium com tudo
 * CANCELAMENTO/REEMBOLSO → remove cargo Discord + desativa CenaDrop + desativa Narrativa IA
 *
 * Hotmart → Webhooks → URL: https://raynern.com.br/api/eda-purchase
 * Eventos: PURCHASE_APPROVED, PURCHASE_CANCELED, PURCHASE_REFUNDED,
 *          PURCHASE_CHARGEBACK, SUBSCRIPTION_CANCELLATION
 */

const { createClient }            = require('@supabase/supabase-js');
const { Resend }                  = require('resend');
const { pbkdf2Sync, randomBytes } = require('crypto');

// ── Constantes Discord ────────────────────────────────────────────────────────
const WELCOME_CHANNEL = '1508898202294816778';
const GUILD_ID        = '1508895864540626986';
const ROLE_ID         = '1508900115459477535';

const REVOKE_EVENTS = new Set([
  'PURCHASE_CANCELED', 'PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK',
  'SUBSCRIPTION_CANCELLATION',
]);
const REVOKE_STATUSES = new Set(['CANCELED', 'REFUNDED', 'CHARGEBACK']);

// ── Helpers ───────────────────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () =>
    Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `CD-${seg()}-${seg()}-${seg()}`;
}

async function generateUniqueKey(supabase) {
  let key, exists = true;
  while (exists) {
    key = generateKey();
    const { data } = await supabase.from('licenses').select('key').eq('key', key).single();
    exists = !!data;
  }
  return key;
}

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body   = req.body;
  const hottok = req.headers['x-hotmart-hottok'] || body.hottok;

  if (hottok !== process.env.HOTMART_HOTTOK_MC) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const event  = body?.event || '';
  const status = body?.data?.purchase?.status || '';
  const email  = body?.data?.buyer?.email?.toLowerCase();
  const name   = body?.data?.buyer?.name || '';
  const order  = body?.data?.purchase?.order_id || body?.data?.purchase?.transaction || '';

  if (!email) return res.status(400).json({ error: 'email ausente' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── REVOGAÇÃO ─────────────────────────────────────────────────────────────
  if (REVOKE_EVENTS.has(event) || REVOKE_STATUSES.has(status)) {
    console.log(`🚫 Revogação EDA: ${email} — ${event || status}`);
    const errors = [];

    // 1. Remove cargo Discord
    try {
      const { data: inv } = await supabase
        .from('discord_invites')
        .select('discord_user_id')
        .eq('email', email)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (inv?.discord_user_id) {
        await fetch(
          `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${inv.discord_user_id}/roles/${ROLE_ID}`,
          { method: 'DELETE', headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
        );
        console.log(`✅ Cargo Discord removido: ${inv.discord_user_id}`);
      } else {
        console.warn(`⚠️ discord_user_id não encontrado para ${email}`);
      }

      await supabase
        .from('discord_invites')
        .update({ revoked: true, revoked_reason: event || status })
        .eq('email', email);
    } catch (err) {
      console.error('❌ Erro Discord revogação:', err.message);
      errors.push({ service: 'discord', error: err.message });
    }

    // 2. Desativa chave CenaDrop
    try {
      await supabase
        .from('licenses')
        .update({ status: 'inactive' })
        .eq('email', email)
        .eq('source', 'hotmart-EDA');
      console.log(`✅ CenaDrop desativado: ${email}`);
    } catch (err) {
      console.error('❌ Erro CenaDrop revogação:', err.message);
      errors.push({ service: 'cenadrop', error: err.message });
    }

    // 3. Desativa Narrativa IA
    try {
      await supabase
        .from('narrativa_users')
        .update({ active: false })
        .eq('email', email);
      console.log(`✅ Narrativa IA desativado: ${email}`);
    } catch (err) {
      console.error('❌ Erro Narrativa revogação:', err.message);
      errors.push({ service: 'narrativa', error: err.message });
    }

    return res.status(200).json({ ok: true, revoked: true, errors });
  }

  // ── APROVAÇÃO ─────────────────────────────────────────────────────────────
  if (status !== 'APPROVED') {
    return res.status(200).json({ ok: true, skipped: event || status });
  }

  console.log(`✅ Nova compra EDA: ${email} — ordem ${order}`);

  const results = { discord: null, cenadrop: null, narrativa: null };
  const errors  = [];

  // 1. Discord — convite único
  try {
    const inviteRes = await fetch(
      `https://discord.com/api/v10/channels/${WELCOME_CHANNEL}/invites`,
      {
        method: 'POST',
        headers: {
          Authorization:  `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ max_uses: 1, max_age: 604800, unique: true }),
      }
    );
    const invite = await inviteRes.json();
    if (!invite.code) throw new Error('Discord não retornou código de convite');

    await supabase.from('discord_invites').insert({
      email,
      name,
      invite_code:   invite.code,
      hotmart_order: order,
      used:          false,
      revoked:       false,
    });

    results.discord = `https://discord.gg/${invite.code}`;
    console.log(`✅ Convite Discord criado: ${invite.code}`);
  } catch (err) {
    console.error('❌ Erro Discord aprovação:', err.message);
    errors.push({ service: 'discord', error: err.message });
  }

  // 2. CenaDrop — chave de licença
  try {
    // Verifica se já existe chave ativa para este email (recompra)
    const { data: existing } = await supabase
      .from('licenses')
      .select('key, status')
      .eq('email', email)
      .eq('source', 'hotmart-EDA')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existing) {
      if (existing.status !== 'active') {
        await supabase.from('licenses').update({ status: 'active' }).eq('key', existing.key);
        console.log(`♻️ CenaDrop reativado: ${email}`);
      }
      results.cenadrop = existing.key;
    } else {
      const key = await generateUniqueKey(supabase);
      await supabase.from('licenses').insert({
        key,
        email,
        name,
        status:     'active',
        source:     'hotmart-EDA',
        notes:      `Elite Dark Academy — ordem ${order}`,
        created_at: new Date().toISOString(),
      });
      results.cenadrop = key;
      console.log(`✅ CenaDrop criado: ${key} para ${email}`);
    }
  } catch (err) {
    console.error('❌ Erro CenaDrop aprovação:', err.message);
    errors.push({ service: 'cenadrop', error: err.message });
  }

  // 3. Narrativa IA — conta
  let narrativaPassword = null;
  try {
    const { data: existing } = await supabase
      .from('narrativa_users')
      .select('id, active')
      .eq('email', email)
      .single();

    if (existing) {
      if (!existing.active) {
        await supabase.from('narrativa_users').update({ active: true }).eq('id', existing.id);
        console.log(`♻️ Narrativa IA reativado: ${email}`);
      }
      results.narrativa = { existing: true };
    } else {
      narrativaPassword = randomBytes(6).toString('hex');
      const password_hash = hashPassword(narrativaPassword);
      await supabase.from('narrativa_users').insert({
        email,
        name,
        password_hash,
        active: true,
      });
      results.narrativa = { password: narrativaPassword };
      console.log(`✅ Narrativa IA criado: ${email}`);
    }
  } catch (err) {
    console.error('❌ Erro Narrativa aprovação:', err.message);
    errors.push({ service: 'narrativa', error: err.message });
  }

  // 4. Email premium unificado
  try {
    const resend    = new Resend(process.env.RESEND_API_KEY);
    const firstName = name.split(' ')[0];

    const discordBlock = results.discord
      ? `<div class="card">
          <div class="card-icon">💬</div>
          <div class="card-info">
            <div class="card-label">COMUNIDADE DISCORD</div>
            <div class="card-title">Servidor Elite Dark Academy</div>
            <div class="card-sub">Convite exclusivo — uso único, válido por 7 dias</div>
            <a href="${results.discord}" class="btn-card">ENTRAR NO SERVIDOR →</a>
          </div>
        </div>`
      : '';

    const cenadropBlock = results.cenadrop
      ? `<div class="card">
          <div class="card-icon">🎬</div>
          <div class="card-info">
            <div class="card-label">CENADROP FLOW</div>
            <div class="card-title">Extensão para YouTube Studio</div>
            <div class="card-sub">Sua chave de licença — 12 meses de acesso</div>
            <div class="key-box">${results.cenadrop}</div>
            <a href="https://raynern.com.br/cenadrop/download" class="btn-card-outline">BAIXAR EXTENSÃO →</a>
          </div>
        </div>`
      : '';

    const narrativaBlock = results.narrativa
      ? results.narrativa.existing
        ? `<div class="card">
            <div class="card-icon">✨</div>
            <div class="card-info">
              <div class="card-label">NARRATIVA IA STUDIO</div>
              <div class="card-title">Roteiros com Inteligência Artificial</div>
              <div class="card-sub">Sua conta já existe — acesso por 12 meses</div>
              <div class="cred-box">
                <div class="cred-row"><span class="cred-label">Email</span><span class="cred-val">${email}</span></div>
                <div class="cred-row"><span class="cred-label">Senha</span><span class="cred-val">use sua senha atual</span></div>
              </div>
              <a href="https://narrativaia.com.br" class="btn-card-outline">ACESSAR NARRATIVA IA →</a>
            </div>
          </div>`
        : `<div class="card">
            <div class="card-icon">✨</div>
            <div class="card-info">
              <div class="card-label">NARRATIVA IA STUDIO</div>
              <div class="card-title">Roteiros com Inteligência Artificial</div>
              <div class="card-sub">Suas credenciais de acesso — 12 meses</div>
              <div class="cred-box">
                <div class="cred-row"><span class="cred-label">Email</span><span class="cred-val">${email}</span></div>
                <div class="cred-row"><span class="cred-label">Senha</span><span class="cred-val">${narrativaPassword}</span></div>
              </div>
              <a href="https://narrativaia.com.br" class="btn-card-outline">ACESSAR NARRATIVA IA →</a>
            </div>
          </div>`
      : '';

    await resend.emails.send({
      from:    'Elite Dark Academy <noreply@raynern.com.br>',
      to:      email,
      subject: `👑 Bem-vindo ao Elite Dark Academy, ${firstName}. Seus acessos estão aqui.`,
      html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#050508;font-family:'Segoe UI',Arial,sans-serif;}
  .w{max-width:600px;margin:0 auto;padding:40px 16px;}
  .header{background:linear-gradient(160deg,#0e0e1c 0%,#07070f 100%);border:1px solid rgba(212,175,55,.18);border-radius:20px 20px 0 0;padding:48px 40px 36px;text-align:center;}
  .seal{width:72px;height:72px;margin:0 auto 20px;background:linear-gradient(135deg,#C9A227,#8B6914);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:32px;line-height:72px;}
  .academy-name{font-size:11px;font-weight:700;letter-spacing:.22em;color:#C9A227;text-transform:uppercase;margin-bottom:10px;}
  .header-title{font-size:26px;font-weight:800;color:#fff;line-height:1.3;margin:0 0 10px;}
  .header-sub{color:rgba(255,255,255,.45);font-size:14px;line-height:1.6;}
  .body{background:#0a0a14;border-left:1px solid rgba(212,175,55,.12);border-right:1px solid rgba(212,175,55,.12);padding:40px;}
  .greeting{font-size:18px;color:#fff;font-weight:700;margin-bottom:8px;}
  .intro{color:rgba(255,255,255,.55);font-size:14px;line-height:1.7;margin-bottom:36px;}
  .section-title{font-size:10px;font-weight:700;letter-spacing:.2em;color:#C9A227;text-transform:uppercase;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid rgba(212,175,55,.15);}
  .card{background:#0d0d1e;border:1px solid rgba(212,175,55,.15);border-radius:14px;padding:24px;margin-bottom:16px;display:flex;gap:18px;}
  .card-icon{font-size:28px;flex-shrink:0;margin-top:2px;}
  .card-info{flex:1;min-width:0;}
  .card-label{font-size:9px;font-weight:700;letter-spacing:.2em;color:#C9A227;text-transform:uppercase;margin-bottom:4px;}
  .card-title{font-size:16px;font-weight:700;color:#fff;margin-bottom:4px;}
  .card-sub{font-size:12px;color:rgba(255,255,255,.4);margin-bottom:16px;}
  .key-box{background:#07070f;border:1px solid rgba(212,175,55,.3);border-radius:8px;padding:12px 16px;font-family:'Courier New',monospace;font-size:18px;font-weight:800;color:#C9A227;letter-spacing:3px;margin-bottom:14px;word-break:break-all;}
  .cred-box{background:#07070f;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:4px 0;margin-bottom:14px;}
  .cred-row{display:flex;justify-content:space-between;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,.04);}
  .cred-row:last-child{border-bottom:none;}
  .cred-label{font-size:10px;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.1em;}
  .cred-val{font-size:12px;color:rgba(255,255,255,.8);font-family:monospace;word-break:break-all;}
  .btn-card{display:inline-block;background:linear-gradient(135deg,#C9A227,#8B6914);color:#000;text-decoration:none;font-weight:800;font-size:12px;letter-spacing:.1em;padding:10px 22px;border-radius:8px;}
  .btn-card-outline{display:inline-block;border:1px solid rgba(201,162,39,.4);color:#C9A227;text-decoration:none;font-weight:700;font-size:12px;letter-spacing:.08em;padding:9px 20px;border-radius:8px;}
  .footer{background:#07070f;border:1px solid rgba(212,175,55,.12);border-top:none;border-radius:0 0 20px 20px;padding:28px 40px;text-align:center;}
  .footer p{color:rgba(255,255,255,.2);font-size:11px;margin:3px 0;}
</style>
</head>
<body><div class="w">

<div class="header">
  <div style="font-size:48px;margin-bottom:16px;">👑</div>
  <div class="academy-name">Elite Dark Academy</div>
  <div class="header-title">Você está dentro do círculo.</div>
  <div class="header-sub">Sua compra foi confirmada. Seus acessos estão prontos.</div>
</div>

<div class="body">
  <div class="greeting">Bem-vindo, ${firstName}.</div>
  <p class="intro">
    Abaixo estão todos os seus acessos ao ecossistema do <strong style="color:#C9A227">Elite Dark Academy</strong>.
    Guarde este email em lugar seguro — ele contém suas credenciais de acesso a todas as ferramentas.
  </p>

  <div class="section-title">Seus Acessos</div>

  ${discordBlock}
  ${cenadropBlock}
  ${narrativaBlock}

  <p style="font-size:13px;color:rgba(255,255,255,.3);margin-top:28px;line-height:1.7;">
    Dúvidas ou problemas com algum acesso? Responda diretamente a este email.
  </p>
</div>

<div class="footer">
  <p>© ${new Date().getFullYear()} Elite Dark Academy</p>
  <p>Você recebeu este email porque realizou uma compra.</p>
</div>

</div></body></html>`,
    });

    console.log(`📧 Email EDA enviado para ${email}`);
  } catch (err) {
    console.error('❌ Erro ao enviar email EDA:', err.message);
    errors.push({ service: 'email', error: err.message });
  }

  return res.status(200).json({ ok: true, results, errors });
};
