// api/email-test.js — disparo de teste pontual (remover após uso)
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = 'CenaDrop <contato@cenadrop.com.br>';

const HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>CenaDrop v7.6 — Aulão Hoje às 20h</title>
<style>
  body, table, td { margin: 0; padding: 0; border: 0; }
  body { background-color: #04040c; font-family: Arial, sans-serif; }
  img  { border: 0; display: block; }
  a    { text-decoration: none; }
</style>
</head>
<body style="background-color:#04040c; margin:0; padding:0;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#04040c;">
<tr><td align="center" style="padding: 32px 16px;">

  <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:#08081a; border-radius:20px; overflow:hidden; box-shadow:0 0 0 1px rgba(124,111,255,0.2), 0 40px 80px rgba(0,0,0,0.6);">

    <tr>
      <td style="background: linear-gradient(160deg, #0d0d28 0%, #08081a 60%, #070714 100%); padding: 40px 40px 0; text-align:center; position:relative;">
        <div style="height:3px; background:linear-gradient(90deg, transparent, #7c6fff, #c084fc, #7c6fff, transparent); border-radius:2px; margin-bottom:32px;"></div>
        <div style="display:inline-block; background:rgba(248,113,113,0.1); border:1px solid rgba(248,113,113,0.35); border-radius:20px; padding:6px 18px; margin-bottom:20px;">
          <span style="color:#f87171; font-size:11px; font-weight:700; letter-spacing:3px; text-transform:uppercase;">&#9679; AO VIVO &#8212; HOJE</span>
        </div>
        <div style="margin-bottom:16px;">
          <span style="font-size:32px; font-weight:800; color:#ffffff; letter-spacing:-0.5px; font-family:Arial,sans-serif;">CENA</span><span style="font-size:32px; font-weight:800; color:#7c6fff; letter-spacing:-0.5px; font-family:Arial,sans-serif;">DROP</span>
        </div>
        <div style="font-size:11px; color:#7070a0; letter-spacing:3px; text-transform:uppercase; margin-bottom:32px; font-family:Arial,sans-serif;">Crie Mais. Clique Menos.</div>
        <div style="height:1px; background:linear-gradient(90deg, transparent, rgba(124,111,255,0.3), transparent); margin-bottom:0;"></div>
      </td>
    </tr>

    <tr>
      <td style="background:linear-gradient(180deg, #0a0a22 0%, #08081a 100%); padding: 48px 40px 40px; text-align:center;">
        <p style="font-size:13px; color:#00d4aa; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin:0 0 12px; font-family:Arial,sans-serif;">AUL&#195;O GRATUITO</p>
        <h1 style="font-size:36px; font-weight:800; color:#ffffff; line-height:1.15; margin:0 0 10px; font-family:Arial,sans-serif; letter-spacing:-0.5px;">
          Seu personagem IA<br>muda de rosto<br>
          <span style="color:#7c6fff;">em cada cena?</span>
        </h1>
        <p style="font-size:17px; color:#c0c0d8; line-height:1.7; margin:16px 0 32px; font-family:Arial,sans-serif;">
          A fun&#231;&#227;o que o Google liberou e quase ningu&#233;m est&#225; usando direito. Vamos mostrar na pr&#225;tica &#8212; <strong style="color:#ffffff;">com ou sem CenaDrop.</strong>
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center">
              <div style="display:inline-block; background:rgba(0,0,0,0.4); border:1px solid rgba(124,111,255,0.35); border-radius:16px; padding:24px 40px;">
                <div style="font-size:13px; color:#7070a0; text-transform:uppercase; letter-spacing:2px; margin-bottom:8px; font-family:Arial,sans-serif;">&#128197; 25 de maio de 2026</div>
                <div style="font-size:52px; font-weight:800; color:#ffffff; line-height:1; font-family:Arial,sans-serif;">
                  HOJE <span style="color:#7c6fff;">20H</span>
                </div>
                <div style="font-size:13px; color:#7070a0; margin-top:10px; font-family:Arial,sans-serif;">&#128279; Link nos grupos</div>
              </div>
            </td>
          </tr>
        </table>
        <div style="margin-top:28px;">
          <a href="#LINK_DO_ZOOM" style="display:inline-block; background:linear-gradient(135deg, #7c6fff 0%, #c084fc 100%); color:#ffffff; font-size:16px; font-weight:800; padding:16px 40px; border-radius:12px; letter-spacing:0.3px; font-family:Arial,sans-serif; box-shadow:0 4px 24px rgba(124,111,255,0.4);">
            &#128276; Entrar na Aula &#8212; Link no Grupo
          </a>
        </div>
        <p style="font-size:12px; color:#4a4a6a; margin:12px 0 0; font-family:Arial,sans-serif;">O link est&#225; fixado no grupo do WhatsApp / Telegram</p>
      </td>
    </tr>

    <tr><td style="padding: 0 40px;"><div style="height:1px; background:linear-gradient(90deg, transparent, rgba(124,111,255,0.25), transparent);"></div></td></tr>

    <tr>
      <td style="padding: 40px 40px 32px;">
        <p style="font-size:11px; color:#7070a0; text-transform:uppercase; letter-spacing:2.5px; margin:0 0 8px; font-family:Arial,sans-serif;">NA AULA DE HOJE</p>
        <h2 style="font-size:22px; font-weight:800; color:#ffffff; margin:0 0 24px; font-family:Arial,sans-serif;">O que voc&#234; vai aprender</h2>

        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
          <tr>
            <td width="48" valign="top"><div style="width:40px; height:40px; background:rgba(0,212,170,0.1); border:1px solid rgba(0,212,170,0.3); border-radius:10px; text-align:center; line-height:40px; font-size:18px;">&#127917;</div></td>
            <td style="padding-left:14px;" valign="top">
              <p style="font-size:15px; font-weight:700; color:#ffffff; margin:0 0 4px; font-family:Arial,sans-serif;">Criar personagem consistente do zero no Google Flow</p>
              <p style="font-size:13px; color:#7070a0; margin:0; line-height:1.6; font-family:Arial,sans-serif;">O mesmo rosto, roupa e estilo em todas as cenas. Funciona pra qualquer criador &#8212; n&#227;o precisa do CenaDrop.</p>
            </td>
          </tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
          <tr>
            <td width="48" valign="top"><div style="width:40px; height:40px; background:rgba(124,111,255,0.1); border:1px solid rgba(124,111,255,0.3); border-radius:10px; text-align:center; line-height:40px; font-size:18px;">&#127897;</div></td>
            <td style="padding-left:14px;" valign="top">
              <p style="font-size:15px; font-weight:700; color:#ffffff; margin:0 0 4px; font-family:Arial,sans-serif;">Configurar a voz do personagem com IA</p>
              <p style="font-size:13px; color:#7070a0; margin:0; line-height:1.6; font-family:Arial,sans-serif;">Narra&#231;&#227;o embutida diretamente no v&#237;deo &#8212; sem edi&#231;&#227;o, sem separar &#225;udio. O Flow gera com voz integrada.</p>
            </td>
          </tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
          <tr>
            <td width="48" valign="top"><div style="width:40px; height:40px; background:rgba(74,222,128,0.1); border:1px solid rgba(74,222,128,0.3); border-radius:10px; text-align:center; line-height:40px; font-size:18px;">&#9889;</div></td>
            <td style="padding-left:14px;" valign="top">
              <p style="font-size:15px; font-weight:700; color:#ffffff; margin:0 0 4px; font-family:Arial,sans-serif;">Automatizar 80 cenas em lote com o CenaDrop v7.6</p>
              <p style="font-size:13px; color:#7070a0; margin:0; line-height:1.6; font-family:Arial,sans-serif;">O que levaria horas, o CenaDrop faz enquanto voc&#234; toma caf&#233;. Ao vivo, sem cortes.</p>
            </td>
          </tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="48" valign="top"><div style="width:40px; height:40px; background:rgba(251,191,36,0.1); border:1px solid rgba(251,191,36,0.3); border-radius:10px; text-align:center; line-height:40px; font-size:18px;">&#128737;</div></td>
            <td style="padding-left:14px;" valign="top">
              <p style="font-size:15px; font-weight:700; color:#ffffff; margin:0 0 4px; font-family:Arial,sans-serif;">O que fazer quando o Google bloqueia sua cena</p>
              <p style="font-size:13px; color:#7070a0; margin:0; line-height:1.6; font-family:Arial,sans-serif;">Pol&#237;tica de conte&#250;do derrubou cenas? Vamos mostrar como corrigir e reenviar automaticamente &#8212; sem perder trabalho.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr><td style="padding: 0 40px;"><div style="height:1px; background:linear-gradient(90deg, transparent, rgba(124,111,255,0.25), transparent);"></div></td></tr>

    <tr>
      <td style="padding: 40px 40px 32px;">
        <p style="font-size:11px; color:#7070a0; text-transform:uppercase; letter-spacing:2.5px; margin:0 0 8px; font-family:Arial,sans-serif;">ATUALIZA&#199;&#195;O</p>
        <h2 style="font-size:22px; font-weight:800; color:#ffffff; margin:0 0 6px; font-family:Arial,sans-serif;">O que mudou do <span style="color:#7070a0; text-decoration:line-through;">v7.4</span> para o <span style="color:#7c6fff;">v7.6</span></h2>
        <p style="font-size:13px; color:#7070a0; margin:0 0 24px; font-family:Arial,sans-serif;">Se voc&#234; ainda est&#225; na vers&#227;o antiga, est&#225; perdendo muito.</p>

        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="48%" valign="top" style="padding-right:8px; padding-bottom:12px;">
              <div style="background:#0d0d22; border:1px solid rgba(124,111,255,0.2); border-radius:14px; padding:18px;">
                <div style="font-size:22px; margin-bottom:10px;">&#127917;</div>
                <p style="font-size:14px; font-weight:700; color:#ffffff; margin:0 0 6px; font-family:Arial,sans-serif;">Personagem consistente</p>
                <p style="font-size:12px; color:#7070a0; margin:0; line-height:1.6; font-family:Arial,sans-serif;">Um clique captura o personagem do Flow e aplica em todas as cenas do lote automaticamente.</p>
              </div>
            </td>
            <td width="48%" valign="top" style="padding-left:8px; padding-bottom:12px;">
              <div style="background:#0d0d22; border:1px solid rgba(74,222,128,0.2); border-radius:14px; padding:18px;">
                <div style="font-size:22px; margin-bottom:10px;">&#127820;</div>
                <p style="font-size:14px; font-weight:700; color:#ffffff; margin:0 0 6px; font-family:Arial,sans-serif;">CenaBanana</p>
                <p style="font-size:12px; color:#7070a0; margin:0; line-height:1.6; font-family:Arial,sans-serif;">Nova aba dedicada para gera&#231;&#227;o em lote de imagens &#8212; mesmo fluxo, outro motor.</p>
              </div>
            </td>
          </tr>
          <tr>
            <td width="48%" valign="top" style="padding-right:8px; padding-bottom:12px;">
              <div style="background:#0d0d22; border:1px solid rgba(248,113,113,0.2); border-radius:14px; padding:18px;">
                <div style="font-size:22px; margin-bottom:10px;">&#9888;</div>
                <p style="font-size:14px; font-weight:700; color:#ffffff; margin:0 0 6px; font-family:Arial,sans-serif;">Modal de conclus&#227;o</p>
                <p style="font-size:12px; color:#7070a0; margin:0; line-height:1.6; font-family:Arial,sans-serif;">Ao terminar, aparece quais cenas foram baixadas e quais foram bloqueadas pelo Google.</p>
              </div>
            </td>
            <td width="48%" valign="top" style="padding-left:8px; padding-bottom:12px;">
              <div style="background:#0d0d22; border:1px solid rgba(251,191,36,0.2); border-radius:14px; padding:18px;">
                <div style="font-size:22px; margin-bottom:10px;">&#128295;</div>
                <p style="font-size:14px; font-weight:700; color:#ffffff; margin:0 0 6px; font-family:Arial,sans-serif;">Prompt de corre&#231;&#227;o</p>
                <p style="font-size:12px; color:#7070a0; margin:0; line-height:1.6; font-family:Arial,sans-serif;">Cena bloqueada? Um clique copia o prompt que corrige e devolve um CSV pronto pra reenviar.</p>
              </div>
            </td>
          </tr>
          <tr>
            <td width="48%" valign="top" style="padding-right:8px;">
              <div style="background:#0d0d22; border:1px solid rgba(192,132,252,0.2); border-radius:14px; padding:18px;">
                <div style="font-size:22px; margin-bottom:10px;">&#128203;</div>
                <p style="font-size:14px; font-weight:700; color:#ffffff; margin:0 0 6px; font-family:Arial,sans-serif;">Colar CSV direto</p>
                <p style="font-size:12px; color:#7070a0; margin:0; line-height:1.6; font-family:Arial,sans-serif;">N&#227;o precisa mais salvar arquivo. Cole o conte&#250;do direto na extens&#227;o e j&#225; est&#225; pronto.</p>
              </div>
            </td>
            <td width="48%" valign="top" style="padding-left:8px;">
              <div style="background:#0d0d22; border:1px solid rgba(0,212,170,0.2); border-radius:14px; padding:18px;">
                <div style="font-size:22px; margin-bottom:10px;">&#9998;</div>
                <p style="font-size:14px; font-weight:700; color:#ffffff; margin:0 0 6px; font-family:Arial,sans-serif;">Edi&#231;&#227;o por cena</p>
                <p style="font-size:12px; color:#7070a0; margin:0; line-height:1.6; font-family:Arial,sans-serif;">Edite, copie ou corrija o prompt de qualquer cena individual &#8212; sem mexer no CSV.</p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding: 0 40px 40px;">
        <div style="background:linear-gradient(135deg, rgba(124,111,255,0.1) 0%, rgba(0,212,170,0.06) 100%); border:1px solid rgba(124,111,255,0.25); border-radius:16px; padding:28px; text-align:center;">
          <p style="font-size:13px; color:#00d4aa; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin:0 0 10px; font-family:Arial,sans-serif;">DISPON&#205;VEL AGORA</p>
          <p style="font-size:20px; font-weight:800; color:#ffffff; margin:0 0 6px; font-family:Arial,sans-serif;">CenaDrop Flow <span style="color:#7c6fff;">v7.6</span></p>
          <p style="font-size:13px; color:#7070a0; margin:0 0 22px; font-family:Arial,sans-serif;">Baixe, instale no Chrome e j&#225; estar&#225; pronto pra aula de hoje.</p>
          <a href="https://raynern.com.br/cenadrop/download" style="display:inline-block; background:linear-gradient(135deg, #00d4aa 0%, #00bfa0 50%, #7c6fff 100%); color:#000000; font-size:16px; font-weight:800; padding:16px 36px; border-radius:12px; letter-spacing:0.3px; font-family:Arial,sans-serif;">
            &#11015; Baixar CenaDrop v7.6
          </a>
          <p style="font-size:11px; color:#4a4a6a; margin:14px 0 0; font-family:Arial,sans-serif;">Sua licen&#231;a atual continua v&#225;lida &#8212; &#233; s&#243; atualizar.</p>
        </div>
      </td>
    </tr>

    <tr><td style="padding: 0 40px;"><div style="height:1px; background:linear-gradient(90deg, transparent, rgba(124,111,255,0.2), transparent);"></div></td></tr>

    <tr>
      <td style="padding: 28px 40px 32px; text-align:center;">
        <div style="margin-bottom:16px;">
          <span style="font-size:18px; font-weight:800; color:#ffffff; font-family:Arial,sans-serif;">CENA</span><span style="font-size:18px; font-weight:800; color:#7c6fff; font-family:Arial,sans-serif;">DROP</span>
        </div>
        <p style="font-size:12px; color:#4a4a6a; margin:0 0 6px; font-family:Arial,sans-serif;">
          <a href="https://cenadrop.com.br" style="color:#7070a0;">cenadrop.com.br</a>
          &nbsp;&#183;&nbsp;
          <a href="https://raynern.com.br" style="color:#7070a0;">raynern.com.br</a>
        </p>
        <p style="font-size:11px; color:#2a2a45; margin:0; font-family:Arial,sans-serif;">
          Voc&#234; est&#225; recebendo este email porque possui uma licen&#231;a ativa do CenaDrop.<br>
          <a href="#" style="color:#2a2a45;">Cancelar inscri&#231;&#227;o</a>
        </p>
      </td>
    </tr>

    <tr>
      <td><div style="height:3px; background:linear-gradient(90deg, transparent, #7c6fff, #c084fc, #7c6fff, transparent);"></div></td>
    </tr>

  </table>

</td></tr>
</table>

</body>
</html>`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { to, nome, secret } = req.body || {};

  if (secret !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!to) return res.status(400).json({ error: 'Missing to' });

  try {
    const result = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject: 'Seu personagem muda de rosto em cada cena? &#9889; Aula ao vivo HOJE 20h',
      html: HTML,
    });
    return res.status(200).json({ ok: true, id: result?.data?.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
