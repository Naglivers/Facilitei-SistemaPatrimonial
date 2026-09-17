import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import fs from 'node:fs';
import { PLANS, nextMonth, validateSubscription, paymentRecord, checkoutURL, verifyWebhook } from '../supabase/functions/_shared/billing.mjs';
globalThis.crypto ||= webcrypto;

const local = { id: '9cbe2f5a-5e8c-4f14-9c8b-ea9039f81a87', plan: 'basico', provider_id: 'sub123' };
const remote = { id: 'sub123', external_reference: local.id, collector_id: 123, status: 'authorized', auto_recurring: { transaction_amount: 19.99, currency_id: 'BRL', frequency: 1, frequency_type: 'months' } };
const invoice = { id: 'invoice123', preapproval_id: 'sub123', payment: { id: 456 }, currency_id: 'BRL', transaction_amount: 19.99, debit_date: '2026-01-31T12:00:00Z' };
const payment = { id: 456, collector_id: 123, status: 'approved', currency_id: 'BRL', transaction_amount: 19.99, date_last_updated: '2026-01-31T12:05:00Z' };

test('preços são definidos no servidor e ciclos mensais respeitam o fim do mês', () => {
  assert.equal(PLANS.basico.cents, 1999); assert.equal(PLANS.pro.cents, 2999);
  assert.equal(nextMonth('2026-01-31T12:00:00Z'), '2026-02-28T12:00:00.000Z');
  assert.equal(nextMonth('2028-01-31T12:00:00Z'), '2028-02-29T12:00:00.000Z');
  assert.equal(nextMonth('2026-12-16T12:00:00Z'), '2027-01-16T12:00:00.000Z');
  assert.throws(() => nextMonth('invalid'));
});
test('assinatura exige referência, vendedor, plano, moeda e recorrência corretos', () => {
  assert.doesNotThrow(() => validateSubscription(remote, local, '123'));
  for (const patch of [{ external_reference: 'other' }, { collector_id: 456 }, { id: 'other' }, { status: 'free' }]) {
    assert.throws(() => validateSubscription({ ...remote, ...patch }, local, '123'));
  }
  for (const patch of [{ transaction_amount: 0.01 }, { currency_id: 'USD' }, { frequency: 12 }, { frequency_type: 'days' }]) {
    assert.throws(() => validateSubscription({ ...remote, auto_recurring: { ...remote.auto_recurring, ...patch } }, local, '123'));
  }
});
test('benefício só usa cobrança válida e trata estorno parcial', () => {
  assert.equal(paymentRecord(invoice, payment, local, '123').period_end, '2026-02-28T12:00:00.000Z');
  assert.equal(paymentRecord(invoice, { ...payment, transaction_amount_refunded: 1 }, local, '123').status, 'refunded');
  assert.equal(paymentRecord(invoice, { ...payment, status: 'rejected' }, local, '123').status, 'rejected');
  for (const patch of [{ id: 999 }, { collector_id: 999 }, { currency_id: 'USD' }, { transaction_amount: 0.1 }]) {
    assert.throws(() => paymentRecord(invoice, { ...payment, ...patch }, local, '123'));
  }
  assert.throws(() => paymentRecord({ ...invoice, preapproval_id: 'other' }, payment, local, '123'));
});
test('redirecionamento aceita apenas HTTPS do Mercado Pago', () => {
  assert.equal(checkoutURL('https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=123'), 'https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=123');
  for (const url of ['javascript:alert(1)', 'https://www.mercadopago.com.br.evil.test', 'http://www.mercadopago.com.br', 'https://user:pass@www.mercadopago.com.br']) assert.throws(() => checkoutURL(url));
});
test('webhook exige assinatura do ID da URL e do request-id', async () => {
  const secret = 'test-secret'; const ts = '1704908010'; const requestId = 'req-123';
  const signature = createHmac('sha256', secret).update(`id:abc123;request-id:${requestId};ts:${ts};`).digest('hex');
  const headers = { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${signature}` };
  assert.equal(await verifyWebhook(new Request('https://example.test?data.id=ABC123', { headers }), secret), true);
  assert.equal(await verifyWebhook(new Request('https://example.test?data.id=OTHER', { headers }), secret), false);
  assert.equal(await verifyWebhook(new Request('https://example.test?data.id=abc123', { headers: { ...headers, 'x-request-id': 'other' } }), secret), false);
  assert.equal(await verifyWebhook(new Request('https://example.test?data.id=abc123'), secret), false);
});
test('pré-verificação respeita os limites de patrimônio e documentos de cada plano', async () => {
  let info = { plan: 'free', assets: 1, asset_limit: 1, storage_bytes: 10485760, storage_limit: 10485760 };
  const context = vm.createContext({ api: async () => info, jsonOptions: () => ({}), money: n => String(n) });
  vm.runInContext(fs.readFileSync(new URL('../billing.js', import.meta.url), 'utf8'), context);
  await assert.rejects(vm.runInContext("checkPlanQuota('asset')", context), /Limite de patrimônios/);
  info = { ...info, plan: 'basico', asset_limit: 3 };
  await vm.runInContext("checkPlanQuota('asset')", context);
  await vm.runInContext("checkPlanQuota('document',1)", context);
  info = { ...info, plan: 'pro', assets: 14, storage_limit: 1073741824, asset_limit: 15 };
  await vm.runInContext("checkPlanQuota('asset')", context);
  info = { ...info, assets: 15 };
  await assert.rejects(vm.runInContext("checkPlanQuota('asset')", context), /Limite de patrimônios/);
  await vm.runInContext("checkPlanQuota('document',1)", context);
  info = { ...info, plan: 'infinite', assets: 1000, asset_limit: null, storage_limit: null };
  await vm.runInContext("checkPlanQuota('asset')", context);
});
