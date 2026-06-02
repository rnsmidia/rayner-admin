/**
 * GET /api/yt-auth-callback
 * Recebe o code do Google, troca por tokens, salva refresh_token na Vercel automaticamente.
 */
module.exports = async function handler(req, res) {
  const { code, state: token } = req.query;

  if (!code) {
    return res.status(400).send('<h2 style="font-family:monospace">❌ Código ausente</h2>');
  }

  // 1. Troca code por tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  'https://raynern.com.br/api/yt-auth-callback',
      grant_type:    'authorization_code',
    }),
  });
  const tokens = await tokenRes.json();

  if (!tokens.refresh_token) {
    return res.status(400).send(`
      <html><body style="font-family:monospace;background:#0d0d0d;color:#ff5555;padding:40px">
        <h2>❌ refresh_token não retornado</h2>
        <p>Isso acontece quando o app já foi autorizado antes. Acesse
        <a href="https://myaccount.google.com/permissions" style="color:#a78bfa">myaccount.google.com/permissions</a>,
        revogue o acesso ao app Google e tente novamente.</p>
        <pre>${JSON.stringify(tokens, null, 2)}</pre>
      </body></html>
    `);
  }

  // 2. Salva refresh_token na Vercel automaticamente
  const VERCEL_TOKEN      = process.env.VERCEL_TOKEN;
  const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;
  const VERCEL_TEAM_ID    = process.env.VERCEL_TEAM_ID;

  let vercelSaved = false;
  try {
    // Tenta deletar env var antiga primeiro (ignora erro se não existir)
    const listRes = await fetch(
      `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env?teamId=${VERCEL_TEAM_ID}`,
      { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
    );
    const listData = await listRes.json();
    const existing = (listData.envs || []).find(e => e.key === 'YOUTUBE_COMMENT_BOT_REFRESH_TOKEN');
    if (existing) {
      await fetch(
        `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env/${existing.id}?teamId=${VERCEL_TEAM_ID}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
      );
    }

    // Cria nova env var
    const createRes = await fetch(
      `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env?teamId=${VERCEL_TEAM_ID}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key:    'YOUTUBE_COMMENT_BOT_REFRESH_TOKEN',
          value:  tokens.refresh_token,
          type:   'encrypted',
          target: ['production', 'preview'],
        }),
      }
    );
    vercelSaved = createRes.ok;

    // Dispara redeploy
    if (vercelSaved) {
      await fetch(
        `https://api.vercel.com/v13/deployments?teamId=${VERCEL_TEAM_ID}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'rayner-admin', gitSource: { type: 'github', repoId: 'rayner-admin', ref: 'main' } }),
        }
      );
    }
  } catch (err) {
    console.error('Erro ao salvar na Vercel:', err.message);
  }

  res.send(`
    <html><body style="font-family:monospace;background:#0d0d0d;color:#e2e2e2;padding:40px;max-width:700px;margin:0 auto">
      <h2 style="color:#00ff88">✅ YouTube autorizado com sucesso!</h2>
      ${vercelSaved
        ? `<p style="color:#a78bfa">🔑 refresh_token salvo automaticamente na Vercel. Aguarde o redeploy (~1 min) e o bot estará pronto.</p>`
        : `<p style="color:#ff5555">⚠️ Não foi possível salvar na Vercel automaticamente. Adicione manualmente:</p>
           <p><strong>Nome:</strong> YOUTUBE_COMMENT_BOT_REFRESH_TOKEN</p>
           <textarea style="width:100%;height:80px;background:#111;color:#0f0;border:1px solid #333;padding:10px;font-size:12px;margin-top:8px">${tokens.refresh_token}</textarea>`
      }
      <br/><br/>
      <a href="/admin" style="background:#7c3aed;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none">← Voltar ao Admin</a>
    </body></html>
  `);
};
