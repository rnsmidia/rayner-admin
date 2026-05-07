// api/admin.js
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { pbkdf2Sync, randomBytes } = require('crypto');

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

  // LIST — apenas licenças CenaDrop (exclui nxsaude)
  if (action === 'list' || (req.method === 'GET' && !action)) {
    const { data, error } = await supabase.from('licenses').select('*')
      .or('product.is.null,product.neq.nxsaude')
      .order('created_at', { ascending: false });
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
    const { data } = await supabase.from('licenses').select('status, source')
      .or('product.is.null,product.neq.nxsaude');
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
        html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
          body{margin:0;padding:0;background:#0a0a0a;font-family:'Segoe UI',Arial,sans-serif;}
          .w{max-width:560px;margin:0 auto;padding:40px 20px;}
          .c{background:#111;border:1px solid #222;border-radius:16px;overflow:hidden;}
          .h{background:linear-gradient(135deg,#1a1a2e,#0f0f1a);padding:40px 32px;text-align:center;border-bottom:1px solid #222;}
          .logo{font-size:28px;font-weight:800;color:#fff;}.logo span{color:#6c63ff;}
          .b{padding:36px 32px;}.g{font-size:22px;color:#fff;font-weight:700;margin-bottom:12px;}
          .t{color:#888;font-size:15px;line-height:1.7;margin-bottom:24px;}
          .kb{background:#0d0d0d;border:2px solid #6c63ff;border-radius:12px;padding:24px;text-align:center;margin:28px 0;}
          .kl{color:#555;font-size:12px;text-transform:uppercase;letter-spacing:2px;margin-bottom:10px;}
          .kv{font-size:26px;font-weight:800;color:#6c63ff;letter-spacing:3px;font-family:'Courier New',monospace;}
          .f{padding:24px 32px;border-top:1px solid #1a1a1a;text-align:center;}
          .f p{color:#444;font-size:12px;margin:4px 0;}
        </style></head><body><div class="w"><div class="c">
          <div class="h"><div class="logo">Cena<span>Drop</span></div></div>
          <div class="b">
            <div class="g">Olá, ${firstName}! 👋</div>
            <p class="t">Aqui está sua chave de acesso ao <strong style="color:#ccc">CenaDrop Flow</strong>:</p>
            <div class="kb">
              <div class="kl">Chave de Acesso</div>
              <div class="kv">${lic.key}</div>
            </div>
            <div style="text-align:center;margin:24px 0;">
              <a href="https://raynern.com.br/cenadrop/download" style="display:inline-block;background:linear-gradient(135deg,#6c63ff,#9f7aea);color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:14px 32px;border-radius:12px;">⬇ Baixar CenaDrop Flow</a>
            </div>
            <p class="t" style="font-size:13px;color:#555;">
              Baixe a extensão, instale no Chrome, clique em "Ativar Licença" e cole sua chave.<br><br>
              Problemas? Responda este email que te ajudamos.
            </p>
          </div>
          <div class="f"><p>© ${new Date().getFullYear()} CenaDrop — cenadrop.com.br</p></div>
        </div></div></body></html>`,
      });
      return res.status(200).json({ ok: true, message: `Email reenviado para ${lic.email}` });
    } catch (err) {
      return res.status(500).json({ error: 'Erro ao enviar email: ' + err.message });
    }
  }

  // ── NARRATIVA IA — USERS ──────────────────────────────────────
  if (action === 'narrativa-list') {
    const { data, error } = await supabase.from('narrativa_users').select('id,email,name,active,created_at').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ users: data });
  }

  if (action === 'narrativa-create') {
    const { email, name, password } = body;
    if (!email || !name || !password) return res.status(400).json({ error: 'Email, nome e senha obrigatórios' });
    const password_hash = hashNarrativaPassword(password);
    const { data, error } = await supabase.from('narrativa_users').insert({ email: email.toLowerCase(), name, password_hash, active: true }).select('id,email,name,active,created_at').single();
    if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.message });
    // Email de boas-vindas
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const firstName = name.split(' ')[0];
      await resend.emails.send({
        from: 'Narrativa IA <contato@cenadrop.com.br>',
        to: email.toLowerCase(),
        subject: '✨ Seu acesso ao Narrativa IA Studio',
        html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
          body{margin:0;padding:0;background:#09090f;font-family:'Segoe UI',Arial,sans-serif;}
          .w{max-width:560px;margin:0 auto;padding:40px 20px;}
          .c{background:#0d0d1e;border:1px solid rgba(124,92,248,.25);border-radius:16px;overflow:hidden;}
          .h{background:linear-gradient(135deg,#1a0a3e,#0a0a1e);padding:40px 32px;text-align:center;border-bottom:1px solid rgba(124,92,248,.15);}
          .logo{font-size:26px;font-weight:800;color:#fff;letter-spacing:2px;}.logo span{background:linear-gradient(135deg,#9b7fff,#4169ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
          .b{padding:36px 32px;}
          .g{font-size:22px;color:#eeeef8;font-weight:700;margin-bottom:12px;}
          .t{color:#8888aa;font-size:15px;line-height:1.7;margin-bottom:24px;}
          .kb{background:#0a0a16;border:1px solid rgba(124,92,248,.3);border-radius:12px;padding:24px;margin:28px 0;}
          .krow{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);}
          .krow:last-child{border-bottom:none;}
          .kl{color:#55557a;font-size:12px;text-transform:uppercase;letter-spacing:1px;}
          .kv{color:#9b7fff;font-size:14px;font-weight:700;font-family:monospace;}
          .btn{display:inline-block;background:linear-gradient(135deg,#6234e2,#4169ff);color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:14px 32px;border-radius:12px;}
          .f{padding:24px 32px;border-top:1px solid rgba(255,255,255,.05);text-align:center;}
          .f p{color:#33334a;font-size:12px;margin:4px 0;}
        </style></head><body><div class="w"><div class="c">
          <div class="h"><div class="logo">NARRATIVA <span>IA</span></div></div>
          <div class="b">
            <div class="g">Olá, ${firstName}! 👋</div>
            <p class="t">Seu acesso ao <strong style="color:#ccc">Narrativa IA Studio</strong> foi criado. Use as credenciais abaixo para entrar:</p>
            <div class="kb">
              <div class="krow"><span class="kl">Email</span><span class="kv">${email.toLowerCase()}</span></div>
              <div class="krow"><span class="kl">Senha</span><span class="kv">${password}</span></div>
            </div>
            <div style="text-align:center;margin:24px 0;">
              <a href="https://narrativaia.com.br" class="btn">✨ Acessar Narrativa IA</a>
            </div>
            <p class="t" style="font-size:13px;color:#55557a;">Guarde essas credenciais em lugar seguro. Em caso de dúvidas, responda este email.</p>
          </div>
          <div class="f"><p>© ${new Date().getFullYear()} Narrativa IA Studio</p></div>
        </div></div></body></html>`,
      });
    } catch (e) { console.error('Email error:', e); }
    return res.status(200).json({ ok: true, user: data });
  }

  if (action === 'narrativa-update') {
    const { id, name, email, password } = body;
    if (!id) return res.status(400).json({ error: 'ID obrigatório' });
    const updates = {};
    if (name)  updates.name  = name;
    if (email) updates.email = email.toLowerCase();
    if (password) updates.password_hash = hashNarrativaPassword(password);
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
        html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
          body{margin:0;padding:0;background:#09090f;font-family:'Segoe UI',Arial,sans-serif;}
          .w{max-width:560px;margin:0 auto;padding:40px 20px;}
          .c{background:#0d0d1e;border:1px solid rgba(124,92,248,.25);border-radius:16px;overflow:hidden;}
          .h{background:linear-gradient(135deg,#1a0a3e,#0a0a1e);padding:40px 32px;text-align:center;border-bottom:1px solid rgba(124,92,248,.15);}
          .logo{font-size:26px;font-weight:800;color:#fff;letter-spacing:2px;}.logo span{background:linear-gradient(135deg,#9b7fff,#4169ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
          .b{padding:36px 32px;}
          .g{font-size:22px;color:#eeeef8;font-weight:700;margin-bottom:12px;}
          .t{color:#8888aa;font-size:15px;line-height:1.7;margin-bottom:24px;}
          .kb{background:#0a0a16;border:1px solid rgba(124,92,248,.3);border-radius:12px;padding:24px;margin:28px 0;}
          .krow{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);}
          .krow:last-child{border-bottom:none;}
          .kl{color:#55557a;font-size:12px;text-transform:uppercase;letter-spacing:1px;}
          .kv{color:#9b7fff;font-size:14px;font-weight:700;font-family:monospace;}
          .btn{display:inline-block;background:linear-gradient(135deg,#6234e2,#4169ff);color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:14px 32px;border-radius:12px;}
          .f{padding:24px 32px;border-top:1px solid rgba(255,255,255,.05);text-align:center;}
          .f p{color:#33334a;font-size:12px;margin:4px 0;}
        </style></head><body><div class="w"><div class="c">
          <div class="h"><div class="logo">NARRATIVA <span>IA</span></div></div>
          <div class="b">
            <div class="g">Olá, ${firstName}! 🔑</div>
            <p class="t">Sua senha foi redefinida. Use as credenciais abaixo para acessar o <strong style="color:#ccc">Narrativa IA Studio</strong>:</p>
            <div class="kb">
              <div class="krow"><span class="kl">Email</span><span class="kv">${user.email}</span></div>
              <div class="krow"><span class="kl">Nova Senha</span><span class="kv">${newPassword}</span></div>
            </div>
            <div style="text-align:center;margin:24px 0;">
              <a href="https://narrativaia.com.br" class="btn">✨ Acessar Narrativa IA</a>
            </div>
            <p class="t" style="font-size:13px;color:#55557a;">Recomendamos alterar sua senha após o acesso. Em caso de dúvidas, responda este email.</p>
          </div>
          <div class="f"><p>© ${new Date().getFullYear()} Narrativa IA Studio</p></div>
        </div></div></body></html>`,
      });
    } catch (e) { console.error('Email error:', e); }
    return res.status(200).json({ ok: true });
  }

  if (action === 'narrativa-toggle') {
    const { id } = body;
    const { data: cur } = await supabase.from('narrativa_users').select('active').eq('id', id).single();
    const active = !cur?.active;
    await supabase.from('narrativa_users').update({ active }).eq('id', id);
    return res.status(200).json({ ok: true, active });
  }

  if (action === 'narrativa-delete') {
    await supabase.from('narrativa_users').delete().eq('id', body.id);
    return res.status(200).json({ ok: true });
  }

  if (action === 'narrativa-stats') {
    const { data } = await supabase.from('narrativa_users').select('active');
    const total    = (data||[]).length;
    const active   = (data||[]).filter(u => u.active).length;
    const inactive = total - active;
    return res.status(200).json({ total, active, inactive });
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

  // MONITOR — uso dos serviços de infraestrutura
  if (action === 'monitor') {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const now        = Date.now();

    const [r1, r2, r3, vercelRes, ghStorageRes, ghRunsRes] = await Promise.all([
      // Supabase row counts
      supabase.from('licenses').select('*', { count: 'exact', head: true }).or('product.is.null,product.neq.nxsaude'),
      supabase.from('licenses').select('*', { count: 'exact', head: true }).eq('product', 'nxsaude'),
      supabase.from('narrativa_users').select('*', { count: 'exact', head: true }),
      // Vercel deployments this month
      fetch(`https://api.vercel.com/v6/deployments?teamId=${process.env.VERCEL_TEAM_ID}&limit=100&since=${monthStart}&until=${now}`, {
        headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` }
      }).then(r => r.json()).catch(() => ({})),
      // GitHub repo sizes
      fetch('https://api.github.com/user/repos?per_page=100&affiliation=owner', {
        headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
      }).then(r => r.json()).catch(() => []),
      // GitHub Actions runs this month
      fetch(`https://api.github.com/repos/rnsmidia/rayner-admin/actions/runs?created=>=2026-05-01&per_page=1`, {
        headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
      }).then(r => r.json()).catch(() => ({})),
    ]);

    const cdRows  = r1.count || 0;
    const nxRows  = r2.count || 0;
    const nuRows  = r3.count || 0;
    const totalRows   = cdRows + nxRows + nuRows;
    const estimatedMB = parseFloat((totalRows * 0.002).toFixed(4));

    // Vercel: count deployments
    const deployments  = (vercelRes.deployments || []).length;
    const paginationNext = vercelRes.pagination?.next;

    // GitHub: total repo storage in MB
    const repos = Array.isArray(ghStorageRes) ? ghStorageRes : [];
    const repoNames = ['rayner-admin', 'narrativa-ia', 'nxsaude-jejum'];
    const trackedRepos = repos.filter(r => repoNames.includes(r.name));
    const totalRepoKB  = trackedRepos.reduce((sum, r) => sum + (r.size || 0), 0);
    const repoSizesMB  = trackedRepos.map(r => ({ name: r.name, sizeMB: parseFloat((r.size / 1024).toFixed(1)) }));

    // GitHub Actions runs (no workflows configured, so 0)
    const actionsRuns = ghRunsRes.total_count || 0;

    return res.status(200).json({
      supabase: {
        tables: { cenadrop: cdRows, nxsaude: nxRows, narrativa: nuRows },
        totalRows, estimatedMB,
        limits: { storageMB: 500, bandwidthGB: 5, mau: 50000 }
      },
      vercel: {
        deployments, deploymentsLimit: 6000,
        note: 'bandwidth não exposto na API do plano Hobby'
      },
      github: {
        actionsMinutes: actionsRuns, actionsLimit: 2000,
        repoStorageMB: parseFloat((totalRepoKB / 1024).toFixed(1)),
        repoStorageLimit: 500,
        repos: repoSizesMB
      }
    });
  }

  return res.status(400).json({ error: 'Ação desconhecida' });
};
