// api/reset-device.js
// Limpa o device_id de uma licença, permitindo ativação num novo dispositivo.
// Valida APENAS a chave — quem tem a chave pode transferir.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido' });

  const { key } = req.body || {};

  if (!key) {
    return res.status(400).json({ ok: false, error: 'Chave não informada.' });
  }

  const normalizedKey = key.trim().toUpperCase();

  // Busca a licença pelo key
  const { data: license, error } = await supabase
    .from('licenses')
    .select('id, active, device_id')
    .eq('key', normalizedKey)
    .single();

  if (error || !license) {
    return res.status(404).json({ ok: false, error: 'Chave inválida.' });
  }

  if (!license.active) {
    return res.status(403).json({ ok: false, error: 'Licença inativa.' });
  }

  // Limpa o device_id — seta null para permitir ativação em qualquer novo dispositivo
  const { error: updateError } = await supabase
    .from('licenses')
    .update({ device_id: null })
    .eq('id', license.id);

  if (updateError) {
    console.error('[reset-device] Erro ao atualizar:', updateError);
    return res.status(500).json({ ok: false, error: 'Erro interno ao resetar dispositivo.' });
  }

  console.log(`[reset-device] device_id limpo para chave: ${normalizedKey}`);
  return res.status(200).json({ ok: true, message: 'Dispositivo desvinculado com sucesso.' });
}
