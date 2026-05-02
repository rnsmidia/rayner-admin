// api/admin.js
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { pbkdf2Sync, randomBytes } = require('crypto');

function hashNarrativaPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
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
              <a href="https://raynern.com.br/narrativa-ia" class="btn">✨ Acessar Narrativa IA</a>
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

  return res.status(400).json({ error: 'Ação desconhecida' });
};
