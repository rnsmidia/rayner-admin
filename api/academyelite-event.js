// api/academyelite-event.js — Funil tracking Elite Dark Academy
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { session_id, event, step, answer } = req.body ?? {};

  if (!session_id || !event) {
    return res.status(400).json({ error: 'session_id e event são obrigatórios' });
  }

  try {
    await supabase.from('academyelite_funnel_events').insert({
      session_id: String(session_id).slice(0, 64),
      event:      String(event).slice(0, 64),
      step:       typeof step === 'number' ? step : null,
      answer:     answer ? String(answer).slice(0, 8) : null,
    });
  } catch (err) {
    console.error('[academyelite-event]', err.message);
  }

  return res.status(200).json({ ok: true });
};
