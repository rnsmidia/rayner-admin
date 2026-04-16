// api/verify.js — DarkFlow v2.0
// Verifica licença + registra deviceId para rastrear uso por dispositivo

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ valid: false, error: 'Method not allowed' });

  const { key, deviceId } = req.body || {};
  if (!key || typeof key !== 'string' || key.trim().length < 8)
    return res.status(400).json({ valid: false, error: 'Chave inválida' });

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/licenses?key=eq.${encodeURIComponent(key.trim())}&select=id,key,active,email,note,device_id`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' } }
    );
    const data = await response.json();

    if (!data || data.length === 0)
      return res.status(200).json({ valid: false, error: 'Chave não encontrada' });

    const license = data[0];

    if (!license.active)
      return res.status(200).json({ valid: false, error: 'Licença desativada. Entre em contato com o suporte.' });

    // Se já tem um device registrado e é diferente, bloqueia
    if (license.device_id && deviceId && license.device_id !== deviceId) {
      return res.status(200).json({
        valid: false,
        error: 'Licença ativa em outro dispositivo. Contate o suporte para transferir.'
      });
    }

    // Atualiza used_at e salva deviceId na primeira ativação
    await fetch(
      `${SUPABASE_URL}/rest/v1/licenses?id=eq.${license.id}`,
      {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ used_at: new Date().toISOString(), device_id: license.device_id || deviceId || null })
      }
    );

    return res.status(200).json({ valid: true, email: license.email || '', note: license.note || '' });

  } catch (err) {
    console.error('License verify error:', err);
    return res.status(500).json({ valid: false, error: 'Erro interno' });
  }
}
