/**
 * POST /api/discord-invite
 * Recebe webhook do Hotmart → cria convite único no Discord → envia por e-mail.
 * Também processa cancelamentos → remove cargo Membro Elite do Discord.
 *
 * Configurar no Hotmart: Webhooks → URL: https://raynern.com.br/api/discord-invite
 * Eventos: PURCHASE_APPROVED, PURCHASE_CANCELED, PURCHASE_REFUNDED, PURCHASE_CHARGEBACK
 */

const { createClient } = require('@supabase/supabase-js');
const { Resend }       = require('resend');

const WELCOME_CHANNEL = '1508898202294816778';
const GUILD_ID        = '1508895864540626986';
const ROLE_ID         = '1508900115459477535';

const REVOKE_STATUSES = new Set(['CANCELED', 'REFUNDED', 'CHARGEBACK']);
const REVOKE_EVENTS   = new Set([
  'PURCHASE_CANCELED', 'PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK',
  'SUBSCRIPTION_CANCELLATION',
]);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body   = req.body;
  const hottok = req.headers['x-hotmart-hottok'] || body.hottok;

  if (hottok !== process.env.HOTMART_HOTTOK_ACADEMY) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const event  = body?.event || '';
  const status = body?.data?.purchase?.status || '';
  const email  = body?.data?.buyer?.email?.toLowerCase();
  const name   = body?.data?.buyer?.name || '';
  const order  = body?.data?.purchase?.order_id || body?.data?.purchase?.transaction || '';

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── REVOGAÇÃO ────────────────────────────────────────────────────────────────
  if (REVOKE_EVENTS.has(event) || REVOKE_STATUSES.has(status)) {
    console.log(`🚫 Revogação EDA: ${email} — evento ${event || status}`);
    try {
      // Busca discord_user_id pelo email
      const { data: invite } = await supabase
        .from('discord_invites')
        .select('discord_user_id, invite_code')
        .eq('email', email)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (invite?.discord_user_id) {
        const discordId = invite.discord_user_id;
        // Remove o cargo Membro Elite via API do Discord
        await fetch(
          `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${discordId}/roles/${ROLE_ID}`,
          {
            method: 'DELETE',
            headers: { 'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}` },
          }
        );
        console.log(`✅ Cargo removido: Discord ID ${discordId} (${email})`);
      } else {
        console.log(`⚠️ discord_user_id não encontrado para ${email} — remoção manual necessária`);
      }

      // Marca convite como revogado no Supabase
      await supabase
        .from('discord_invites')
        .update({ revoked: true, revoked_reason: event || status })
        .eq('email', email);

      return res.status(200).json({ ok: true, revoked: true });
    } catch (err) {
      console.error('❌ Erro na revogação EDA:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── APROVAÇÃO ────────────────────────────────────────────────────────────────
  if (status !== 'APPROVED') {
    return res.status(200).json({ ok: true, skipped: event || status });
  }

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
        body: JSON.stringify({ max_uses: 1, max_age: 604800, unique: true }),
      }
    );

    const invite = await inviteRes.json();
    if (!invite.code) throw new Error('Discord não retornou código de convite');
    const inviteUrl = `https://discord.gg/${invite.code}`;

    // Salva no Supabase
    await supabase.from('discord_invites').insert({
      email,
      name,
      invite_code:   invite.code,
      hotmart_order: order,
      used:          false,
      revoked:       false,
    });

    // Envia e-mail com o convite
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Elite Dark Academy <noreply@raynern.com.br>',
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

    console.log(`✅ Convite EDA enviado para ${email} — ordem ${order}`);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('❌ Erro ao processar convite Discord:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
