/**
 * POST /api/discord-invite
 * Recebe webhook do Hotmart → cria convite único no Discord → envia por e-mail.
 * Configurar no Hotmart: Webhooks → URL: https://raynern.com.br/api/discord-invite
 */

const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

const WELCOME_CHANNEL = '1508898202294816778';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body;

  // Hotmart envia hottok para validar origem
  const hottok = req.headers['x-hotmart-hottok'] || body.hottok;
  if (hottok !== process.env.HOTMART_HOTTOK_ACADEMY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Só processa compra aprovada
  const status = body?.data?.purchase?.status;
  if (status !== 'APPROVED') {
    return res.status(200).json({ ok: true, skipped: status });
  }

  const email = body.data.buyer.email;
  const name  = body.data.buyer.name;
  const order = body.data.purchase.order_id || body.data.purchase.transaction;

  try {
    // Cria convite de uso único (válido por 7 dias)
    const inviteRes = await fetch(
      `https://discord.com/api/v10/channels/${WELCOME_CHANNEL}/invites`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          max_uses: 1,
          max_age:  604800, // 7 dias em segundos
          unique:   true,
        }),
      }
    );

    const invite = await inviteRes.json();
    if (!invite.code) throw new Error('Discord não retornou código de convite');
    const inviteUrl = `https://discord.gg/${invite.code}`;

    // Salva no Supabase
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    await supabase.from('discord_invites').insert({
      email,
      name,
      invite_code:   invite.code,
      hotmart_order: order,
      used:          false,
    });

    // Envia e-mail com o convite
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '465'),
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Elite Dark Academy" <${process.env.SMTP_USER}>`,
      to:   email,
      subject: '👑 Seu acesso ao Elite Dark Academy está pronto',
      html: `
        <div style="background:#000;color:#fff;font-family:sans-serif;padding:40px;max-width:560px;margin:0 auto;">
          <img src="https://raynern.com.br/academyelite/images/logo-selo.png" height="80" style="margin-bottom:32px;">
          <h1 style="color:#D4AF37;font-size:24px;margin-bottom:16px;">Bem-vindo ao círculo, ${name.split(' ')[0]}.</h1>
          <p style="color:rgba(255,255,255,0.8);line-height:1.7;margin-bottom:32px;">
            Sua compra foi confirmada. Clique no botão abaixo para entrar no servidor exclusivo do <strong>Elite Dark Academy</strong> no Discord.
          </p>
          <a href="${inviteUrl}"
             style="display:inline-block;background:#C9A227;color:#000;font-weight:700;text-decoration:none;padding:16px 36px;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;">
            ENTRAR NO DISCORD →
          </a>
          <p style="color:rgba(255,255,255,0.4);font-size:12px;margin-top:32px;">
            Este convite é pessoal e de uso único. Válido por 7 dias.<br>
            Não compartilhe com outras pessoas.
          </p>
        </div>
      `,
    });

    console.log(`✅ Convite enviado para ${email} — ordem ${order}`);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('❌ Erro ao processar convite Discord:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
