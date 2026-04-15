// api/admin.js — DarkFlow Admin API

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `DF-${seg()}-${seg()}-${seg()}`;
}

function supabaseFetch(path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      ...(options.headers || {})
    }
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).end();

  const { password, action, key, email, note, quantity } = req.body || {};

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta' });
  }

  try {
    if (action === 'list') {
      const r = await supabaseFetch('licenses?select=*&order=created_at.desc');
      const data = await r.json();
      return res.status(200).json({ licenses: data });
    }

    if (action === 'create') {
      const qty = Math.min(parseInt(quantity) || 1, 50);
      const keys = Array.from({ length: qty }, () => ({
        key:    generateKey(),
        email:  email || null,
        note:   note  || null,
        active: true,
      }));
      const r = await supabaseFetch('licenses', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: JSON.stringify(keys)
      });
      const data = await r.json();
      return res.status(200).json({ created: data });
    }

    if (action === 'toggle') {
      if (!key) return res.status(400).json({ error: 'Chave obrigatória' });
      const r1 = await supabaseFetch(`licenses?key=eq.${encodeURIComponent(key)}&select=active`);
      const [lic] = await r1.json();
      if (!lic) return res.status(404).json({ error: 'Licença não encontrada' });
      const newState = !lic.active;
      await supabaseFetch(`licenses?key=eq.${encodeURIComponent(key)}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ active: newState })
      });
      return res.status(200).json({ key, active: newState });
    }

    if (action === 'delete') {
      if (!key) return res.status(400).json({ error: 'Chave obrigatória' });
      await supabaseFetch(`licenses?key=eq.${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: { 'Prefer': 'return=minimal' }
      });
      return res.status(200).json({ deleted: key });
    }

    return res.status(400).json({ error: 'Ação desconhecida' });

  } catch (err) {
    console.error('Admin error:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
