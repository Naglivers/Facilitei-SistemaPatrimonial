/* Os limites exibidos aqui são informativos; o banco é a autoridade. */
const BILLING_PLANS = [
  { id: 'free', name: 'Free', price: 0, assets: '1 patrimônio', documents: 'Até 10 MB de arquivos', description: 'Para começar a organizar seus bens.' },
  { id: 'basico', name: 'Básico', price: 19.99, assets: 'Até 3 patrimônios', documents: 'Até 100 MB de arquivos', description: 'Mais espaço para acompanhar sua carteira.' },
  { id: 'pro', name: 'Pro', price: 29.99, assets: 'Até 15 patrimônios', documents: 'Até 1 GB de arquivos', description: 'Mais capacidade para sua gestão patrimonial.' },
  { id: 'infinite', name: 'Infinite', price: null, assets: 'Patrimônios ilimitados', documents: 'Arquivos ilimitados', description: 'Para operações que precisam de uma estrutura sob medida.' },
];
let billingBusy = false;
let billingCycle = 'mensal';
const BILLING_CYCLES = { mensal: { label: 'Mensal', months: 1, discount: 0 }, trimestral: { label: 'Trimestral', months: 3, discount: .10 }, semestral: { label: 'Semestral', months: 6, discount: .15 }, anual: { label: 'Anual', months: 12, discount: .20 } };
function cyclePrice(plan) { const cycle = BILLING_CYCLES[billingCycle]; return Math.round(plan.price * cycle.months * (1 - cycle.discount) * 100) / 100; }
function infiniteWhatsAppLink() { const number = String(window.APP_CONFIG?.WHATSAPP_NUMBER || '').replace(/\D/g, ''); return number ? `https://wa.me/${number}?text=${encodeURIComponent('Olá! Quero conhecer o plano Infinite do Facilitei.')}` : '#'; }
function storageLabel(bytes) { if (bytes == null) return 'ilimitado'; if (bytes >= 1073741824) return `${(bytes / 1073741824).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`; return `${Math.round(bytes / 1048576)} MB`; }

async function readPlan() {
  try { return await api('/rest/v1/rpc/my_plan', jsonOptions('POST', {})); }
  catch { throw new Error('Não foi possível consultar seu plano. Tente novamente em instantes.'); }
}
async function billingRequest(action, plan, cycle) {
  let response;
  try {
    response = await fetch(`${supabaseBase()}/functions/v1/billing`, {
      method: 'POST', headers: { apikey: config.SUPABASE_ANON_KEY, Authorization: `Bearer ${state.session?.access_token || ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...(plan ? { plan } : {}), ...(cycle ? { cycle } : {}) }), signal: AbortSignal.timeout(45000),
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
    const isInfinite = plan.id === 'infinite';
    const resume = hasOpen && subscription.status === 'pending' && subscription.plan === plan.id;
    const disabled = !info || plan.id === 'free' || (hasOpen && !resume);
    const label = resume ? 'Continuar cartão' : current ? (hasOpen || plan.id === 'free' ? 'Plano atual' : 'Assinar novamente') : plan.id === 'free' ? 'Gratuito' : 'Assinar com cartão';
    const cycle = BILLING_CYCLES[billingCycle]; const price = plan.price ? cyclePrice(plan) : 0;
    return `<article class="card plan-card ${current ? 'current-plan' : ''}">
      <div class="plan-card-heading"><h3>${plan.name}</h3>${current ? '<span class="pill ok">Seu plano</span>' : ''}</div>
      <p class="plan-description">${plan.description}</p><p class="plan-price">${isInfinite ? 'Sob consulta' : money(price)}<span>${plan.price ? ` / ${cycle.label.toLowerCase()}` : ''}</span></p>${plan.price && cycle.discount ? `<small class="plan-discount">${Math.round(cycle.discount * 100)}% de desconto · equivalente a ${money(price / cycle.months)}/mês</small>` : ''}
      <ul><li>${plan.assets}</li><li>${plan.documents}</li><li>Pagamentos e gastos sem limite de quantidade</li>${plan.price ? '<li>Pix ou cartão, sem precisar de conta Mercado Pago</li>' : ''}</ul>
      <div class="plan-actions">${isInfinite ? `<a class="button" href="${infiniteWhatsAppLink()}" target="_blank" rel="noopener">Falar no WhatsApp</a>` : `<button class="button ${plan.id === 'pro' ? '' : 'secondary'}" type="button" data-subscribe="${plan.id}" ${disabled ? 'disabled' : ''}>${label}</button>${plan.price ? `<button class="button secondary" type="button" data-pix="${plan.id}" ${disabled ? 'disabled' : ''}>Pagar com Pix</button>` : ''}`}</div>
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
      <div><span>Arquivos</span><strong>${storageLabel(info.storage_bytes || 0)} / ${storageLabel(info.storage_limit)}</strong><small>Espaço usado pela conta</small></div></div>
      ${info.asset_limit !== null && info.assets > info.asset_limit ? '<p class="billing-notice">Você tem mais patrimônios que o limite atual. Seus dados continuam disponíveis; escolha um plano maior para cadastrar novos bens.</p>' : ''}
      ${hasOpen && !info.valid_until ? '<p class="billing-notice">O plano pago será liberado após a confirmação da cobrança pelo Mercado Pago. Você pode atualizar o status depois de pagar.</p>' : ''}
      <div class="billing-cycles" role="group" aria-label="Período de cobrança">${Object.entries(BILLING_CYCLES).map(([id, cycle]) => `<button class="${billingCycle === id ? 'active' : ''}" type="button" data-billing-cycle="${id}">${cycle.label}${cycle.discount ? ` · -${Math.round(cycle.discount * 100)}%` : ''}</button>`).join('')}</div>
      ${planCards(info)}
      <p class="billing-footnote">No checkout do Mercado Pago, escolha Pix ou cartão e continue mesmo sem conta Mercado Pago. Assinaturas mensais em reais; a disponibilidade de cobrança automática depende do meio escolhido. Cancele a renovação quando quiser. O espaço de arquivos é compartilhado por todos os patrimônios da conta.</p>
      ${hasOpen ? '<div class="billing-manage"><p>Para trocar de plano, cancele a assinatura atual e escolha o novo plano. Uma nova assinatura inicia uma cobrança mensal integral, sem crédito automático do período anterior.</p><button class="button secondary small" type="button" data-billing-cancel>Cancelar assinatura</button></div>' : ''}`;
    target.querySelectorAll('[data-subscribe]:not([disabled])').forEach(button => button.onclick = () => startSubscription(button.dataset.subscribe, target, billingCycle));
    target.querySelectorAll('[data-pix]:not([disabled])').forEach(button => button.onclick = () => startPix(button.dataset.pix, target, billingCycle));
    target.querySelectorAll('[data-billing-cycle]').forEach(button => button.onclick = () => { billingCycle = button.dataset.billingCycle; renderBilling(target); });
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
function startSubscription(planId, target, cycle = billingCycle) {
  const plan = BILLING_PLANS.find(item => item.id === planId);
  if (!plan?.price) return;
  return billingAction(target, async () => {
    const result = await billingRequest('checkout', planId, cycle);
    const url = new URL(result.checkout_url);
    if (url.protocol !== 'https:' || !['www.mercadopago.com.br','www.mercadopago.com'].includes(url.hostname) || url.username || url.password) throw new Error('Não foi possível abrir o pagamento.');
    window.location.assign(url.href);
  });
}
function startPix(planId, target, cycle = billingCycle) {
  const plan = BILLING_PLANS.find(item => item.id === planId);
  if (!plan?.price) return;
  return billingAction(target, async () => {
    const result = await billingRequest('pix', planId, cycle);
    const url = new URL(result.pix_url);
    if (url.protocol !== 'https:' || !['www.mercadopago.com.br','www.mercadopago.com'].includes(url.hostname) || url.username || url.password) throw new Error('Não foi possível abrir o Pix.');
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
  const assetLimit = info.asset_limit;
  if (kind === 'asset' && assetLimit !== null && info.assets >= assetLimit) {
    throw new Error('Limite de patrimônios atingido. Acesse Configurações → Planos e assinatura para aumentar seu limite.');
  }
}
