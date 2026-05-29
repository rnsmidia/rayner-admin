// api/academyelite-waitlist.js — Elite Dark Academy VIP waitlist
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const AUDIENCE_NAME = 'Elite Dark Academy VIP';
let cachedAudienceId = null;

async function getOrCreateAudience(resend) {
  if (cachedAudienceId) return cachedAudienceId;
  const { data: list } = await resend.audiences.list();
  const existing = (list?.data ?? []).find(a => a.name === AUDIENCE_NAME);
  if (existing) { cachedAudienceId = existing.id; return cachedAudienceId; }
  const { data: created } = await resend.audiences.create({ name: AUDIENCE_NAME });
  cachedAudienceId = created.id;
  return cachedAudienceId;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { nome, email, whatsapp, source, q1, q2, q3 } = req.body ?? {};

  // Rota alternativa: Lista de Desistência (source === 'lista-espera')
  if (source === 'lista-espera') {
    if (!email || !email.includes('@') || !nome || nome.trim().length < 2) {
      return res.status(400).json({ error: 'Dados inválidos' });
    }
    try {
      await supabase.from('academyelite_lista_espera').insert({
        nome:     nome.trim(),
        email:    email.trim().toLowerCase(),
        whatsapp: (whatsapp || '').trim(),
        q1:       q1 || null,
        q2:       q2 || null,
        q3:       q3 || null,
        status:   'pendente',
      });
    } catch (_) {}
    return res.status(200).json({ ok: true });
  }

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'E-mail inválido' });
  }
  if (!nome || typeof nome !== 'string' || nome.trim().length < 2) {
    return res.status(400).json({ error: 'Nome inválido' });
  }

  const emailNorm = email.trim().toLowerCase();
  const nomeNorm  = nome.trim();
  const whatsNorm = (whatsapp || '').trim();

  // 1. Save to Supabase
  try {
    const { error: dbErr } = await supabase
      .from('academyelite_waitlist')
      .insert({ nome: nomeNorm, email: emailNorm, whatsapp: whatsNorm });

    if (dbErr && !dbErr.message?.includes('duplicate')) {
      console.error('[academyelite-waitlist] supabase error:', dbErr.message);
    }
  } catch (dbEx) {
    console.error('[academyelite-waitlist] supabase exception:', dbEx.message);
  }

  // 2. Add to Resend audience
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const audienceId = await getOrCreateAudience(resend);

    const firstName = nomeNorm.split(' ')[0];
    const lastName  = nomeNorm.split(' ').slice(1).join(' ') || '';

    await resend.contacts.create({
      audienceId,
      email: emailNorm,
      firstName,
      lastName,
      unsubscribed: false,
    });
  } catch (resendEx) {
    // Not fatal — already saved to Supabase
    console.error('[academyelite-waitlist] resend error:', resendEx.message);
  }

  return res.status(200).json({ ok: true });
};
