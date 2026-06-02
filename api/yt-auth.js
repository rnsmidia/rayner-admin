/**
 * GET /api/yt-auth
 * Inicia o fluxo OAuth do Google para autorizar o bot a postar comentários no YouTube.
 * Uso único — salva o refresh_token automaticamente na Vercel.
 * Protegido pelo ADMIN_TOKEN.
 */
function isValidToken(token) {
  try {
    const decoded  = Buffer.from(token, 'base64').toString('utf8');
    const [login, ...rest] = decoded.split(':');
    const password = rest.join(':');
    const admins = [
      { login: 'rnadmin', password: process.env.ADMIN_PASSWORD  || '' },
      { login: 'mcadmin', password: process.env.ADMIN2_PASSWORD || '' },
      { login: 'jnadmin', password: process.env.ADMIN3_PASSWORD || '' },
    ];
    return admins.some(a => a.login === login && a.password === password && password);
  } catch { return false; }
}

module.exports = async function handler(req, res) {
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
  if (!isValidToken(token)) return res.status(401).json({ error: 'unauthorized' });

  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  'https://raynern.com.br/api/yt-auth-callback',
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/youtube.force-ssl',
    access_type:   'offline',
    prompt:        'consent',
    state:         token,
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};
