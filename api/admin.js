// api/admin.js
// Painel admin com suporte a alunos (Hotmart) + controle manual de licenças

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '@Benicio23';

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth simples por header
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '');
  if (token !== ADMIN_PASSWORD && req.body?.password !== ADMIN_PASSWORD) {
    // Permite login via body também
    if (req.method === 'POST' && req.body?.action === 'login') {
      if (req.body?.password === ADMIN_PASSWORD) {
        return res.status(200).json({ ok: true, token: ADMIN_PASSWORD });
      }
      return res.status(401).json({ error: 'Senha incorreta' });
    }
    return res.status(401).json({ error: 'Não autorizado' });
  }

  const action = req.body?.action || req.query?.action;

  // ─── LICENÇAS ───────────────────────────────────────────────────────────────

  if (action === 'list' || req.method === 'GET' && !action) {
    const { data, error } = await supabase
      .from('licenses')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ licenses: data });
  }

  if (action === 'create') {
    const { email, name, phone, notes } = req.body;
    const key = await generateUniqueKey();
    const { data, error } = await supabase.from('licenses').insert({
      key,
      email: email || null,
      name: name || null,
      phone: phone || null,
      notes: notes || null,
      status: 'active',
      source: 'manual',
      created_at: new Date().toISOString()
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, license: data });
  }

  if (action === 'toggle') {
    const { key } = req.body;
    const { data: current } = await supabase.from('licenses').select('status').eq('key', key).single();
    const newStatus = current?.status === 'active' ? 'inactive' : 'active';
    const { error } = await supabase.from('licenses').update({ status: newStatus }).eq('key', key);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, status: newStatus });
  }

  if (action === 'revoke') {
    const { key } = req.body;
    const { error } = await supabase.from('licenses').update({ status: 'inactive' }).eq('key', key);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (action === 'regenkey') {
    // Gera uma nova chave para o registro (mantém email/nome)
    const { key: oldKey } = req.body;
    const newKey = await generateUniqueKey();
    const { error } = await supabase.from('licenses').update({ key: newKey }).eq('key', oldKey);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, newKey });
  }

  if (action === 'delete') {
    const { key } = req.body;
    const { error } = await supabase.from('licenses').delete().eq('key', key);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (action === 'update') {
    // Atualiza nome, email, phone, notes de uma licença
    const { key, name, email, phone, notes } = req.body;
    const updates = {};
    if (name  !== undefined) updates.name  = name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (notes !== undefined) updates.notes = notes;
    const { error } = await supabase.from('licenses').update(updates).eq('key', key);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ─── STATS ──────────────────────────────────────────────────────────────────

  if (action === 'stats') {
    const { data, error } = await supabase.from('licenses').select('status, source');
    if (error) return res.status(500).json({ error: error.message });
    const total    = data.length;
    const active   = data.filter(l => l.status === 'active').length;
    const inactive = data.filter(l => l.status !== 'active').length;
    const hotmart  = data.filter(l => l.source === 'hotmart').length;
    const manual   = data.filter(l => l.source === 'manual').length;
    return res.status(200).json({ total, active, inactive, hotmart, manual });
  }

  return res.status(400).json({ error: 'Ação desconhecida' });
}
