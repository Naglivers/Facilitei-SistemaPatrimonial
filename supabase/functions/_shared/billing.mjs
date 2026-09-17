export const PLANS = Object.freeze({ basico: { name: 'Básico', cents: 1999 }, pro: { name: 'Pro', cents: 2999 } });
export class BillingError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function env(name) {
  const value = Deno.env.get(name);
  if (!value) throw new BillingError('O pagamento ainda não está disponível. Tente novamente mais tarde.', 503);
  return value;
}
export async function requestJSON(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  if (!response.ok) {
    // Nunca enviar tokens, respostas do provedor ou dados pessoais ao navegador/log.
    const error = new BillingError('Não foi possível consultar o serviço de pagamento. Tente novamente.', 502);
    error.upstreamStatus = response.status;
    // Apenas diagnóstico seguro: sem URL, corpo da resposta, token ou dados pessoais.
    error.upstream = new URL(url).hostname === 'api.mercadopago.com' ? 'mercadopago' : 'supabase';
    throw error;
  }
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}
export function db(path, method = 'GET', body) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return requestJSON(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
export const rpc = (name, body) => db(`rpc/${name}`, 'POST', body);
export function mp(path, method = 'GET', body) {
  return requestJSON(`https://api.mercadopago.com${path}`, {
    method, headers: { Authorization: `Bearer ${env('MP_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
export function providerId(value) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(String(value || ''))) throw new BillingError('Identificador inválido.');
  return String(value);
}
export function checkoutURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['www.mercadopago.com.br','www.mercadopago.com'].includes(url.hostname) || url.username || url.password) {
    throw new BillingError('Link de pagamento inválido.', 502);
  }
  return url.href;
}
export function nextMonth(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new BillingError('Data de cobrança inválida.', 502);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString();
}
export function validateSubscription(remote, local, collector) {
  const recurring = remote.auto_recurring;
  if (String(remote.external_reference) !== local.id || String(remote.collector_id) !== String(collector)
      || !PLANS[local.plan] || Math.round(Number(recurring?.transaction_amount) * 100) !== PLANS[local.plan].cents
      || recurring?.currency_id !== 'BRL' || recurring?.frequency !== 1 || recurring?.frequency_type !== 'months'
      || !['pending','authorized','paused','cancelled'].includes(remote.status)
      || (local.provider_id && local.provider_id !== String(remote.id))) {
    throw new BillingError('Não foi possível validar a assinatura.', 502);
  }
}
export async function saveSubscription(remote, local) {
  validateSubscription(remote, local, env('MP_COLLECTOR_ID'));
  await rpc('billing_record_subscription', { p_id: local.id, p_data: {
    provider_id: providerId(remote.id), status: remote.status,
    checkout_url: remote.init_point ? checkoutURL(remote.init_point) : null,
    provider_updated_at: remote.last_modified || remote.date_created,
  } });
  return { ...local, provider_id: String(remote.id), status: remote.status, checkout_url: remote.init_point || null };
}
export async function localForRemote(remote) {
  if (!/^[0-9a-f-]{36}$/i.test(String(remote.external_reference))) return null;
  return (await db(`billing_subscriptions?id=eq.${remote.external_reference}&limit=1`))[0] || null;
}
export function paymentRecord(invoice, payment, sub, collector) {
  if (String(invoice.preapproval_id) !== sub.provider_id || String(invoice.payment?.id) !== String(payment.id)
      || String(payment.collector_id) !== String(collector) || invoice.currency_id !== 'BRL' || payment.currency_id !== 'BRL'
      || Math.round(Number(invoice.transaction_amount) * 100) !== PLANS[sub.plan].cents
      || Math.round(Number(payment.transaction_amount) * 100) !== PLANS[sub.plan].cents) {
    throw new BillingError('Não foi possível validar a cobrança.', 502);
  }
  const start = new Date(invoice.debit_date).toISOString();
  // Estorno parcial também interrompe o benefício dessa cobrança.
  const status = Number(payment.transaction_amount_refunded || 0) > 0 ? 'refunded' : payment.status;
  if (!payment.date_last_updated || !status) throw new BillingError('Cobrança incompleta.', 502);
  return { provider_payment_id: providerId(payment.id), subscription_id: sub.id, invoice_id: providerId(invoice.id),
    status, period_start: start, period_end: nextMonth(start), provider_updated_at: payment.date_last_updated };
}
export async function syncInvoice(invoice, sub, suppliedPayment) {
  if (!invoice.payment?.id) return;
  const payment = suppliedPayment || await mp(`/v1/payments/${providerId(invoice.payment.id)}`);
  const record = paymentRecord(invoice, payment, sub, env('MP_COLLECTOR_ID'));
  await rpc('billing_record_payment', { p_payment: record });
}
export async function syncSubscription(sub, includeInvoices = true) {
  let remote;
  if (sub.provider_id) remote = await mp(`/preapproval/${providerId(sub.provider_id)}`);
  else {
    const result = await mp(`/preapproval/search?external_reference=${encodeURIComponent(sub.id)}&limit=100`);
    const matches = (result.results || []).filter(item => String(item.external_reference) === sub.id);
    if (matches.length > 1) throw new BillingError('Sua assinatura precisa de revisão. Entre em contato com o suporte.', 409);
    if (!matches.length) return sub;
    remote = await mp(`/preapproval/${providerId(matches[0].id)}`);
  }
  sub = await saveSubscription(remote, sub);
  if (!includeInvoices) return sub;
  // Paginação evita perder renovações em assinaturas antigas. Somente ciclos
  // ainda válidos precisam ser relidos; o histórico já confirmado fica no banco.
  for (let offset = 0; offset < 10000; offset += 100) {
    const page = await mp(`/authorized_payments/search?preapproval_id=${providerId(sub.provider_id)}&limit=100&offset=${offset}`);
    const invoices = page.results || [];
    for (const invoice of invoices) {
      if (invoice.payment?.id && new Date(nextMonth(invoice.debit_date)).getTime() > Date.now()) await syncInvoice(invoice, sub);
    }
    if (offset + invoices.length >= Number(page.paging?.total || invoices.length) || !invoices.length) return sub;
  }
  throw new BillingError('A atualização da assinatura está demorando. Tente novamente.', 503);
}
export async function verifyWebhook(request, secret) {
  const id = new URL(request.url).searchParams.get('data.id');
  const requestId = request.headers.get('x-request-id');
  const parts = (request.headers.get('x-signature') || '').split(',').map(item => item.trim().split('='));
  const ts = parts.find(([key]) => key === 'ts')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!id || !requestId || !/^\d+$/.test(ts || '')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const message = new TextEncoder().encode(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`);
  for (const signature of signatures) {
    if (!/^[0-9a-f]{64}$/i.test(signature || '')) continue;
    const bytes = Uint8Array.from(signature.match(/../g), hex => parseInt(hex, 16));
    if (await crypto.subtle.verify('HMAC', key, bytes, message)) return true;
  }
  return false;
}
