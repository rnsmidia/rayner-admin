// api/reset-device.js — CenaDrop v3.0
// Desvincula o device_id de uma licença, permitindo reativação em novo dispositivo
// Segurança: só reseta se a chave + deviceId corresponderem ao registro atual

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { key, deviceId } = req.body || {};

  if (!key || typeof key !== 'string' || key.trim().length < 8)
    return res.status(400).json({ ok: false, error: 'Chave inválida' });

  if (!deviceId)
    return res.status(400).json({ ok: false, error: 'Device ID ausente' });

  try {
    // Busca a licença pela chave
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/licenses?key=eq.${encodeURIComponent(key.trim())}&select=id,active,status,device_id`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await response.json();

    if (!data || data.length === 0)
      return res.status(200).json({ ok: false, error: 'Chave não encontrada' });

    const license = data[0];

    if (!license.active || license.status === 'inactive')
      return res.status(200).json({ ok: false, error: 'Licença desativada' });

    // Segurança: só permite reset se o deviceId bater com o registrado
    // (impede que alguém tente resetar a licença de outra pessoa)
    if (license.device_id && license.device_id !== deviceId)
      return res.status(200).json({ ok: false, error: 'Este dispositivo não está vinculado a essa licença' });

    // Limpa o device_id — licença volta a aceitar qualquer novo dispositivo
    await fetch(
      `${SUPABASE_URL}/rest/v1/licenses?id=eq.${license.id}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ device_id: null })
      }
    );

    console.log(`[reset-device] Licença ${key.trim()} desvinculada do device ${deviceId.substring(0, 8)}...`);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[reset-device] Erro:', err);
    return res.status(500).json({ ok: false, error: 'Erro interno do servidor' });
  }
}
