// api/webhook-hotmart.js — CenaDrop v7.0
// Eventos tratados:
//   COMPRA APROVADA  → gera chave + envia email
//   CANCELAMENTO     → desativa chave
//   CHARGEBACK       → desativa chave
//   RENOVAÇÃO        → mantém a chave, estende expires_at, sem reenviar e-mail
//   expires_at segue o PLANO (mensal/trimestral/anual) — ver calcExpiresAt()
//   EXPIRAÇÃO ANUAL  → desativa chave (Hotmart sinaliza via SUBSCRIPTION_CANCELLATION)
//   ?origem=COMBO    → Combo Narrativa IA + CenaDrop (produto 8736971, Black Friday 27/11):
//                      chave CenaDrop (source hotmart-COMBO) + conta Narrativa (origin 'combo');
//                      reembolso/cancelamento desfaz SÓ o que o Combo criou. Ver handleCombo().

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { renderEmail } = require('../emails/render');
const { sendEmail }   = require('../emails/send');
const { provisionarNarrativa, revogarNarrativa } = require('../lib/narrativa-conta');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// ─────────────────────────────────────────────────────────────
// ✅ PREENCHA QUANDO O DOMÍNIO ESTIVER VERIFICADO NO RESEND
// ─────────────────────────────────────────────────────────────
const EMAIL_FROM = 'CenaDrop <contato@cenadrop.com.br>';
// const EMAIL_FROM = 'CenaDrop <onboarding@resend.dev>'; // ← fallback temporário

// ─────────────────────────────────────────────────────────────
// ✅ HOTTOKS — um por conta Hotmart
// Rayner (RN): defina HOTMART_HOTTOK_RN nas env vars da Vercel
// Marcos (MC): defina HOTMART_HOTTOK_MC nas env vars da Vercel
// ─────────────────────────────────────────────────────────────
const HOTMART_HOTTOK_RN = process.env.HOTMART_HOTTOK_RN || process.env.HOTMART_HOTTOK || '';
const HOTMART_HOTTOK_MC = process.env.HOTMART_HOTTOK_MC || '';

// ─────────────────────────────────────────────────────────────
// Eventos de COMPRA APROVADA
// ─────────────────────────────────────────────────────────────
const APPROVED_EVENTS = [
  'PURCHASE_APPROVED',
  'PURCHASE_COMPLETE',
  'purchase.approved',
];

// ─────────────────────────────────────────────────────────────
// Eventos de CANCELAMENTO / CHARGEBACK / EXPIRAÇÃO
// ─────────────────────────────────────────────────────────────
const CANCEL_EVENTS = [
  'PURCHASE_CANCELED',  // grafia real da Hotmart v2 ("Compra cancelada") — a de baixo nunca chegava
  'PURCHASE_REFUNDED',
  'PURCHASE_CHARGEBACK',
  'PURCHASE_CANCELLED',
  'PURCHASE_PROTEST',
  'SUBSCRIPTION_CANCELLATION', // ← expiração anual sem renovação
];

// ─────────────────────────────────────────────────────────────
// Gerador de chave único
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// Handler principal
// ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Identifica a origem da chamada: ?origem=RN ou ?origem=MC
  const origem = (req.query?.origem || '').toUpperCase().replace(/[^A-Z]/g, '');

  // Validação do Hottok — aceita o token de qualquer uma das contas
  // O Combo pode estar na conta do Narrativa — aceita aquele hottok também, só pra ele.
  const validTokens = [HOTMART_HOTTOK_RN, HOTMART_HOTTOK_MC,
    ...(origem === 'COMBO' ? [process.env.HOTMART_HOTTOK_NARRATIVA] : [])].filter(Boolean);
  const hottok = req.headers['x-hotmart-hottok'] || req.query?.hottok || '';
  if (validTokens.length === 0 || !validTokens.includes(hottok)) {
    console.warn('[Hotmart] Hottok inválido:', hottok);
    return res.status(401).json({ error: 'Não autorizado' });
  }

  try {
    const body  = req.body;
    const event = body?.event || body?.type || '';
    const data  = body?.data  || body;

    console.log(`[Hotmart] Evento recebido: ${event}`);

    // ── COMPRA APROVADA ──────────────────────────────────────
    // ── COMBO (Narrativa IA + CenaDrop) — fluxo próprio ─────
    if (origem === 'COMBO') return await handleCombo(res, event, data);

    if (APPROVED_EVENTS.includes(event)) {
      const r = await aprovarCenadrop(data, origem);
      return res.status(r.status).json(r.body);
    }

    // ── CANCELAMENTO / CHARGEBACK / EXPIRAÇÃO ────────────────
    if (CANCEL_EVENTS.includes(event)) {
      const buyer = data?.buyer || data?.purchase?.buyer || data?.subscriber || data?.customer || {};
      const email = buyer.email || '';

      if (!email) {
        console.warn(`[Hotmart] Evento de cancelamento sem email: ${event}`);
        return res.status(200).json({ ok: true, message: 'Cancelamento sem email, ignorado' });
      }

      // Desativa as licenças ativas desse email — MAS NUNCA as do Elite (hotmart-EDA).
      // O Elite tem webhook próprio (eda-purchase.js); um reembolso/cancelamento do
      // CenaDrop avulso não pode derrubar a chave que veio do Elite (mesmo email).
      const { error } = await supabase
        .from('licenses')
        .update({
          status: 'inactive',
          active: false,
          notes: `Desativado automaticamente via Hotmart — evento: ${event} em ${new Date().toLocaleDateString('pt-BR')}`,
        })
        .eq('email', email)
        .eq('status', 'active')
        // nem a do Combo (hotmart-COMBO): ela só cai com o reembolso do próprio Combo.
        .not('source', 'in', '(hotmart-EDA,hotmart-COMBO)');

      if (error) {
        console.error(`[Hotmart] Erro ao desativar licença de ${email}:`, error);
        return res.status(500).json({ error: 'Erro ao desativar licença' });
      }

      console.log(`[Hotmart] Licença desativada para ${email} — evento: ${event}`);
      return res.status(200).json({ ok: true, message: `Licença desativada para ${email}` });
    }

    // ── EVENTO IGNORADO ──────────────────────────────────────
    console.log(`[Hotmart] Evento ignorado: ${event}`);
    return res.status(200).json({ ok: true, message: `Evento ${event} ignorado` });

  } catch (err) {
    console.error('[Hotmart] Erro interno:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
};


// ─────────────────────────────────────────────────────────────
// Aprovação CenaDrop: gera a chave (ou estende a existente) + e-mail.
// Usada pelo fluxo normal e pelo Combo. Devolve { status, body }.
// ─────────────────────────────────────────────────────────────
async function aprovarCenadrop(data, origem, productNameFixo) {
  const buyer = data?.buyer || data?.purchase?.buyer || data?.customer || {};
  const name        = buyer.name || buyer.full_name || 'Cliente';
  const email       = buyer.email || '';
  const phone       = buyer.phone || buyer.checkout_phone || '';
  const productName = productNameFixo || data?.product?.name || 'CenaDrop Flow';

  if (!email) return { status: 400, body: { error: 'Email não encontrado no payload' } };

  // Verifica se já tem chave ativa para esse email
  const { data: existing } = await supabase
    .from('licenses')
    .select('key, status')
    .eq('email', email)
    .eq('status', 'active')
    .single();

  const purchasedAt = new Date();
  const expiresAt   = calcExpiresAt(data, purchasedAt);

  if (existing) {
    // Já tem chave — estende a validade (nunca encurta) e, se não for
    // cobrança recorrente, reenvia o e-mail. Renovação do mensal todo mês
    // não pode mandar "Seu acesso chegou!" de novo.
    const { data: atual } = await supabase
      .from('licenses').select('expires_at').eq('key', existing.key).single();
    const atualMs = atual?.expires_at ? new Date(atual.expires_at).getTime() : 0;
    if (expiresAt.getTime() > atualMs) {
      await supabase.from('licenses')
        .update({ expires_at: expiresAt.toISOString() })
        .eq('key', existing.key);
    }
    const recorrencia = Number(data?.purchase?.recurrence_number) || 0;
    if (recorrencia > 1) {
      console.log(`[Hotmart] Renovação nº ${recorrencia} de ${email}: validade até ${expiresAt.toISOString()}`);
      return { status: 200, body: { ok: true, message: 'Renovação registrada' } };
    }
    await sendWelcomeEmail({ name, email, key: existing.key, productName });
    console.log(`[Hotmart] Chave já existente para ${email}, email reenviado`);
    return { status: 200, body: { ok: true, message: 'Chave já existente, email reenviado' } };
  }

  // Gera nova chave
  const key = await generateUniqueKey();

  await supabase.from('licenses').insert({
    key,
    email,
    name,
    phone,
    status:      'active',
    active:      true,
    source:      origem ? `hotmart-${origem}` : 'hotmart',
    product:     productName,
    created_at:  purchasedAt.toISOString(),
    expires_at:  expiresAt.toISOString(),
    notes: `Compra automática via Hotmart${origem ? ` (${origem})` : ''} em ${purchasedAt.toLocaleDateString('pt-BR')}`,
  });

  await sendWelcomeEmail({ name, email, key, productName });

  console.log(`[Hotmart] Nova chave gerada para ${email}: ${key}`);
  return { status: 200, body: { ok: true, key, email } };
}

// ─────────────────────────────────────────────────────────────
// COMBO Narrativa IA + CenaDrop (?origem=COMBO)
// Aprovada/completa → chave CenaDrop (mesma lógica do avulso, source hotmart-COMBO)
//                     + conta Narrativa (lib/narrativa-conta, origin 'combo').
// Cancelada/reembolsada/chargeback/fim da assinatura → desfaz SÓ o que é do Combo.
// Pedido de reembolso (PURCHASE_PROTEST) e boleto expirado NÃO revogam: espera a decisão.
// Erro em qualquer parte → 500, pra Hotmart reenviar (as duas partes são idempotentes).
// ─────────────────────────────────────────────────────────────
const COMBO_REVOKE_EVENTS = [
  'PURCHASE_CANCELED', 'PURCHASE_CANCELLED', 'PURCHASE_REFUNDED',
  'PURCHASE_CHARGEBACK', 'SUBSCRIPTION_CANCELLATION',
];

async function handleCombo(res, event, data) {
  const buyer = data?.buyer || data?.purchase?.buyer || data?.subscriber || data?.customer || {};
  const email = (buyer.email || '').trim();
  if (!email) {
    console.warn(`[Combo] Evento ${event} sem e-mail`);
    return res.status(APPROVED_EVENTS.includes(event) ? 400 : 200).json({ ok: false, error: 'Email não encontrado no payload' });
  }

  if (APPROVED_EVENTS.includes(event)) {
    const out = { cenadrop: null, narrativa: null }, erros = [];
    try {
      const r = await aprovarCenadrop(data, 'COMBO', 'CenaDrop Flow');
      if (r.status !== 200) throw new Error(r.body?.error || `status ${r.status}`);
      out.cenadrop = r.body;
    } catch (e) { erros.push(`cenadrop: ${e.message}`); }

    try {
      const purchasedAt = new Date();
      out.narrativa = await provisionarNarrativa(supabase, {
        email: email.toLowerCase(),
        name:  buyer.name || buyer.full_name || '',
        phone: buyer.phone || buyer.checkout_phone || '',
        order: data?.purchase?.transaction || '',
        origin: 'combo',
        purchasedAt: purchasedAt.toISOString(),
        expiresAt:   calcExpiresAt(data, purchasedAt).toISOString(),
      });
    } catch (e) { erros.push(`narrativa: ${e.message}`); }

    if (erros.length) {
      console.error(`[Combo] Falha ao liberar ${email}:`, erros.join(' | '));
      return res.status(500).json({ ok: false, ...out, erros });
    }
    console.log(`[Combo] Liberado CenaDrop + Narrativa para ${email}`);
    return res.status(200).json({ ok: true, ...out });
  }

  if (COMBO_REVOKE_EVENTS.includes(event)) {
    const erros = [];
    let chaves = 0, contas = 0;
    try {
      const { data: off, error } = await supabase.from('licenses')
        .update({
          status: 'inactive', active: false,
          notes: `Desativado automaticamente via Hotmart (Combo) — evento: ${event} em ${new Date().toLocaleDateString('pt-BR')}`,
        })
        .eq('email', email).eq('status', 'active').eq('source', 'hotmart-COMBO')
        .select('key');
      if (error) throw new Error(error.message);
      chaves = (off || []).length;
    } catch (e) { erros.push(`cenadrop: ${e.message}`); }

    try { contas = await revogarNarrativa(supabase, email.toLowerCase(), { origin: 'combo' }); }
    catch (e) { erros.push(`narrativa: ${e.message}`); }

    if (erros.length) {
      console.error(`[Combo] Falha ao revogar ${email}:`, erros.join(' | '));
      return res.status(500).json({ ok: false, erros });
    }
    console.log(`[Combo] Revogado ${email} — ${event}: ${chaves} chave(s), ${contas} conta(s) Narrativa`);
    return res.status(200).json({ ok: true, revogado: { chaves, contas_narrativa: contas } });
  }

  console.log(`[Combo] Evento ignorado: ${event}`);
  return res.status(200).json({ ok: true, message: `Evento ${event} ignorado` });
}

// ─────────────────────────────────────────────────────────────
// Validade da chave conforme o plano da assinatura.
// É INFORMATIVA (painel/suporte): quem corta o acesso é o
// SUBSCRIPTION_CANCELLATION da Hotmart, não esta data.
// 1º a data da próxima cobrança que a Hotmart manda; senão, o nome
// do plano ("CenaDrop Flow — Mensal" etc.); sem pista, 1 ano (produto antigo).
// ─────────────────────────────────────────────────────────────
function calcExpiresAt(data, from) {
  const proxima = Number(data?.purchase?.date_next_charge);
  if (proxima > from.getTime()) return new Date(proxima);

  const plano = [
    data?.subscription?.plan?.name,
    data?.purchase?.offer?.name,
    data?.purchase?.offer?.description,
  ].filter(Boolean).join(' ').toLowerCase();

  const meses = /mensal/.test(plano)     ? 1
              : /trimestral/.test(plano) ? 3
              : /semestral/.test(plano)  ? 6
              : 12;
  const d = new Date(from);
  d.setMonth(d.getMonth() + meses);
  return d;
}

// ─────────────────────────────────────────────────────────────
// Email de boas-vindas com a chave
// ─────────────────────────────────────────────────────────────
async function sendWelcomeEmail({ name, email, key, productName }) {
  const firstName = (name || '').split(' ')[0] || 'tudo bem';
  // sendEmail (não resend.emails.send) — lança se o Resend recusar, senão o
  // comprador fica sem a chave e o log não registra nada.
  await sendEmail(resend, {
    from: EMAIL_FROM,
    to: email,
    subject: `🎬 Seu acesso ao ${productName} chegou!`,
    // Template tonal (padrão Narrativa) em emails/cenadrop/boas-vindas.html —
    // 3 passos de instalação (com dica do manifest.json), link do manual e
    // suporte no WhatsApp. Fonte única; editar o .html, não HTML inline.
    html: renderEmail('cenadrop/boas-vindas', {
      PRIMEIRO_NOME: firstName,
      CHAVE: key,
      LINK_DOWNLOAD: 'https://cenadrop.com.br/download',
    }),
  });
}
