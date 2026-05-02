// api/waitlist.js — Narrativa IA waitlist via Resend Audiences
const { Resend } = require('resend');

const AUDIENCE_NAME = 'Narrativa IA Waitlist';

// Cache in-process so we don't call audiences.list() on every request
let cachedAudienceId = process.env.RESEND_AUDIENCE_ID || null;

async function getOrCreateAudience(resend) {
  if (cachedAudienceId) return cachedAudienceId;

  const { data: list } = await resend.audiences.list();
  const existing = (list?.data ?? []).find(a => a.name === AUDIENCE_NAME);

  if (existing) {
    cachedAudienceId = existing.id;
    return cachedAudienceId;
  }

  const { data: created } = await resend.audiences.create({ name: AUDIENCE_NAME });
  cachedAudienceId = created.id;
  console.log('[waitlist] audience criada:', cachedAudienceId);
  return cachedAudienceId;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body ?? {};

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'E-mail inválido' });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const audienceId = await getOrCreateAudience(resend);

    const { error } = await resend.contacts.create({
      audienceId,
      email: email.trim().toLowerCase(),
      unsubscribed: false,
    });

    if (error) {
      // Resend returns error if contact already exists — treat as success
      if (error.name === 'validation_error' || error.message?.includes('already exists')) {
        return res.status(200).json({ ok: true, already: true });
      }
      throw new Error(error.message);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[waitlist] erro:', err.message);
    return res.status(500).json({ error: 'Erro ao registrar e-mail' });
  }
};
