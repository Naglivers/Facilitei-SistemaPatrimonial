import { BillingError, PLANS, env, requestJSON, db, rpc, mp, providerId, checkoutURL, saveSubscription, syncSubscription } from '../_shared/billing.mjs';

Deno.serve(async request => {
  let headers: Record<string,string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
  try {
    const site = new URL(env('SITE_URL'));
    if (site.protocol !== 'https:') throw new BillingError('Endereço do site não configurado.', 503);
    headers = { ...headers, 'Access-Control-Allow-Origin': site.origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (request.headers.get('origin') && request.headers.get('origin') !== site.origin) throw new BillingError('Origem inválida.', 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') throw new BillingError('Método inválido.', 405);
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) throw new BillingError('Entre novamente na sua conta.', 401);
    let user;
    try {
      user = await requestJSON(`${env('SUPABASE_URL')}/auth/v1/user`, { headers: { Authorization: authorization, apikey: env('SUPABASE_ANON_KEY') } });
    } catch { throw new BillingError('Entre novamente na sua conta.', 401); }
    if (!user?.id || !user.email) throw new BillingError('Conta inválida.', 401);
    const input = await request.json();
    if (!['status','checkout','cancel'].includes(input.action)) throw new BillingError('Ação inválida.');
    env('MP_ACCESS_TOKEN'); env('MP_COLLECTOR_ID'); env('MP_WEBHOOK_SECRET');
    const open = await db(`billing_subscriptions?user_id=eq.${user.id}&status=in.(creating,pending,authorized,paused)&limit=1`);
    if (input.action === 'status') {
      const recent = await db(`billing_subscriptions?user_id=eq.${user.id}&status=neq.failed&order=created_at.desc&limit=5`);
      for (const sub of recent) await syncSubscription(sub);
      return new Response(JSON.stringify({ ok: true }), { headers });
    }
    if (input.action === 'cancel') {
      if (open[0]) {
        const sub = await syncSubscription(open[0]);
        if (!sub.provider_id) throw new BillingError('A criação da assinatura ainda está sendo verificada. Tente novamente em instantes.', 409);
        if (sub.status !== 'cancelled') {
          const remote = await mp(`/preapproval/${providerId(sub.provider_id)}`, 'PUT', { status: 'cancelled' });
          await saveSubscription(remote, sub);
        }
      }
      return new Response(JSON.stringify({ ok: true }), { headers });
    }
    if (!Object.hasOwn(PLANS, input.plan)) throw new BillingError('Escolha Básico ou Pro.');
    if (open[0]) {
      const sub = await syncSubscription(open[0]);
      if (sub.status !== 'cancelled' && (sub.plan !== input.plan || sub.status !== 'pending')) {
        throw new BillingError('Cancele a assinatura atual antes de escolher outro plano. O período já pago será preservado.', 409);
      }
      if (sub.status === 'pending' && sub.checkout_url) return new Response(JSON.stringify({ checkout_url: checkoutURL(sub.checkout_url) }), { headers });
    }
    const claim = await rpc('billing_claim_checkout', { p_user: user.id, p_plan: input.plan });
    let sub = claim.subscription;
    if (!claim.created) {
      sub = await syncSubscription(sub, false);
      if (sub.plan === input.plan && sub.status === 'pending' && sub.checkout_url) return new Response(JSON.stringify({ checkout_url: checkoutURL(sub.checkout_url) }), { headers });
      throw new BillingError('Já existe uma assinatura em processamento. Atualize o status em instantes.', 409);
    }
    site.searchParams.set('billing', 'return');
    site.hash = 'configuracoes';
    let remote;
    try {
      remote = await mp('/preapproval', 'POST', {
        reason: `Facilitei — Plano ${PLANS[input.plan].name} mensal`, external_reference: sub.id, payer_email: user.email,
        auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: PLANS[input.plan].cents / 100, currency_id: 'BRL' },
        back_url: site.href, status: 'pending',
        notification_url: `${env('SUPABASE_URL')}/functions/v1/mercadopago-webhook`,
      });
    } catch (error) {
      // Erro de rede/5xx é ambíguo: preservar a referência para conciliar,
      // sem criar outra assinatura e sem cobrar duas vezes.
      if (error.upstreamStatus >= 400 && error.upstreamStatus < 500 && error.upstreamStatus !== 429) {
        await db(`billing_subscriptions?id=eq.${sub.id}&status=eq.creating&provider_id=is.null`, 'PATCH', { status: 'failed' });
      }
      throw error;
    }
    // Se a gravação local falhar depois da criação remota, manter 'creating'
    // permite recuperar a mesma assinatura por external_reference.
    sub = await saveSubscription(remote, sub);
    return new Response(JSON.stringify({ checkout_url: checkoutURL(sub.checkout_url) }), { headers });
  } catch (error) {
    const status = error instanceof BillingError ? error.status : 500;
    console.error('billing_request_failed', status);
    return new Response(JSON.stringify({ error: error instanceof BillingError ? error.message : 'Não foi possível concluir a operação. Tente novamente.' }), { status, headers });
  }
});
