/* Os limites exibidos aqui são informativos; o banco é a autoridade. */
const BILLING_PLANS = [
  { id: 'free', name: 'Free', price: 0, assets: '1 patrimônio', documents: '5 documentos no total', description: 'Para começar a organizar seus bens.' },
  { id: 'basico', name: 'Básico', price: 19.99, assets: 'Até 3 patrimônios', documents: '5 documentos por patrimônio', description: 'Mais espaço para acompanhar sua carteira.' },
  { id: 'pro', name: 'Pro', price: 29.99, assets: 'Patrimônios ilimitados', documents: 'Documentos ilimitados', description: 'Toda a gestão, sem limites de quantidade.' },
];
let billingBusy = false;

async function readPlan() {
  try { return await api('/rest/v1/rpc/my_plan', jsonOptions('POST', {})); }
  catch { throw new Error('Não foi possível consultar seu plano. Tente novamente em instantes.'); }
}
async function billingRequest(action, plan) {
  let response;
  try {
    response = await fetch(`${supabaseBase()}/functions/v1/billing`, {
      method: 'POST', headers: { apikey: config.SUPABASE_ANON_KEY, Authorization: `Bearer ${state.session?.access_token || ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...(plan ? { plan } : {}) }), signal: AbortSignal.timeout(45000),
    });
  } catch { throw new Error('Não foi possível conectar ao pagamento. Tente novamente em instantes.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'O pagamento ainda não está disponível. Tente novamente mais tarde.');
  return data;
}
function planCards(info) {
  const subscription = info?.subscription;
  const hasOpen = ['creating','pending','authorized','paused'].includes(subscription?.status);
  return `<div class="plans-grid">${BILLING_PLANS.map(plan => {
    const current = info?.plan === plan.id;
    const resume = hasOpen && subscription.status === 'pending' && subscription.plan === plan.id;
    const disabled = !info || plan.id === 'free' || (hasOpen && !resume);
    const label = resume ? 'Continuar pagamento' : current ? (hasOpen || plan.id === 'free' ? 'Plano atual' : 'Assinar novamente') : plan.id === 'free' ? 'Gratuito' : 'Escolher Pix ou cartão';
    return `<article class="card plan-card ${current ? 'current-plan' : ''}">
      <div class="plan-card-heading"><h3>${plan.name}</h3>${current ? '<span class="pill ok">Seu plano</span>' : ''}</div>
      <p class="plan-description">${plan.description}</p><p class="plan-price">${money(plan.price)}<span>${plan.price ? '/mês' : ' / grátis'}</span></p>
      <ul><li>${plan.assets}</li><li>${plan.documents}</li><li>Pagamentos e gastos sem limite de quantidade</li>${plan.price ? '<li>Pix ou cartão, sem precisar de conta Mercado Pago</li>' : ''}</ul>
      <button class="button ${plan.id === 'pro' ? '' : 'secondary'}" type="button" data-subscribe="${plan.id}" ${disabled ? 'disabled' : ''}>${label}</button>
    </article>`;
  }).join('')}</div>`;
}
async function renderBilling(target) {
  try {
    const info = await readPlan();
    if (!target.isConnected) return;
    const plan = BILLING_PLANS.find(item => item.id === info.plan) || BILLING_PLANS[0];
    const subscription = info.subscription;
    const hasOpen = ['creating','pending','authorized','paused'].includes(subscription?.status);
    const statusLabels = { creating: 'Preparando assinatura', pending: 'Aguardando pagamento', authorized: 'Renovação automática ativa', paused: 'Renovação pausada', cancelled: 'Renovação cancelada', failed: 'Pagamento não iniciado' };
    target.innerHTML = `<div class="billing-heading"><div><h2>Planos e assinatura</h2><p>Escolha o espaço que acompanha seu patrimônio.</p></div><button class="button secondary small" type="button" data-billing-refresh>Atualizar status</button></div>
      <div class="card plan-usage" aria-live="polite"><div><span>Plano atual</span><strong>${plan.name}</strong><small>${esc(statusLabels[subscription?.status] || 'Sem mensalidade')}${info.valid_until ? ` · Acesso pago até ${dateTime(info.valid_until)}` : ''}</small></div>
      <div><span>Patrimônios</span><strong>${info.assets} / ${info.asset_limit ?? 'ilimitados'}</strong></div>
      <div><span>Documentos</span><strong>${info.documents}${info.plan === 'free' ? ' / 5' : ''}</strong><small>${info.plan === 'basico' ? 'Limite de 5 por patrimônio' : info.plan === 'pro' ? 'Sem limite de quantidade' : 'No total da conta'}</small></div></div>
      ${info.asset_limit !== null && info.assets > info.asset_limit ? '<p class="billing-notice">Você tem mais patrimônios que o limite atual. Seus dados continuam disponíveis; escolha um plano maior para cadastrar novos bens.</p>' : ''}
      ${hasOpen && !info.valid_until ? '<p class="billing-notice">O plano pago será liberado após a confirmação da cobrança pelo Mercado Pago. Você pode atualizar o status depois de pagar.</p>' : ''}
      ${planCards(info)}
      <p class="billing-footnote">No checkout do Mercado Pago, escolha Pix ou cartão e continue mesmo sem conta Mercado Pago. Assinaturas mensais em reais; a disponibilidade de cobrança automática depende do meio escolhido. Cancele a renovação quando quiser. PDF, PNG e JPEG de até 10 MB por arquivo em todos os planos.</p>
      ${hasOpen ? '<div class="billing-manage"><p>Para trocar de plano, cancele a assinatura atual e escolha o novo plano. Uma nova assinatura inicia uma cobrança mensal integral, sem crédito automático do período anterior.</p><button class="button secondary small" type="button" data-billing-cancel>Cancelar assinatura</button></div>' : ''}`;
    target.querySelectorAll('[data-subscribe]:not([disabled])').forEach(button => button.onclick = () => startSubscription(button.dataset.subscribe, target));
    target.querySelector('[data-billing-refresh]').onclick = () => updateBilling(target);
    const cancel = target.querySelector('[data-billing-cancel]');
    if (cancel) cancel.onclick = () => cancelSubscription(target);
  } catch (error) {
    if (!target.isConnected) return;
    target.innerHTML = `<div class="billing-heading"><div><h2>Planos e assinatura</h2><p>Conheça os planos disponíveis.</p></div></div><p class="billing-notice" role="status">${esc(error.message)}</p>${planCards(null)}<button class="button secondary small" type="button" data-billing-retry>Tentar novamente</button>`;
    target.querySelector('[data-billing-retry]').onclick = () => renderBilling(target);
  }
}
async function billingAction(target, operation) {
  if (billingBusy) return;
  billingBusy = true;
  target.setAttribute('aria-busy', 'true');
  target.querySelectorAll('button').forEach(button => { button.disabled = true; });
  try { await operation(); }
  catch (error) { notify(error.message, true); }
  finally {
    billingBusy = false;
    target.removeAttribute('aria-busy');
    if (target.isConnected) await renderBilling(target);
  }
}
function startSubscription(planId, target) {
  const plan = BILLING_PLANS.find(item => item.id === planId);
  if (!plan?.price) return;
  return billingAction(target, async () => {
    const result = await billingRequest('checkout', planId);
    const url = new URL(result.checkout_url);
    if (url.protocol !== 'https:' || !['www.mercadopago.com.br','www.mercadopago.com'].includes(url.hostname) || url.username || url.password) throw new Error('Não foi possível abrir o pagamento.');
    window.location.assign(url.href);
  });
}
function updateBilling(target) {
  return billingAction(target, async () => { await billingRequest('status'); notify('Status da assinatura atualizado.'); });
}
function cancelSubscription(target) {
  if (!confirm('Cancelar a assinatura e interromper as próximas cobranças? O acesso já pago continua até o fim do período. Seus patrimônios e documentos serão preservados.')) return;
  return billingAction(target, async () => { await billingRequest('cancel'); notify('Assinatura cancelada. O período já pago foi preservado.'); });
}
async function checkPlanQuota(kind, assetId) {
  const info = await readPlan();
  if (kind === 'asset' && info.asset_limit !== null && info.assets >= info.asset_limit) {
    throw new Error('Limite de patrimônios atingido. Acesse Configurações → Planos e assinatura para aumentar seu limite.');
  }
  const documents = info.plan === 'free' ? info.documents : Number(info.documents_by_asset[String(assetId)] || 0);
  if (kind === 'document' && info.document_limit !== null && documents >= info.document_limit) {
    throw new Error('Limite de documentos atingido. Acesse Configurações → Planos e assinatura para aumentar seu limite.');
  }
}
