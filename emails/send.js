// emails/send.js — envio de email com verificação de erro.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE
// O SDK do Resend NÃO lança exceção quando a API recusa o envio. Ele devolve
// { data: null, error: { message } }. Então este código:
//
//     await resend.emails.send({ ... });          // ❌ falha em silêncio
//
// segue adiante como se tivesse enviado — mesmo em domínio não verificado,
// destinatário inválido, rate limit ou chave errada. O comprador não recebe
// a chave, o log fica mudo e ninguém descobre.
//
// Use sempre:
//     await sendEmail(resend, { ... });           // ✅ lança se falhar
//
const { renderEmail } = require('./render');

/**
 * Envia um email e LANÇA se o Resend recusar.
 * @param {import('resend').Resend} resend  instância do SDK
 * @param {object} opts                     mesmas opções de resend.emails.send
 * @returns {Promise<object>}               data do Resend (com o id do email)
 * @throws  {Error}                         se a API recusar ou não retornar dado
 */
async function sendEmail(resend, opts) {
  const resposta = await resend.emails.send(opts);
  if (resposta?.error) {
    const alvo = Array.isArray(opts.to) ? opts.to.join(', ') : opts.to;
    throw new Error(`Resend recusou o envio para ${alvo}: ${resposta.error.message || JSON.stringify(resposta.error)}`);
  }
  if (!resposta?.data) {
    throw new Error('Resend não retornou confirmação de envio');
  }
  return resposta.data;
}

/**
 * Versão que não interrompe o fluxo: registra a falha e devolve o resultado.
 * Para casos em que o envio é secundário (aviso, notificação) e não deve
 * derrubar a operação principal — mas ainda precisa aparecer no log.
 * @returns {Promise<{ok: boolean, id?: string, erro?: string}>}
 */
async function trySendEmail(resend, opts, contexto = 'email') {
  try {
    const data = await sendEmail(resend, opts);
    return { ok: true, id: data.id };
  } catch (e) {
    console.error(`❌ [${contexto}] ${e.message}`);
    return { ok: false, erro: e.message };
  }
}

/**
 * Avisa o Rayner que um COMPRADOR ficou sem receber o email dele.
 * Usar nos fluxos de compra: o dinheiro entrou, o acesso foi criado, mas a
 * pessoa não recebeu as instruções — precisa de reenvio manual pelo painel.
 * Best-effort: nunca lança, para não cascatear em cima de uma falha de email.
 */
async function alertarFalhaDeEntrega(resend, { produto, cliente, erro }) {
  const para = process.env.LEAD_NOTIFY_EMAIL || 'rn.smidia@gmail.com';
  try {
    await resend.emails.send({
      from:    'Alerta Servidor <noreply@raynern.com.br>',
      to:      para,
      subject: `🚨 ${produto}: ${cliente} comprou e NÃO recebeu o e-mail`,
      html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6">
        <p><strong>${cliente}</strong> concluiu a compra de <strong>${produto}</strong>,
        o acesso foi criado normalmente, mas o e-mail com as instruções não foi entregue.</p>
        <p style="background:#fff4f4;border-left:3px solid #c0392b;padding:10px 14px">
          <strong>Motivo:</strong> ${erro}
        </p>
        <p><strong>O que fazer:</strong> abra o painel e use o botão de reenviar
        para essa pessoa.</p>
        <p><a href="https://raynern.com.br/admin">Abrir o painel</a></p>
      </div>`,
    });
  } catch (e) {
    console.error('❌ [alerta] nem o alerta de falha saiu:', e.message);
  }
}

module.exports = { sendEmail, trySendEmail, alertarFalhaDeEntrega, renderEmail };
