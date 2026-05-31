// api/admin.js
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { pbkdf2Sync, randomBytes } = require('crypto');
const fs = require('fs');
const path = require('path');
const { renderEmail } = require('../emails/render');

function hashNarrativaPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyNarrativaPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return derived === hash;
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── MÚLTIPLOS ADMINS ─────────────────────────────────────────
// Para adicionar/remover admins, edite esta lista.
// Cada admin tem: nome, login e senha.
const ADMINS = [
  { name: 'Rayner',     login: 'rnadmin', password: process.env.ADMIN_PASSWORD  || '' },
  { name: 'Marcos',     login: 'mcadmin', password: process.env.ADMIN2_PASSWORD || '' },
  { name: 'Jaqueline',  login: 'jnadmin', password: process.env.ADMIN3_PASSWORD || '' },
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

  // TRACK VISIT — público, sem autenticação
  if (action === 'track-visit') {
    const raw   = String(body.video || 'direct');
    const video = raw.slice(0, 50).replace(/[^a-zA-Z0-9_\-]/g, '') || 'direct';
    await supabase.from('licenses').insert({
      key:     'VISIT-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      product: 'nx_visit',
      status:  'visit',
      source:  video,
      notes:   video
    });
    return res.status(200).json({ ok: true });
  }

  // FUNNEL STATUS — público, só leitura
  if (action === 'funnel-status') {
    const [evtStart, evtQual, evtDisqual, evtLead, evtWa, waitlistData, membersData] = await Promise.all([
      supabase.from('academyelite_funnel_events').select('session_id').eq('event', 'funnel_start').limit(10000),
      supabase.from('academyelite_funnel_events').select('session_id').eq('event', 'qualified').limit(10000),
      supabase.from('academyelite_funnel_events').select('session_id').eq('event', 'disqualified').limit(10000),
      supabase.from('academyelite_funnel_events').select('session_id').eq('event', 'lead_captured').limit(10000),
      supabase.from('academyelite_funnel_events').select('session_id').eq('event', 'whatsapp_click').limit(10000),
      supabase.from('academyelite_waitlist').select('*', { count: 'exact', head: true }),
      supabase.from('discord_invites').select('id, discord_user_id, revoked'),
    ]);
    const uniq = res => new Set((res.data || []).map(r => r.session_id)).size;
    const visits       = uniq(evtStart);
    const qualified    = uniq(evtQual);
    const disqualified = uniq(evtDisqual);
    const leads        = uniq(evtLead);
    const whatsapp     = uniq(evtWa);
    const members      = (membersData.data || []);
    const byEmail      = {};
    for (const m of members) {
      if (!byEmail[m.id] || m.discord_user_id) byEmail[m.id] = m;
    }
    const uniqueMembers = Object.values(byEmail);
    return res.status(200).json({
      funnel: {
        visits, qualified, disqualified, leads, whatsapp,
        rateQ: visits  > 0 ? Math.round(qualified / visits  * 100) : 0,
        rateL: qualified > 0 ? Math.round(leads / qualified * 100) : 0,
        rateW: leads   > 0 ? Math.round(whatsapp / leads   * 100) : 0,
      },
      waitlist: waitlistData.count || 0,
      members: {
        total:   uniqueMembers.length,
        joined:  uniqueMembers.filter(m => m.discord_user_id).length,
        revoked: uniqueMembers.filter(m => m.revoked).length,
      },
    });
  }

  // AUTH
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  const legacyOk = ADMINS.some(a => a.password === token || a.password === body.password);
  const tokenOk  = isValidToken(token);
  if (!legacyOk && !tokenOk) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  // LIST — apenas licenças CenaDrop (exclui nxsaude)
  if (action === 'list' || (req.method === 'GET' && !action)) {
    const { data, error } = await supabase.from('licenses').select('*')
      .or('product.is.null,and(product.neq.nxsaude,product.neq.nx_visit)')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ licenses: data });
  }

  // CREATE
  if (action === 'create') {
    const key = await generateUniqueKey();
    const { data, error } = await supabase.from('licenses').insert({
      key, email: body.email||null, name: body.name||null, phone: body.phone||null,
      notes: body.notes||null, status: 'active', source: 'manual', created_at: new Date().toISOString(),
      expires_at: body.expires_at || null
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
    if (body.name     !== undefined) updates.name     = body.name;
    if (body.email    !== undefined) updates.email    = body.email;
    if (body.phone    !== undefined) updates.phone    = body.phone;
    if (body.notes    !== undefined) updates.notes    = body.notes;
    if (body.expires_at !== undefined) updates.expires_at = body.expires_at || null;
    await supabase.from('licenses').update(updates).eq('key', body.key);
    return res.status(200).json({ ok: true });
  }

  // STATS
  if (action === 'stats') {
    const { data } = await supabase.from('licenses').select('status, source')
      .or('product.is.null,and(product.neq.nxsaude,product.neq.nx_visit)');
    const total     = (data||[]).length;
    const active    = (data||[]).filter(l => l.status === 'active').length;
    const inactive  = (data||[]).filter(l => l.status !== 'active').length;
    const hotmart   = (data||[]).filter(l => (l.source||'').startsWith('hotmart')).length;
    const hotmartRN = (data||[]).filter(l => l.source === 'hotmart-RN').length;
    const hotmartMC = (data||[]).filter(l => l.source === 'hotmart-MC').length;
    const manual    = (data||[]).filter(l => l.source === 'manual').length;
    return res.status(200).json({ total, active, inactive, hotmart, hotmartRN, hotmartMC, manual });
  }

  // RESEND EMAIL
  if (action === 'resend-email') {
    const { data: lic } = await supabase.from('licenses').select('*').eq('key', body.key).single();
    if (!lic) return res.status(404).json({ error: 'Licença não encontrada' });
    if (!lic.email) return res.status(400).json({ error: 'Licença sem email cadastrado' });
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const firstName = (lic.name || 'Cliente').split(' ')[0];
      await resend.emails.send({
        from: 'CenaDrop <contato@cenadrop.com.br>',
        to: lic.email,
        subject: '🔑 Sua chave CenaDrop Flow',
        html: renderEmail('cenadrop/reenvio-chave', {
          PRIMEIRO_NOME: firstName,
          CHAVE: lic.key,
          LINK_DOWNLOAD: 'https://raynern.com.br/cenadrop/download',
        }),
      });
      return res.status(200).json({ ok: true, message: `Email reenviado para ${lic.email}` });
    } catch (err) {
      return res.status(500).json({ error: 'Erro ao enviar email: ' + err.message });
    }
  }

  // ── NARRATIVA IA — USERS ──────────────────────────────────────
  if (action === 'narrativa-list') {
    let { data, error } = await supabase.from('narrativa_users').select('id,email,name,active,created_at,origin,purchased_at,expires_at').order('created_at', { ascending: false });
    if (error) ({ data, error } = await supabase.from('narrativa_users').select('id,email,name,active,created_at').order('created_at', { ascending: false }));
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ users: data });
  }

  if (action === 'narrativa-create') {
    const { email, name, password, origin, purchased_at, expires_at } = body;
    if (!email || !name || !password) return res.status(400).json({ error: 'Email, nome e senha obrigatórios' });
    const password_hash = hashNarrativaPassword(password);
    const insertData = { email: email.toLowerCase(), name, password_hash, active: true, origin: origin || 'manual' };
    if (purchased_at) insertData.purchased_at = purchased_at;
    if (expires_at)   insertData.expires_at   = expires_at;
    const { data, error } = await supabase.from('narrativa_users').insert(insertData).select('id,email,name,active,created_at,origin,purchased_at,expires_at').single();
    if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.message });
    // Email de boas-vindas
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const firstName = name.split(' ')[0];
      await resend.emails.send({
        from: 'Narrativa IA <contato@cenadrop.com.br>',
        to: email.toLowerCase(),
        subject: '✨ Seu acesso ao Narrativa IA Studio',
        html: renderEmail('narrativa/boas-vindas', {
          PRIMEIRO_NOME: firstName,
          EMAIL: email.toLowerCase(),
          SENHA: password,
          LINK_ACESSO: 'https://narrativaia.com.br',
        }),
      });
    } catch (e) { console.error('Email error:', e); }
    return res.status(200).json({ ok: true, user: data });
  }

  if (action === 'narrativa-update') {
    const { id, name, email, password, origin, purchased_at, expires_at } = body;
    if (!id) return res.status(400).json({ error: 'ID obrigatório' });
    const updates = {};
    if (name)         updates.name         = name;
    if (email)        updates.email        = email.toLowerCase();
    if (password)     updates.password_hash = hashNarrativaPassword(password);
    if (origin)       updates.origin       = origin;
    if (purchased_at !== undefined) updates.purchased_at = purchased_at || null;
    if (expires_at   !== undefined) updates.expires_at   = expires_at   || null;
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nada para atualizar' });
    const { error } = await supabase.from('narrativa_users').update(updates).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (action === 'narrativa-resend') {
    const { id } = body;
    if (!id) return res.status(400).json({ error: 'ID obrigatório' });
    const { data: user, error: fe } = await supabase.from('narrativa_users').select('email,name').eq('id', id).single();
    if (fe || !user) return res.status(404).json({ error: 'Usuário não encontrado' });
    const newPassword = randomBytes(6).toString('hex'); // 12 chars hex
    const password_hash = hashNarrativaPassword(newPassword);
    await supabase.from('narrativa_users').update({ password_hash }).eq('id', id);
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const firstName = user.name.split(' ')[0];
      await resend.emails.send({
        from: 'Narrativa IA <contato@cenadrop.com.br>',
        to: user.email,
        subject: '🔑 Seus novos dados de acesso — Narrativa IA Studio',
        html: renderEmail('narrativa/reenvio-senha', {
          PRIMEIRO_NOME: firstName,
          EMAIL: user.email,
          SENHA: newPassword,
          LINK_ACESSO: 'https://narrativaia.com.br',
        }),
      });
    } catch (e) { console.error('Email error:', e); }
    return res.status(200).json({ ok: true });
  }

  if (action === 'narrativa-toggle') {
    const { id, force } = body;
    let active;
    if (typeof force === 'boolean') {
      active = force;
    } else {
      const { data: cur } = await supabase.from('narrativa_users').select('active').eq('id', id).single();
      active = !cur?.active;
    }
    await supabase.from('narrativa_users').update({ active }).eq('id', id);
    if (!active) {
      const { data: u } = await supabase.from('narrativa_users').select('email, origin').eq('id', id).single();
      if (u?.origin === 'elite') {
        const { data: inv } = await supabase.from('discord_invites')
          .select('discord_user_id').eq('email', u.email)
          .order('created_at', { ascending: false }).limit(1).single();
        if (inv?.discord_user_id) {
          await fetch(`https://discord.com/api/v10/guilds/1508895864540626986/members/${inv.discord_user_id}/roles/1508900115459477535`,
            { method: 'DELETE', headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }).catch(() => {});
        }
      }
    }
    return res.status(200).json({ ok: true, active });
  }

  if (action === 'narrativa-delete') {
    await supabase.from('narrativa_users').delete().eq('id', body.id);
    return res.status(200).json({ ok: true });
  }

  if (action === 'narrativa-stats') {
    const now      = new Date();
    const d7       = new Date(now - 7  * 86400000).toISOString();
    const d30      = new Date(now - 30 * 86400000).toISOString();
    const today    = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const { data } = await supabase.from('narrativa_users').select('active, created_at');
    const arr      = data || [];
    const total    = arr.length;
    const active   = arr.filter(u => u.active).length;
    const inactive = total - active;
    const new_today = arr.filter(u => u.created_at >= today).length;
    const new_7d    = arr.filter(u => u.created_at >= d7).length;
    const new_30d   = arr.filter(u => u.created_at >= d30).length;
    return res.status(200).json({ total, active, inactive, new_today, new_7d, new_30d });
  }

  // LOGIN PÚBLICO — usuários do Narrativa IA Studio
  if (action === 'narrativa-login') {
    const { email, password } = body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email e senha obrigatórios' });
    const { data: rows } = await supabase
      .from('narrativa_users')
      .select('id, email, name, password_hash, active')
      .eq('email', email.toLowerCase())
      .limit(1);
    const user = (rows || [])[0];
    if (!user || !user.active || !verifyNarrativaPassword(password, user.password_hash))
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    const NARRATIVA_APP = process.env.NARRATIVA_APP_URL || '';
    return res.status(200).json({ ok: true, name: user.name, redirect: NARRATIVA_APP });
  }

  // ── NEXUS SAÚDE — COMPRADORES ─────────────────────────────
  if (action === 'nexus-list') {
    const { data, error } = await supabase
      .from('licenses')
      .select('key, name, email, status, created_at, notes')
      .eq('product', 'nxsaude')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ buyers: data });
  }

  if (action === 'nexus-resend') {
    const { key } = body;
    const { data: buyer } = await supabase.from('licenses').select('*').eq('key', key).single();
    if (!buyer) return res.status(404).json({ error: 'Comprador não encontrado' });
    if (!buyer.email) return res.status(400).json({ error: 'Sem email cadastrado' });
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const firstName = (buyer.name || 'Aluno').split(' ')[0];
      const PLATFORM_URL = 'https://nxsaude.app.br';
      const SENHA_PADRAO = 'protocolo45+';
      const WHATSAPP_URL = 'https://chat.whatsapp.com/CtNvcyiWxT6FGS6iv0fmi0?mode=gi_t';
      await resend.emails.send({
        from: 'NX Saúde <ola@nxsaude.app.br>',
        to: buyer.email,
        subject: `Seus dados de acesso ao Protocolo de Jejum Após os 45, ${firstName}`,
        html: `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a1628;font-family:'Segoe UI',Arial,sans-serif;">
<div style="max-width:580px;margin:0 auto;padding:32px 16px;">
<div style="background:#0D1B2A;border:1px solid rgba(20,184,166,.2);border-radius:16px;overflow:hidden;">
<div style="background:linear-gradient(135deg,#0F2A3D,#112236);padding:36px 40px;text-align:center;border-bottom:1px solid rgba(255,255,255,.06);">
  <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#14B8A6;margin-bottom:10px;">NX SAÚDE</div>
  <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">Guia Prático<br><span style="color:#14B8A6;">Protocolo Simples de Jejum Após os 45</span></div>
</div>
<div style="padding:40px;">
  <p style="font-size:18px;font-weight:700;color:#ffffff;margin:0 0 8px;">Olá, ${firstName}. Aqui estão seus dados de acesso.</p>
  <p style="font-size:15px;color:#94A3B8;line-height:1.7;margin:0 0 32px;">Conforme solicitado, seguem suas credenciais de acesso ao programa.</p>
  <div style="background:#112236;border:1px solid rgba(20,184,166,.2);border-radius:12px;padding:28px;margin-bottom:28px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#14B8A6;margin-bottom:16px;">Seus dados de acesso</div>
    <div style="margin-bottom:14px;"><div style="font-size:12px;color:#64748B;margin-bottom:4px;">Plataforma</div><div style="font-size:15px;font-weight:600;color:#E2E8F0;">nxsaude.app.br</div></div>
    <div><div style="font-size:12px;color:#64748B;margin-bottom:4px;">Senha</div>
    <div style="display:inline-block;background:rgba(20,184,166,.12);border:1px solid rgba(20,184,166,.3);border-radius:8px;padding:8px 16px;font-size:17px;font-weight:700;color:#14B8A6;letter-spacing:1px;font-family:'Courier New',monospace;">${SENHA_PADRAO}</div></div>
  </div>
  <div style="text-align:center;margin-bottom:32px;">
    <a href="${PLATFORM_URL}" style="display:inline-block;background:#14B8A6;color:#0D1B2A;text-decoration:none;font-weight:700;font-size:16px;padding:16px 40px;border-radius:10px;">Acessar o Programa</a>
  </div>
  <div style="background:rgba(20,184,166,.06);border:1px solid rgba(20,184,166,.15);border-radius:12px;padding:24px;text-align:center;">
    <div style="font-size:15px;font-weight:700;color:#ffffff;margin-bottom:6px;">💬 Comunidade no WhatsApp</div>
    <a href="${WHATSAPP_URL}" style="display:inline-block;background:rgba(37,211,102,.15);border:1px solid rgba(37,211,102,.35);color:#25D366;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;">Entrar no Grupo</a>
  </div>
</div>
<div style="padding:20px 40px;border-top:1px solid rgba(255,255,255,.06);text-align:center;">
  <p style="font-size:11px;color:#334155;margin:0;">© ${new Date().getFullYear()} NX Saúde · nxsaude.app.br</p>
</div>
</div></div></body></html>`,
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Erro ao enviar: ' + err.message });
    }
  }

  if (action === 'nexus-stats') {
    const { data } = await supabase.from('licenses').select('status').eq('product', 'nxsaude');
    const total    = (data||[]).length;
    const active   = (data||[]).filter(l => l.status === 'active').length;
    const inactive = total - active;
    return res.status(200).json({ total, active, inactive });
  }

  if (action === 'nexus-toggle') {
    const { key } = body;
    const { data: cur } = await supabase.from('licenses').select('status').eq('key', key).single();
    const newStatus = cur?.status === 'active' ? 'inactive' : 'active';
    await supabase.from('licenses').update({ status: newStatus, active: newStatus === 'active' }).eq('key', key);
    return res.status(200).json({ ok: true, status: newStatus });
  }

  // NEXUS VISITS — cliques na página de vendas por vídeo
  if (action === 'nexus-visits') {
    const days  = Math.min(parseInt(body.days || '30', 10), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('licenses')
      .select('source, created_at')
      .eq('product', 'nx_visit')
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const total    = (data || []).length;
    const byVideo  = {};
    for (const row of (data || [])) byVideo[row.source] = (byVideo[row.source] || 0) + 1;
    const breakdown = Object.entries(byVideo)
      .map(([video, count]) => ({ video, count }))
      .sort((a, b) => b.count - a.count);
    return res.status(200).json({ total, breakdown });
  }

  // MONITOR — uso dos serviços de infraestrutura
  if (action === 'monitor') {
    const nowDate      = new Date();
    const monthStart   = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
    const todayStart   = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
    const monthStartMs = monthStart.getTime();
    const nowMs        = nowDate.getTime();
    const monthIso     = monthStart.toISOString();
    const todayIso     = todayStart.toISOString();

    const [r1, r2, r3, r4, r5, r6, r7, r8, vercelRes, ghStorageRes] = await Promise.all([
      // Supabase row counts
      supabase.from('licenses').select('*', { count: 'exact', head: true }).or('product.is.null,product.neq.nxsaude').neq('product', 'nx_visit'),
      supabase.from('licenses').select('*', { count: 'exact', head: true }).eq('product', 'nxsaude'),
      supabase.from('narrativa_users').select('*', { count: 'exact', head: true }),
      // Resend estimation — novos registros com email este mês (cada = 1 email enviado)
      supabase.from('licenses').select('*', { count: 'exact', head: true })
        .or('product.is.null,product.neq.nxsaude').neq('product', 'nx_visit').not('email', 'is', null).gte('created_at', monthIso),
      supabase.from('licenses').select('*', { count: 'exact', head: true })
        .eq('product', 'nxsaude').not('email', 'is', null).gte('created_at', monthIso),
      supabase.from('narrativa_users').select('*', { count: 'exact', head: true }).gte('created_at', monthIso),
      // Resend estimation — hoje
      supabase.from('licenses').select('*', { count: 'exact', head: true })
        .not('email', 'is', null).gte('created_at', todayIso),
      supabase.from('narrativa_users').select('*', { count: 'exact', head: true }).gte('created_at', todayIso),
      // Vercel deployments this month
      fetch(`https://api.vercel.com/v6/deployments?teamId=${process.env.VERCEL_TEAM_ID}&limit=100&since=${monthStartMs}&until=${nowMs}`, {
        headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` }
      }).then(r => r.json()).catch(() => ({})),
      // GitHub repo sizes
      fetch('https://api.github.com/user/repos?per_page=100&affiliation=owner', {
        headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
      }).then(r => r.json()).catch(() => []),
    ]);

    const cdRows  = r1.count || 0;
    const nxRows  = r2.count || 0;
    const nuRows  = r3.count || 0;
    const totalRows   = cdRows + nxRows + nuRows;
    const estimatedMB = parseFloat((totalRows * 0.002).toFixed(4));

    // Resend: email estimation from DB activity
    const emailsMonth = (r4.count || 0) + (r5.count || 0) + (r6.count || 0);
    const emailsToday = (r7.count || 0) + (r8.count || 0);

    // Vercel: count deployments
    const deployments = (vercelRes.deployments || []).length;

    // GitHub: total repo storage in MB
    const repos = Array.isArray(ghStorageRes) ? ghStorageRes : [];
    const repoNames  = ['rayner-admin', 'narrativa-ia', 'nxsaude-jejum'];
    const trackedRepos = repos.filter(r => repoNames.includes(r.name));
    const totalRepoKB  = trackedRepos.reduce((sum, r) => sum + (r.size || 0), 0);
    const repoSizesMB  = trackedRepos.map(r => ({ name: r.name, sizeMB: parseFloat((r.size / 1024).toFixed(1)) }));

    return res.status(200).json({
      supabase: {
        tables: { cenadrop: cdRows, nxsaude: nxRows, narrativa: nuRows },
        totalRows, estimatedMB,
        limits: { storageMB: 500, bandwidthGB: 5, mau: 50000 }
      },
      resend: {
        emailsMonth, emailsToday,
        limits: { monthly: 3000, daily: 100 }
      },
      vercel: {
        deployments, deploymentsLimit: 6000
      },
      github: {
        actionsMinutes: 0, actionsLimit: 2000,
        repoStorageMB: parseFloat((totalRepoKB / 1024).toFixed(1)),
        repoStorageLimit: 500,
        repos: repoSizesMB
      }
    });
  }

  // ── ACADEMY ELITE WAITLIST ────────────────────
  if (action === 'academy-stats') {
    const todayIso = new Date(new Date().setHours(0,0,0,0)).toISOString();
    const weekIso  = new Date(Date.now() - 7*24*60*60*1000).toISOString();
    const [total, today, week] = await Promise.all([
      supabase.from('academyelite_waitlist').select('*', { count: 'exact', head: true }),
      supabase.from('academyelite_waitlist').select('*', { count: 'exact', head: true }).gte('created_at', todayIso),
      supabase.from('academyelite_waitlist').select('*', { count: 'exact', head: true }).gte('created_at', weekIso),
    ]);
    return res.status(200).json({ total: total.count || 0, today: today.count || 0, week: week.count || 0 });
  }

  if (action === 'academy-list') {
    const { data, error } = await supabase
      .from('academyelite_waitlist')
      .select('id, nome, email, whatsapp, created_at')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ waitlist: data || [] });
  }

  if (action === 'academy-delete') {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID obrigatório' });
    const { error } = await supabase.from('academyelite_waitlist').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (action === 'academy-update-status') {
    const { id, status } = req.body;
    const valid = ['em_analise', 'selecionado', 'descartado'];
    if (!id || !valid.includes(status)) return res.status(400).json({ error: 'Dados inválidos' });
    const { error } = await supabase.from('academyelite_waitlist').update({ status }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── EDA MEMBERS — lista de compradores (discord_invites) ──────
  if (action === 'eda-members-list') {
    const { data, error } = await supabase
      .from('discord_invites')
      .select('id, email, name, invite_code, discord_user_id, used, revoked, revoked_reason, hotmart_order, created_at')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    const members = data || [];
    if (!members.length) return res.status(200).json({ members });

    // Enriquecer com dados de licença (CenaDrop) e Narrativa IA por email
    const emails = [...new Set(members.map(m => m.email).filter(Boolean))];
    const [licData, narData] = await Promise.all([
      supabase.from('licenses').select('email, key, status, expires_at').in('email', emails).eq('source', 'hotmart-EDA'),
      supabase.from('narrativa_users').select('email, active, expires_at').in('email', emails).eq('origin', 'elite'),
    ]);
    const licMap = {};
    for (const l of (licData.data || [])) licMap[l.email] = l;
    const narMap = {};
    for (const n of (narData.data || [])) narMap[n.email] = n;

    const enriched = members.map(m => ({
      ...m,
      license:  licMap[m.email]  || null,
      narrativa: narMap[m.email] || null,
    }));

    return res.status(200).json({ members: enriched });
  }

  // ── EDA RESEND INVITE — gera novo convite e reenvia email ─────
  if (action === 'eda-resend-invite') {
    const { email, name } = body;
    if (!email) return res.status(400).json({ error: 'email obrigatório' });

    const WELCOME_CHANNEL_EDA = '1508898202294816778';
    const firstName = (name || email).split(' ')[0];

    const inviteRes = await fetch(
      `https://discord.com/api/v10/channels/${WELCOME_CHANNEL_EDA}/invites`,
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
    if (!invite.code) return res.status(500).json({ error: 'Discord não retornou código' });
    const inviteUrl = `https://discord.gg/${invite.code}`;

    await supabase.from('discord_invites').insert({
      email: email.toLowerCase(),
      name:  name || '',
      invite_code:   invite.code,
      hotmart_order: 'resend-manual',
      used:    false,
      revoked: false,
    });

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from:    'Elite Dark Academy <noreply@raynern.com.br>',
      to:      email.toLowerCase(),
      subject: '💬 Novo convite para o Discord EDA',
      html: renderEmail('eda/reenvio-discord', {
        PRIMEIRO_NOME: firstName,
        LINK_DISCORD: inviteUrl,
      }),
    });

    return res.status(200).json({ ok: true, inviteUrl });
  }

  // ── EDA REVOKE ────────────────────────────────────────────────
  if (action === 'eda-revoke') {
    const { email } = body;
    if (!email) return res.status(400).json({ error: 'email obrigatório' });
    const { data: inv } = await supabase.from('discord_invites')
      .select('discord_user_id').eq('email', email.toLowerCase())
      .order('created_at', { ascending: false }).limit(1).single();
    if (inv?.discord_user_id) {
      await fetch(`https://discord.com/api/v10/guilds/1508895864540626986/members/${inv.discord_user_id}/roles/1508900115459477535`,
        { method: 'DELETE', headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }).catch(() => {});
    }
    await supabase.from('discord_invites').update({ revoked: true, revoked_reason: 'admin' }).eq('email', email.toLowerCase());
    await supabase.from('licenses').update({ status: 'inactive' }).eq('email', email.toLowerCase()).eq('source', 'hotmart-EDA');
    await supabase.from('narrativa_users').update({ active: false }).eq('email', email.toLowerCase());
    return res.status(200).json({ ok: true });
  }

  // ── EDA REACTIVATE ────────────────────────────────────────────
  if (action === 'eda-reactivate') {
    const { email } = body;
    if (!email) return res.status(400).json({ error: 'email obrigatório' });
    await supabase.from('discord_invites').update({ revoked: false, revoked_reason: null }).eq('email', email.toLowerCase());
    await supabase.from('licenses').update({ status: 'active' }).eq('email', email.toLowerCase()).eq('source', 'hotmart-EDA');
    await supabase.from('narrativa_users').update({ active: true }).eq('email', email.toLowerCase());

    // Restaura cargo Discord se o usuário ainda estiver no servidor
    const { data: inv } = await supabase.from('discord_invites')
      .select('discord_user_id').eq('email', email.toLowerCase())
      .not('discord_user_id', 'is', null)
      .order('created_at', { ascending: false }).limit(1).single();
    if (inv?.discord_user_id) {
      await fetch(`https://discord.com/api/v10/guilds/1508895864540626986/members/${inv.discord_user_id}/roles/1508900115459477535`,
        { method: 'PUT', headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }).catch(() => {});
    }
    return res.status(200).json({ ok: true });
  }

  // ── EDA DELETE ────────────────────────────────────────────────
  if (action === 'eda-delete') {
    const { email } = body;
    if (!email) return res.status(400).json({ error: 'email obrigatório' });
    await supabase.from('discord_invites').delete().eq('email', email.toLowerCase());
    return res.status(200).json({ ok: true });
  }

  // ── ACADEMY ELITE — FUNIL ANALYTICS ──────────────────────────
  if (action === 'academy-funnel-stats') {
    const { data } = await supabase
      .from('academyelite_funnel_events')
      .select('event, session_id');
    const rows = data || [];
    const uniq = evt => new Set(rows.filter(r => r.event === evt).map(r => r.session_id)).size;
    return res.status(200).json({
      visits:       uniq('funnel_start'),
      step1:        uniq('step_complete'),
      qualified:    uniq('qualified'),
      disqualified: uniq('disqualified'),
      formView:     uniq('form_view'),
      leads:        uniq('lead_captured'),
      whatsapp:     uniq('whatsapp_click'),
    });
  }

  // BLAST RECIPIENTS COUNT — conta por filtro
  if (action === 'blast-count') {
    const { recipients = 'all' } = body;
    let query = supabase
      .from('licenses')
      .select('email, status', { count: 'exact' })
      .or('product.is.null,and(product.neq.nxsaude,product.neq.nx_visit)')
      .not('email', 'is', null);
    if (recipients === 'active')   query = query.eq('status', 'active');
    if (recipients === 'inactive') query = query.neq('status', 'active');
    const { count, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, count });
  }

  // EMAIL TEMPLATES — retorna manifest (filtrado por product se informado)
  if (action === 'email-templates') {
    try {
      const manifestPath = path.join(process.cwd(), 'emails', 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const product = body.product;
      const filtered = product ? manifest.filter(t => t.product === product) : manifest;
      return res.status(200).json({ ok: true, templates: filtered });
    } catch (e) {
      return res.status(500).json({ error: 'Erro ao ler manifest: ' + e.message });
    }
  }

  // BLAST TEST — envia para um único email
  if (action === 'blast-test') {
    const { template: templateId, testEmail, vars: templateVars = {} } = body;
    if (!templateId || !testEmail) return res.status(400).json({ error: 'template e testEmail obrigatórios' });
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'emails', 'manifest.json'), 'utf8'));
      const tpl = manifest.find(t => t.id === templateId);
      if (!tpl) return res.status(404).json({ error: 'Template não encontrado' });
      const html = renderEmail(templateId, { PRIMEIRO_NOME: 'Você', ...templateVars });
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({ from: tpl.from, to: testEmail, subject: tpl.subject, html });
      return res.status(200).json({ ok: true, sent: 1 });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // BLAST CENADROP — disparo em massa
  if (action === 'blast-cenadrop') {
    const { template: templateId, recipients = 'active', vars: templateVars = {} } = body;
    if (!templateId) return res.status(400).json({ error: 'template obrigatório' });

    let query = supabase
      .from('licenses')
      .select('email, name, status')
      .or('product.is.null,and(product.neq.nxsaude,product.neq.nx_visit)')
      .not('email', 'is', null);

    if (recipients === 'active')   query = query.eq('status', 'active');
    if (recipients === 'inactive') query = query.neq('status', 'active');

    const { data: licenses, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    let tpl;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'emails', 'manifest.json'), 'utf8'));
      tpl = manifest.find(t => t.id === templateId);
      if (!tpl) return res.status(404).json({ error: 'Template não encontrado' });
    } catch (e) {
      return res.status(500).json({ error: 'Erro ao carregar manifest: ' + e.message });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    let sent = 0, failed = 0, skipped = 0;
    const errors = [];

    for (const lic of licenses) {
      if (!lic.email || !lic.email.includes('@')) { skipped++; continue; }
      try {
        const firstName = (lic.name || 'Aluno').split(' ')[0];
        const html = renderEmail(templateId, { PRIMEIRO_NOME: firstName, ...templateVars });
        await resend.emails.send({ from: tpl.from, to: lic.email, subject: tpl.subject, html });
        sent++;
        await new Promise(r => setTimeout(r, 120));
      } catch (err) {
        failed++;
        errors.push({ email: lic.email, error: err.message });
      }
    }

    return res.status(200).json({ ok: true, sent, failed, skipped, total: licenses.length, errors });
  }

  // BLAST NARRATIVA — contagem de destinatários
  if (action === 'blast-narrativa-count') {
    const { recipients = 'all' } = body;
    let query = supabase.from('narrativa_users').select('email, active', { count: 'exact' }).not('email', 'is', null);
    if (recipients === 'active')   query = query.eq('active', true);
    if (recipients === 'inactive') query = query.eq('active', false);
    const { count, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, count });
  }

  // BLAST NARRATIVA — disparo em massa para usuários do Narrativa IA
  if (action === 'blast-narrativa') {
    const { template: templateId, recipients = 'active', testEmail, vars: templateVars = {} } = body;
    if (!templateId) return res.status(400).json({ error: 'template obrigatório' });

    let query = supabase.from('narrativa_users').select('email, name, active').not('email', 'is', null);
    if (recipients === 'active')   query = query.eq('active', true);
    if (recipients === 'inactive') query = query.eq('active', false);
    const { data: users, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    let tpl;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'emails', 'manifest.json'), 'utf8'));
      tpl = manifest.find(t => t.id === templateId);
      if (!tpl) return res.status(404).json({ error: 'Template não encontrado' });
    } catch (e) {
      return res.status(500).json({ error: 'Erro ao carregar template: ' + e.message });
    }

    let targets;
    if (testEmail) {
      const { data: testUser } = await supabase.from('narrativa_users')
        .select('email, name').eq('email', testEmail.toLowerCase()).single();
      targets = [{ email: testEmail, name: testUser?.name || 'Usuário' }];
    } else {
      targets = users;
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    let sent = 0, failed = 0, skipped = 0;

    for (const u of targets) {
      if (!u.email || !u.email.includes('@')) { skipped++; continue; }
      const firstName = (u.name || 'Usuário').split(' ')[0];
      const html = renderEmail(templateId, {
        PRIMEIRO_NOME: firstName,
        EMAIL:         u.email,
        SENHA:         '••••••••',
        ...templateVars,
      });
      try {
        await resend.emails.send({ from: tpl.from, to: u.email, subject: tpl.subject, html });
        sent++;
        await new Promise(r => setTimeout(r, 120));
      } catch (err) {
        failed++;
      }
    }
    return res.status(200).json({ ok: true, sent, failed, skipped, total: targets.length });
  }

  // BLAST EDA — contagem de destinatários
  if (action === 'blast-eda-count') {
    const { recipients = 'active' } = body;
    let query = supabase.from('discord_invites').select('email', { count: 'exact' }).not('email', 'is', null);
    if (recipients === 'active')  query = query.eq('revoked', false);
    if (recipients === 'revoked') query = query.eq('revoked', true);
    const { count, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, count });
  }

  // BLAST EDA — disparo em massa para membros EDA
  if (action === 'blast-eda') {
    const { template: templateId, recipients = 'active', vars: templateVars = {}, testEmail } = body;
    if (!templateId) return res.status(400).json({ error: 'template obrigatório' });

    let query = supabase.from('discord_invites').select('email, name').not('email', 'is', null);
    if (recipients === 'active')  query = query.eq('revoked', false);
    if (recipients === 'revoked') query = query.eq('revoked', true);
    const { data: members, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    let targets;
    if (testEmail) {
      const { data: testMember } = await supabase.from('discord_invites')
        .select('email, name').eq('email', testEmail.toLowerCase()).single();
      targets = [{ email: testEmail, name: testMember?.name || 'Aluno' }];
    } else {
      targets = members;
    }

    let tpl;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'emails', 'manifest.json'), 'utf8'));
      tpl = manifest.find(t => t.id === templateId);
      if (!tpl) return res.status(404).json({ error: 'Template não encontrado' });
    } catch (e) {
      return res.status(500).json({ error: 'Erro ao carregar manifest: ' + e.message });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    let sent = 0, failed = 0, skipped = 0;

    for (const m of targets) {
      if (!m.email || !m.email.includes('@')) { skipped++; continue; }
      const firstNameEda = (m.name || 'Aluno').split(' ')[0];
      try {
        const html = renderEmail(templateId, { PRIMEIRO_NOME: firstNameEda, ...templateVars });
        const subject = tpl.subject
          .replace(/\{\{DATA_ENCONTRO\}\}/g, () => templateVars.DATA_ENCONTRO || '')
          .replace(/\{\{HORA_ENCONTRO\}\}/g, () => templateVars.HORA_ENCONTRO || '');
        await resend.emails.send({ from: tpl.from, to: m.email, subject, html });
        sent++;
        await new Promise(r => setTimeout(r, 120));
      } catch (err) {
        failed++;
      }
    }
    return res.status(200).json({ ok: true, sent, failed, skipped, total: targets.length });
  }

  // ── LISTA ESPERA (desistência EDA) ───────────────────────────
  if (action === 'lista-espera-stats') {
    const todayIso = new Date(new Date().setHours(0,0,0,0)).toISOString();
    const weekIso  = new Date(Date.now() - 7*24*60*60*1000).toISOString();
    const [total, today, week] = await Promise.all([
      supabase.from('academyelite_lista_espera').select('*', { count: 'exact', head: true }),
      supabase.from('academyelite_lista_espera').select('*', { count: 'exact', head: true }).gte('created_at', todayIso),
      supabase.from('academyelite_lista_espera').select('*', { count: 'exact', head: true }).gte('created_at', weekIso),
    ]);
    return res.status(200).json({ total: total.count || 0, today: today.count || 0, week: week.count || 0 });
  }

  if (action === 'lista-espera-list') {
    const { data, error } = await supabase
      .from('academyelite_lista_espera')
      .select('id, nome, email, whatsapp, q1, q2, q3, status, created_at')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ lista: data || [] });
  }

  if (action === 'lista-espera-delete') {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID obrigatório' });
    const { error } = await supabase.from('academyelite_lista_espera').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (action === 'lista-espera-update-status') {
    const { id, status } = req.body;
    const valid = ['pendente', 'contatado', 'confirmado', 'descartado'];
    if (!id || !valid.includes(status)) return res.status(400).json({ error: 'Dados inválidos' });
    const { error } = await supabase.from('academyelite_lista_espera').update({ status }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // NARRATIVA — redefinir senha (admin redefine sem enviar email)
  if (action === 'narrativa-reset-password') {
    const { id, password } = body;
    if (!id || !password) return res.status(400).json({ error: 'id e password obrigatórios' });
    const password_hash = hashNarrativaPassword(password);
    const { error } = await supabase.from('narrativa_users').update({ password_hash }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── YT MONITOR — stats de uso da YouTube API ──────────────────────────────
  if (action === 'yt-monitor-stats') {
    const now    = new Date();
    const today  = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    const [logData, cacheData] = await Promise.all([
      supabase.from('yt_api_log').select('key_index, units, cache_hit, created_at').gte('created_at', today),
      supabase.from('yt_cache').select('id, hits, expires_at'),
    ]);

    const logs   = logData.data  ?? [];
    const caches = cacheData.data ?? [];

    const apiCalls   = logs.filter(l => !l.cache_hit);
    const cacheCalls = logs.filter(l =>  l.cache_hit);

    const key1Units = apiCalls.filter(l => l.key_index === 1).reduce((s, l) => s + l.units, 0);
    const key2Units = apiCalls.filter(l => l.key_index === 2).reduce((s, l) => s + l.units, 0);

    const totalCalls  = logs.length;
    const cacheHits   = cacheCalls.length;
    const hitRate     = totalCalls ? Math.round((cacheHits / totalCalls) * 100) : 0;

    const activeCaches = caches.filter(c => new Date(c.expires_at) > now).length;
    const totalHits    = caches.reduce((s, c) => s + (c.hits ?? 0), 0);

    return res.status(200).json({
      key1: { units: key1Units, remaining: Math.max(0, 10000 - key1Units), limit: 10000 },
      key2: { units: key2Units, remaining: Math.max(0, 10000 - key2Units), limit: 10000 },
      today: { totalCalls, apiCalls: apiCalls.length, cacheHits, hitRate },
      cache: { activeEntries: activeCaches, totalServed: totalHits },
    });
  }

  if (action === 'yt-monitor-log') {
    const { data } = await supabase
      .from('yt_api_log')
      .select('id, key_index, action, query, units, cache_hit, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    return res.status(200).json({ log: data ?? [] });
  }

  if (action === 'yt-cache-clear') {
    await supabase.from('yt_cache').delete().lt('expires_at', new Date().toISOString());
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Ação desconhecida' });
};
