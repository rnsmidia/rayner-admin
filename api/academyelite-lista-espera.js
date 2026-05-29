// api/academyelite-lista-espera.js — Lista de Desistência EDA
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

  const { nome, email, whatsapp, q1, q2, q3 } = req.body ?? {};

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'E-mail inválido' });
  }
  if (!nome || typeof nome !== 'string' || nome.trim().length < 2) {
    return res.status(400).json({ error: 'Nome inválido' });
  }

  const emailNorm = email.trim().toLowerCase();
  const nomeNorm  = nome.trim();
  const whatsNorm = (whatsapp || '').trim();

  try {
    const { error } = await supabase
      .from('academyelite_lista_espera')
      .insert({
        nome:     nomeNorm,
        email:    emailNorm,
        whatsapp: whatsNorm,
        q1:       q1 || null,
        q2:       q2 || null,
        q3:       q3 || null,
        status:   'pendente',
      });

    if (error && !error.message?.includes('duplicate')) {
      console.error('[lista-espera] supabase error:', error.message);
    }
  } catch (ex) {
    console.error('[lista-espera] exception:', ex.message);
  }

  return res.status(200).json({ ok: true });
};
