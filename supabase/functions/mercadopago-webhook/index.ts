import { BillingError, env, db, mp, providerId, verifyWebhook, localForRemote, saveSubscription, syncInvoice, syncPixOrder } from '../_shared/billing.mjs';

Deno.serve(async request => {
  try {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (!await verifyWebhook(request, env('MP_WEBHOOK_SECRET'))) return new Response(null, { status: 401 });
    const body = await request.json();
    const id = providerId(new URL(request.url).searchParams.get('data.id'));
    if (String(body.data?.id).toLowerCase() !== id.toLowerCase()) return new Response(null, { status: 400 });
    if (body.type === 'order') {
      const order = await mp(`/v1/orders/${id}`);
      const local = await localForRemote(order);
      if (local?.provider_type === 'pix') await syncPixOrder(local);
    } else if (body.type === 'subscription_preapproval') {
      const remote = await mp(`/preapproval/${id}`);
      const local = await localForRemote(remote);
      if (local) await saveSubscription(remote, local);
    } else if (body.type === 'subscription_authorized_payment') {
      const invoice = await mp(`/authorized_payments/${id}`);
      const remote = await mp(`/preapproval/${providerId(invoice.preapproval_id)}`);
      const local = await localForRemote(remote);
      if (local) await syncInvoice(invoice, await saveSubscription(remote, local));
    } else if (body.type === 'payment') {
      const payment = await mp(`/v1/payments/${id}`);
      // O evento de pagamento pode chegar antes do evento da fatura.
      const known = (await db(`billing_payments?provider_payment_id=eq.${id}&limit=1`))[0];
      const invoices = known ? [await mp(`/authorized_payments/${providerId(known.invoice_id)}`)]
        : (await mp(`/authorized_payments/search?payment_id=${id}&limit=100`)).results || [];
      for (const invoice of invoices) {
        if (String(invoice.payment?.id) !== id) continue;
        const remote = await mp(`/preapproval/${providerId(invoice.preapproval_id)}`);
        const local = await localForRemote(remote);
        if (local) await syncInvoice(invoice, await saveSubscription(remote, local), payment);
      }
    }
    return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('billing_webhook_failed', {
      status: error instanceof BillingError ? error.status : 500,
      upstream: error instanceof BillingError ? error.upstream || null : null,
      upstreamStatus: error instanceof BillingError ? error.upstreamStatus || null : null,
    });
    // Só confirmar depois de persistir. Erros temporários recebem nova tentativa.
    return new Response(null, { status: 500 });
  }
});
