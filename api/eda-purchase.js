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
const { renderEmail }             = require('../emails/render');

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

  // Datas de compra e expiração (timestamps Hotmart em ms)
  const rawOrderDate   = body?.data?.purchase?.order_date || body?.data?.purchase?.approved_date;
  const rawNextCharge  = body?.data?.subscription?.subscriber?.next_payment_date;
  const purchasedAt    = rawOrderDate  ? new Date(Number(rawOrderDate)).toISOString()  : new Date().toISOString();
  const expiresAt      = rawNextCharge ? new Date(Number(rawNextCharge)).toISOString() : null;

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

    // Notifica o aluno sobre o cancelamento
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const firstName = (name || email).split(' ')[0];
      await resend.emails.send({
        from:    'Elite Dark Academy <noreply@raynern.com.br>',
        to:      email,
        subject: 'Seu acesso ao Elite Dark Academy foi cancelado',
        html:    renderEmail('eda/acesso-revogado', { PRIMEIRO_NOME: firstName }),
      });
    } catch (err) {
      console.error('❌ Erro ao enviar email de revogação:', err.message);
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
        body: JSON.stringify({ max_uses: 1, max_age: 86400, unique: true }),
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
        expires_at: expiresAt,
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
        active:       true,
        origin:       'elite',
        purchased_at: purchasedAt,
        expires_at:   expiresAt,
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
    await resend.emails.send({
      from:    'Elite Dark Academy <noreply@raynern.com.br>',
      to:      email,
      subject: `👑 Bem-vindo ao Elite Dark Academy, ${firstName}. Seus acessos estão aqui.`,
      html: renderEmail('eda/boas-vindas', {
        PRIMEIRO_NOME:          firstName,
        LINK_DISCORD:           results.discord || '#',
        CHAVE_CENADROP:         results.cenadrop || 'Erro ao gerar — contate o suporte',
        LINK_DOWNLOAD_CENADROP: 'https://raynern.com.br/cenadrop/download',
        EMAIL_NARRATIVA:        email,
        SENHA_NARRATIVA:        narrativaPassword || 'use sua senha atual',
        LINK_NARRATIVA:         'https://narrativaia.com.br',
      }),
    });
    console.log(`📧 Email EDA enviado para ${email}`);
  } catch (err) {
    console.error('❌ Erro ao enviar email EDA:', err.message);
    errors.push({ service: 'email', error: err.message });
  }

  return res.status(200).json({ ok: true, results, errors });
};
