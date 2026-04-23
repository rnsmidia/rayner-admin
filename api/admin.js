// api/admin.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── MÚLTIPLOS ADMINS ─────────────────────────────────────────
// Para adicionar/remover admins, edite esta lista.
// Cada admin tem: nome, login e senha.
const ADMINS = [
  { name: 'Rayner',     login: 'rnadmin', password: process.env.ADMIN_PASSWORD  || '@Benicio23' },
  { name: 'Marcos',     login: 'mcadmin', password: process.env.ADMIN2_PASSWORD || '@Samuel' },
  { name: 'Jaqueline',  login: 'jnadmin', password: process.env.ADMIN3_PASSWORD || '@Samuel' },
];

function findAdmin(login, password) {
  return ADMINS.find(a => a.login === login && a.password === password);
}

function isValidToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [login, ...rest] = decoded.split(':');
    const password = rest.join(':');
    return !!findAdmin(login, password);
  } catch { return false; }
}

function makeToken(login, password) {
  return Buffer.from(`${login}:${password}`).toString('base64');
}

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const body = req.body || {};
  const action = body.action || req.query?.action;

  // LOGIN
  if (action === 'login') {
    const admin = findAdmin(body.login || '', body.password || '');
    if (admin) {
      const token = makeToken(admin.login, admin.password);
      return res.status(200).json({ ok: true, token, name: admin.name });
    }
    return res.status(401).json({ error: 'Login ou senha incorretos' });
  }

  // AUTH
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  const legacyOk = ADMINS.some(a => a.password === token || a.password === body.password);
  const tokenOk  = isValidToken(token);
  if (!legacyOk && !tokenOk) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  // LIST
  if (action === 'list' || (req.method === 'GET' && !action)) {
    const { data, error } = await supabase.from('licenses').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ licenses: data });
  }

  // CREATE
  if (action === 'create') {
    const key = await generateUniqueKey();
    const { data, error } = await supabase.from('licenses').insert({
      key, email: body.email||null, name: body.name||null, phone: body.phone||null,
      notes: body.notes||null, status: 'active', source: 'manual', created_at: new Date().toISOString()
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, license: data });
  }

  // TOGGLE
  if (action === 'toggle') {
    const { data: cur } = await supabase.from('licenses').select('status').eq('key', body.key).single();
    const newStatus = cur?.status === 'active' ? 'inactive' : 'active';
    await supabase.from('licenses').update({ status: newStatus }).eq('key', body.key);
    return res.status(200).json({ ok: true, status: newStatus });
  }

  // REGEN KEY
  if (action === 'regenkey') {
    const newKey = await generateUniqueKey();
    await supabase.from('licenses').update({ key: newKey }).eq('key', body.key);
    return res.status(200).json({ ok: true, newKey });
  }

  // DELETE
  if (action === 'delete') {
    await supabase.from('licenses').delete().eq('key', body.key);
    return res.status(200).json({ ok: true });
  }

  // UPDATE
  if (action === 'update') {
    const updates = {};
    if (body.name  !== undefined) updates.name  = body.name;
    if (body.email !== undefined) updates.email = body.email;
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.notes !== undefined) updates.notes = body.notes;
    await supabase.from('licenses').update(updates).eq('key', body.key);
    return res.status(200).json({ ok: true });
  }

  // STATS
  if (action === 'stats') {
    const { data } = await supabase.from('licenses').select('status, source');
    const total    = (data||[]).length;
    const active   = (data||[]).filter(l => l.status === 'active').length;
    const inactive = (data||[]).filter(l => l.status !== 'active').length;
    const hotmart  = (data||[]).filter(l => l.source === 'hotmart').length;
    const manual   = (data||[]).filter(l => l.source === 'manual').length;
    return res.status(200).json({ total, active, inactive, hotmart, manual });
  }

  return res.status(400).json({ error: 'Ação desconhecida' });
};
