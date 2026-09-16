/* Sistema Patrimonial — JavaScript sem dependências */
const config = window.APP_CONFIG || {};
const state = { page: 'casas', houses: [], month: currentMonth(), gastos: [], pagamentos: [], documentos: [], selectedHouseId: null, session: readSession() };
const app = document.querySelector('#app');
const shell = document.querySelector('.app-shell');
const sessionKey = 'sistema-patrimonial-session';

document.querySelector('#today').textContent = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date());
document.querySelector('.menu-toggle').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
document.querySelectorAll('.nav-link').forEach(button => button.addEventListener('click', () => goTo(button.dataset.page)));
document.querySelector('#sign-out').addEventListener('click', signOut);
document.querySelector('#sign-out-sidebar').addEventListener('click', signOut);

function currentMonth() { return new Date().toISOString().slice(0, 7); }
function readSession() { try { return JSON.parse(localStorage.getItem('sistema-patrimonial-session')) || null; } catch { return null; } }
function saveSession(session) { state.session = session; localStorage.setItem(sessionKey, JSON.stringify(session)); }
function isoMonth(month) { return `${month}-01`; }
function money(value) { return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function dateTime(value) {
  if (!value) return '-';
  // Datas do Supabase sem horário (YYYY-MM-DD) não devem sofrer conversão de fuso.
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const [year, month, day] = String(value).split('-');
    return `${day}/${month}/${year}`;
  }
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
function houseName(house) { return `${house.rua}, ${house.numero}${house.complemento ? ` — ${house.complemento}` : ''}`; }
function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function configured() { return config.SUPABASE_URL && config.SUPABASE_ANON_KEY && !config.SUPABASE_URL.includes('SEU-PROJETO'); }
// Aceita tanto https://projeto.supabase.co quanto a URL REST usada no flow antigo
// (https://projeto.supabase.co/rest/v1/).
function supabaseBase() { return config.SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, ''); }

async function api(path, options = {}) {
  if (!configured()) throw new Error('Configure o arquivo config.js com a URL e a chave anon do Supabase.');
  const token = path.startsWith('/auth/v1') && !path.startsWith('/auth/v1/logout') ? config.SUPABASE_ANON_KEY : (state.session?.access_token || config.SUPABASE_ANON_KEY);
  const headers = { apikey: config.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, ...options.headers };
  const response = await fetch(`${supabaseBase()}${path}`, { ...options, headers });
  if (!response.ok) { const message = await response.text(); throw new Error(message || `Erro HTTP ${response.status}`); }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
function rest(table, query = '') { return `/rest/v1/${table}${query ? `?${query}` : ''}`; }
function jsonOptions(method, body, extra = {}) { return { method, headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) }; }
function notify(message, error = false) { const element = document.createElement('div'); element.className = `toast${error ? ' error' : ''}`; element.textContent = message; document.querySelector('#toast-region').append(element); setTimeout(() => element.remove(), 4200); }
function friendlyAuthError(error) {
  let data = {}; try { data = JSON.parse(error.message); } catch { /* A mensagem pode não estar no formato JSON. */ }
  const code = String(data.error_code || data.code || '').toLowerCase();
  const message = String(data.msg || data.message || error.message || '').toLowerCase();
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar.';
  if (code === 'user_already_exists' || message.includes('already registered') || message.includes('already been registered')) return 'Este e-mail já possui uma conta. Faça login.';
  if (code === 'weak_password' || message.includes('password should be')) return 'A senha precisa atender aos requisitos mínimos do Supabase.';
  if (message.includes('invalid email')) return 'Informe um endereço de e-mail válido.';
  if (message.includes('signup is disabled')) return 'O cadastro de novas contas está desativado no Supabase.';
  if (message.includes('rate limit') || message.includes('too many requests')) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  return 'Não foi possível concluir o acesso. Confira os dados e tente novamente.';
}
function setLoading(message = 'Carregando…') { app.innerHTML = `<div class="card empty">${message}</div>`; }
function showError(error) { app.innerHTML = `<div class="card empty">Não foi possível carregar os dados.<br><small>${esc(error.message)}</small></div>`; notify(error.message, true); }
function optionsHouses() { return state.houses.map(h => `<option value="${h.id}">#${h.id} — ${esc(houseName(h))}</option>`).join(''); }

async function goTo(page) {
  state.page = page;
  document.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelector('.sidebar').classList.remove('open');
  document.querySelector('#breadcrumb').textContent = page[0].toUpperCase() + page.slice(1);
  await refresh();
}
async function refresh() {
  try { setLoading(); if (state.page === 'casas') await loadCasas(); if (state.page === 'pagamentos') await loadPagamentos(); if (state.page === 'gastos') await loadGastos(); if (state.page === 'documentos') await loadDocumentos(); }
  catch (error) { showError(error); }
}
async function fetchHouses() { state.houses = await api(rest('casa', 'select=id,created_at,rua,numero,renda,valor_casa,complemento&order=id.desc')); return state.houses; }

function heading(eyebrow, title, subtitle, action = '') { return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${action}</div>`; }
async function loadCasas() {
  const houses = await fetchHouses();
  const income = houses.reduce((total, house) => total + Number(house.renda || 0), 0);
  app.innerHTML = heading('Patrimônio', 'Casas', 'Cadastre e acompanhe os imóveis da sua carteira.') + `
  <section class="summary"><div class="card metric"><span>Imóveis cadastrados</span><strong>${houses.length}</strong></div><div class="card metric"><span>Renda mensal estimada</span><strong>${money(income)}</strong></div><div class="card metric"><span>Último cadastro</span><strong>${houses[0] ? '#' + houses[0].id : '—'}</strong></div></section>
  <section class="card form-card"><h2 class="card-title">Cadastrar imóvel</h2><form id="house-form" class="form-grid"><div class="field"><label>Rua *</label><input name="rua" required></div><div class="field"><label>Número *</label><input name="numero" type="number" min="1" required></div><div class="field"><label>Complemento</label><input name="complemento"></div><div class="field"><label>Renda mensal *</label><input name="renda" type="number" min="0" step="0.01" required></div><div class="form-actions"><button class="button">Cadastrar</button></div></form></section>
  <section class="card table-card"><div class="table-head"><h2>Imóveis cadastrados</h2><button class="button secondary small" id="reload">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Endereço</th><th>Renda mensal</th><th>Cadastro</th><th></th></tr></thead><tbody>${houses.length ? houses.map(h => `<tr><td>#${h.id}</td><td><strong>${esc(h.rua)}, ${esc(h.numero)}</strong>${h.complemento ? `<br><small>${esc(h.complemento)}</small>` : ''}</td><td>${money(h.renda)}</td><td>${dateTime(h.created_at)}</td><td><button class="icon-button delete" data-delete-house="${h.id}">Excluir</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">Nenhuma casa cadastrada.</td></tr>'}</tbody></table></div></section>`;
  document.querySelector('#reload').onclick = refresh;
  injectHouseValueField();
  document.querySelector('#house-form').onsubmit = createHouse;
  app.querySelectorAll('[data-delete-house]').forEach(b => b.onclick = () => removeHouse(b.dataset.deleteHouse));
}
function propertyIcon() { return '<svg class="property-icon" viewBox="0 0 120 120" aria-hidden="true"><path d="M15 54 60 16l45 38v49H76V74a16 16 0 0 0-32 0v29H15Z"/></svg>'; }
async function selectProperty(id) { state.selectedHouseId = id; await loadCasas(); }
async function renderSelectedProperty() {
  const house = state.houses.find(item => item.id === state.selectedHouseId); const target = document.querySelector('#selected-property');
  if (!house || !target) return;
  try {
    const [payments, expenses, docs] = await Promise.all([
      api(rest('pagamentos_casa', `select=pago,data&casa_id=eq.${house.id}&order=data.desc`)),
      api(rest('gastos_casa', `select=descricao,categoria,valor,pago,data&casa_id=eq.${house.id}&order=data.desc`)),
      api(rest('documentos_casa', `select=id,nome_arquivo,tipo_arquivo,descricao,data_upload&casa_id=eq.${house.id}&order=data_upload.desc`))
    ]);
    const totalExpenses = expenses.reduce((total, item) => total + Number(item.valor || 0), 0);
    const paymentCount = payments.filter(item => item.pago).length;
    target.innerHTML = `<section class="property-summary"><div class="property-summary-title">${propertyIcon()}<div><p class="eyebrow">Casa ${house.id}</p><h2>${esc(houseName(house))}</h2><p>${house.complemento ? esc(house.complemento) + ' · ' : ''}Cadastrada em ${dateTime(house.created_at)}</p></div></div><button class="icon-button delete" data-delete-house="${house.id}">Excluir casa</button></section><section class="detail-metrics"><div class="card metric"><span>Renda mensal</span><strong class="${Number(house.renda) >= 0 ? 'income-positive' : 'income-negative'}">${money(house.renda)}</strong></div><div class="card metric"><span>Pagamentos recebidos</span><strong>${paymentCount}</strong></div><div class="card metric"><span>Gastos registrados</span><strong>${money(totalExpenses)}</strong></div><div class="card metric"><span>Documentos</span><strong>${docs.length}</strong></div></section><section class="property-panels"><article class="card property-panel"><h3>Últimos pagamentos</h3>${payments.length ? payments.slice(0, 4).map(item => `<div class="property-row"><span>${esc(String(item.data).slice(0, 7))}</span><span class="pill ${item.pago ? 'ok' : 'pending'}">${item.pago ? 'Recebido' : 'Pendente'}</span></div>`).join('') : '<p class="detail-empty">Nenhum pagamento registrado.</p>'}</article><article class="card property-panel"><h3>Últimos gastos</h3>${expenses.length ? expenses.slice(0, 4).map(item => `<div class="property-row"><span><strong>${esc(item.descricao)}</strong><small>${esc(item.categoria)}</small></span><span>${money(item.valor)}<small class="${item.pago ? 'text-ok' : 'text-pending'}">${item.pago ? 'Pago' : 'Pendente'}</small></span></div>`).join('') : '<p class="detail-empty">Nenhum gasto registrado.</p>'}</article><article class="card property-panel"><h3>Documentos</h3>${docs.length ? docs.slice(0, 4).map(item => `<div class="property-row"><span><strong title="${esc(item.nome_arquivo)}">${esc(shortFileName(item.nome_arquivo))}</strong><small>${esc(item.descricao || fileType(item.tipo_arquivo))}</small></span><button class="icon-button small" data-open-property-document="${item.id}">Abrir</button></div>`).join('') : '<p class="detail-empty">Nenhum documento enviado.</p>'}</article></section>`;
    target.querySelector('[data-delete-house]').onclick = () => removeHouse(house.id);
    target.querySelectorAll('[data-open-property-document]').forEach(button => button.onclick = () => openPropertyDocument(Number(button.dataset.openPropertyDocument)));
    const propertyValue = Number(house.valor_casa || 0);
    const receivedAmount = paymentCount * Number(house.renda || 0);
    const investment = propertyValue + totalExpenses;
    const remaining = Math.max(0, investment - receivedAmount);
    const monthsToPayoff = Number(house.renda) > 0 ? Math.ceil(remaining / Number(house.renda)) : null;
    const payoffText = remaining <= 0 ? 'O investimento já foi amortizado.' : monthsToPayoff === null ? 'Informe uma renda mensal positiva para calcular.' : `${monthsToPayoff} ${monthsToPayoff === 1 ? 'mês' : 'meses'} estimados`;
    target.insertAdjacentHTML('beforeend', `<section class="amortization-card card"><div><p class="eyebrow">Projeção financeira</p><h3>Amortização do imóvel</h3><p>Estimativa baseada no valor do imóvel, todos os gastos registrados e na renda mensal prevista.</p></div><div class="amortization-values"><span>Investido <strong>${money(investment)}</strong></span><span>Recebido <strong>${money(receivedAmount)}</strong></span><span>Falta amortizar <strong>${money(remaining)}</strong></span><span>Prazo <strong>${payoffText}</strong></span></div></section><section class="card edit-property"><div class="edit-property-head"><div><h3>Editar informações da casa</h3><p>Altere endereço, renda ou valor patrimonial.</p></div></div><form id="property-edit-form" class="form-grid"><div class="field"><label>Rua *</label><input name="rua" required value="${esc(house.rua)}"></div><div class="field"><label>Número *</label><input name="numero" type="number" min="1" required value="${esc(house.numero)}"></div><div class="field"><label>Complemento</label><input name="complemento" value="${esc(house.complemento || '')}"></div><div class="field"><label>Renda mensal *</label><input name="renda" type="number" min="0" step="0.01" required value="${esc(house.renda)}"></div><div class="field"><label>Valor da casa</label><input name="valor_casa" type="number" min="0" step="0.01" value="${house.valor_casa == null ? '' : esc(house.valor_casa)}"></div><div class="form-actions"><button class="button">Salvar alterações</button></div></form></section>`);
    target.querySelector('#property-edit-form').onsubmit = event => updateProperty(event, house.id);
  } catch (error) { target.innerHTML = `<div class="card empty">Não foi possível carregar as informações desta casa.<br><small>${esc(error.message)}</small></div>`; }
}
async function updateProperty(event, houseId) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await api(rest('casa', `id=eq.${houseId}`), jsonOptions('PATCH', { rua: data.rua.trim(), numero: Number(data.numero), complemento: data.complemento.trim() || null, renda: Number(data.renda), valor_casa: data.valor_casa === '' ? null : Number(data.valor_casa) }, { Prefer: 'return=minimal' }));
    notify('Informações da casa atualizadas.'); await loadCasas();
  } catch (error) { notify(error.message, true); }
}
async function openPropertyDocument(id) {
  try {
    const records = await api(rest('documentos_casa', `select=id,nome_arquivo,caminho_arquivo&casa_id=eq.${state.selectedHouseId}&id=eq.${id}`));
    const document = records[0];
    if (!document) throw new Error('Documento não encontrado ou sem permissão de acesso.');
    const data = await api(`/storage/v1/object/sign/documentos/${document.caminho_arquivo.split('/').map(encodeURIComponent).join('/')}`, jsonOptions('POST', { expiresIn: 3600 }));
    const signed = data.signedURL || data.signedUrl;
    if (!signed) throw new Error('Não foi possível gerar o link de visualização.');
    window.open(signed.startsWith('http') ? signed : `${supabaseBase()}/storage/v1${signed}`, '_blank', 'noopener');
  } catch (error) { notify(error.message, true); }
}
async function loadCasas() {
  const houses = await fetchHouses();
  if (!houses.some(item => item.id === state.selectedHouseId)) state.selectedHouseId = null;
  const income = houses.reduce((total, house) => total + Number(house.renda || 0), 0);
  app.innerHTML = heading('Patrimônio', 'Meus imóveis', 'Escolha uma casa para consultar todas as informações dela.', '<button class="button secondary" id="reload">Atualizar</button>') + `<section class="summary"><div class="card metric"><span>Imóveis cadastrados</span><strong>${houses.length}</strong></div><div class="card metric"><span>Renda mensal estimada</span><strong>${money(income)}</strong></div><div class="card metric"><span>Casa selecionada</span><strong>${state.selectedHouseId ? 'Casa ' + state.selectedHouseId : '—'}</strong></div></section><section class="property-picker"><div class="picker-heading"><div><p class="eyebrow">Seleção de imóvel</p><h2>Escolha uma casa</h2></div><p>Clique no ícone para abrir os detalhes.</p></div><div class="property-grid">${houses.length ? houses.map(house => `<button class="property-choice ${state.selectedHouseId === house.id ? 'selected' : ''}" data-property="${house.id}" aria-pressed="${state.selectedHouseId === house.id}">${propertyIcon()}<strong>CASA ${house.id}</strong><small>${esc(house.rua)}, ${esc(house.numero)}</small></button>`).join('') : '<div class="card empty">Você ainda não cadastrou nenhuma casa.</div>'}</div></section><div id="selected-property">${state.selectedHouseId ? '<div class="card empty">Carregando dados da casa…</div>' : '<section class="card property-empty"><div>⌂</div><h2>Selecione uma casa</h2><p>Os dados de endereço, renda, pagamentos, gastos e documentos aparecerão aqui.</p></section>'}</div><section class="card form-card"><h2 class="card-title">Cadastrar imóvel</h2><form id="house-form" class="form-grid"><div class="field"><label>Rua *</label><input name="rua" required></div><div class="field"><label>Número *</label><input name="numero" type="number" min="1" required></div><div class="field"><label>Complemento</label><input name="complemento"></div><div class="field"><label>Renda mensal *</label><input name="renda" type="number" min="0" step="0.01" required></div><div class="form-actions"><button class="button">Cadastrar</button></div></form></section>`;
  document.querySelector('#reload').onclick = refresh;
  const registrationCard = document.querySelector('#house-form')?.closest('.form-card');
  registrationCard?.remove();
  document.querySelector('.page-heading')?.insertAdjacentHTML('beforeend', '<button id="add-property" class="button">Adicionar casa</button>');
  document.querySelector('#add-property').onclick = openPropertyForm;
  app.querySelectorAll('[data-property]').forEach(button => button.onclick = () => selectProperty(Number(button.dataset.property)));
  await renderHomeCalendar();
  if (state.selectedHouseId) await renderSelectedProperty();
}
function openPropertyForm() {
  document.querySelector('#add-property-modal')?.remove();
  const modal = document.createElement('div'); modal.id = 'add-property-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<section class="modal property-modal"><button class="modal-close" type="button" aria-label="Fechar">×</button><p class="eyebrow">Novo imóvel</p><h2>Adicionar casa</h2><p>Preencha as informações do imóvel.</p><form id="add-property-form" class="form-grid"><div class="field"><label>Rua *</label><input name="rua" required></div><div class="field"><label>Número *</label><input name="numero" type="number" min="1" required></div><div class="field"><label>Complemento</label><input name="complemento"></div><div class="field"><label>Renda mensal *</label><input name="renda" type="number" min="0" step="0.01" required></div><div class="field"><label>Valor da casa</label><input name="valor_casa" type="number" min="0" step="0.01" placeholder="Ex.: 250000"></div><div class="modal-actions"><button type="button" class="button secondary modal-cancel">Cancelar</button><button class="button">Cadastrar</button></div></form></section>`;
  document.body.append(modal); modal.querySelector('#add-property-form').onsubmit = createHouse;
  modal.querySelectorAll('.modal-close,.modal-cancel').forEach(button => button.onclick = () => modal.remove());
}
function injectHouseValueField() {
  const form = document.querySelector('#house-form');
  if (!form || form.querySelector('[name="valor_casa"]')) return;
  const field = document.createElement('div'); field.className = 'field';
  field.innerHTML = '<label>Valor da casa</label><input name="valor_casa" type="number" min="0" step="0.01" placeholder="Ex.: 250000">';
  form.querySelector('.form-actions')?.before(field);
}
async function createHouse(event) { event.preventDefault(); const d = Object.fromEntries(new FormData(event.currentTarget)); try { await api(rest('casa'), jsonOptions('POST', { rua: d.rua.trim(), numero: Number(d.numero), complemento: d.complemento.trim() || null, renda: Number(d.renda), valor_casa: d.valor_casa === '' ? null : Number(d.valor_casa) }, { Prefer: 'return=minimal' })); document.querySelector('#add-property-modal')?.remove(); notify('Casa cadastrada com sucesso.'); refresh(); } catch (error) { notify(error.message, true); } }
async function renderHomeCalendar() {
  const picker = app.querySelector('.property-picker'); if (!picker) return;
  const today = new Date(); const month = currentMonth(); const start = `${month}-01`; const endDate = new Date(`${start}T12:00:00`); endDate.setMonth(endDate.getMonth() + 1); const end = isoMonth(endDate.toISOString().slice(0, 7));
  try {
    const [payments, expenses] = await Promise.all([
      api(rest('pagamentos_casa', `select=casa_id,data_pagamento&data_pagamento=gte.${start}&data_pagamento=lt.${end}&pago=eq.true`)),
      api(rest('gastos_casa', `select=casa_id,descricao,valor,data&data=gte.${start}&data=lt.${end}`))
    ]);
    const events = {};
    const addEvent = (date, label, type) => { if (!date) return; const day = Number(String(date).slice(8, 10)); if (!events[day]) events[day] = []; events[day].push({ label, type }); };
    payments.forEach(item => addEvent(item.data_pagamento, `Pagamento recebido · Casa ${item.casa_id}`, 'payment'));
    expenses.forEach(item => addEvent(item.data, `Gasto · ${item.descricao} (${money(item.valor)})`, 'expense'));
    const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate(); const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).getDay(); const blanks = Array.from({ length: firstDay }, () => '<div class="calendar-day blank"></div>').join('');
    const cells = Array.from({ length: days }, (_, index) => { const day = index + 1; return `<div class="calendar-day ${day === today.getDate() ? 'today' : ''}"><strong>${day}</strong>${(events[day] || []).map(event => `<span class="calendar-event ${event.type}" title="${esc(event.label)}">${esc(event.label)}</span>`).join('')}</div>`; }).join('');
    picker.insertAdjacentHTML('afterend', `<section class="calendar-card card"><div class="calendar-head"><div><p class="eyebrow">Visão geral</p><h2>Calendário de ${new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(today)}</h2></div><div class="calendar-legend"><span><i class="payment"></i>Recebidos</span><span><i class="expense"></i>Gastos</span></div></div><div class="calendar-weekdays"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div><div class="calendar-grid">${blanks}${cells}</div></section>`);
  } catch (error) { console.warn('Calendário indisponível:', error); }
}
async function removeHouse(id) { if (!confirm('Excluir esta casa? Registros relacionados podem impedir a operação.')) return; try { await api(rest('casa', `id=eq.${id}`), jsonOptions('DELETE', null, { Prefer: 'return=minimal' })); notify('Casa excluída.'); refresh(); } catch (error) { notify(error.message, true); } }

async function loadPagamentos() {
  await fetchHouses(); const date = isoMonth(state.month);
  let payments = await api(rest('pagamentos_casa', `select=casa_id,pago,data&data=eq.${date}&order=casa_id.asc`));
  if (state.month === currentMonth()) { const existing = new Set(payments.map(p => p.casa_id)); const missing = state.houses.filter(h => !existing.has(h.id)).map(h => ({ casa_id: h.id, pago: false, data: date })); if (missing.length) { await api(rest('pagamentos_casa'), jsonOptions('POST', missing, { Prefer: 'return=minimal,resolution=ignore-duplicates' })); payments = await api(rest('pagamentos_casa', `select=casa_id,pago,data&data=eq.${date}&order=casa_id.asc`)); } }
  state.pagamentos = payments; const paymentByHouse = new Map(payments.map(p => [p.casa_id, p])); const total = state.houses.filter(h => paymentByHouse.has(h.id)).reduce((sum, h) => sum + Number(h.renda || 0), 0); const paid = state.houses.filter(h => paymentByHouse.get(h.id)?.pago).reduce((sum, h) => sum + Number(h.renda || 0), 0);
  app.innerHTML = heading('Receitas', 'Pagamentos', 'Acompanhe a renda mensal recebida por imóvel.') + `<section class="summary"><div class="card metric"><span>Previsto no mês</span><strong>${money(total)}</strong></div><div class="card metric"><span>Recebido</span><strong>${money(paid)}</strong></div><div class="card metric"><span>Pendente</span><strong>${money(total - paid)}</strong></div></section><section class="card table-card"><div class="table-head"><h2>Controle mensal</h2><div class="toolbar"><label for="payment-month">Mês</label><input class="month-control" type="month" id="payment-month" value="${state.month}"><button id="reload" class="button secondary small">Atualizar</button></div></div><div class="table-wrap"><table><thead><tr><th>Casa</th><th>Renda</th><th>Mês</th><th>Status</th><th></th></tr></thead><tbody>${payments.length ? state.houses.filter(h => paymentByHouse.has(h.id)).map(h => { const p = paymentByHouse.get(h.id); return `<tr><td><strong>${esc(houseName(h))}</strong></td><td>${money(h.renda)}</td><td>${state.month}</td><td><span class="pill ${p.pago ? 'ok' : 'pending'}">${p.pago ? 'Recebido' : 'Pendente'}</span></td><td><button class="icon-button" data-payment="${h.id}" data-paid="${p.pago}">${p.pago ? 'Marcar pendente' : 'Marcar recebido'}</button></td></tr>`; }).join('') : `<tr><td colspan="5" class="empty">Não há pagamentos para este mês.${state.month !== currentMonth() ? ' Os registros são criados automaticamente apenas no mês atual.' : ''}</td></tr>`}</tbody></table></div></section>`;
  document.querySelector('#payment-month').onchange = e => { state.month = e.target.value; refresh(); }; document.querySelector('#reload').onclick = refresh;
  app.querySelectorAll('[data-payment]').forEach(b => b.onclick = () => setPayment(b.dataset.payment, b.dataset.paid !== 'true'));
}
async function setPayment(houseId, paid) { try { await api(rest('pagamentos_casa', `casa_id=eq.${houseId}&data=eq.${isoMonth(state.month)}`), jsonOptions('PATCH', { pago: paid }, { Prefer: 'return=minimal' })); notify(paid ? 'Pagamento marcado como recebido.' : 'Pagamento marcado como pendente.'); refresh(); } catch (error) { notify(error.message, true); } }

async function loadPagamentos() {
  await fetchHouses();
  const monthDate = isoMonth(state.month);
  const endpoint = `select=casa_id,pago,data,dia_vencimento,data_pagamento&data=eq.${monthDate}&order=casa_id.asc`;
  let payments = await api(rest('pagamentos_casa', endpoint));
  if (state.month === currentMonth()) {
    const existing = new Set(payments.map(item => item.casa_id));
    const missing = state.houses.filter(house => !existing.has(house.id)).map(house => ({ casa_id: house.id, pago: false, data: monthDate, dia_vencimento: 5 }));
    if (missing.length) { await api(rest('pagamentos_casa'), jsonOptions('POST', missing, { Prefer: 'return=minimal,resolution=ignore-duplicates' })); payments = await api(rest('pagamentos_casa', endpoint)); }
  }
  const map = new Map(payments.map(item => [item.casa_id, item]));
  const houses = state.houses.filter(house => map.has(house.id));
  const total = houses.reduce((sum, house) => sum + Number(house.renda || 0), 0);
  const received = houses.filter(house => map.get(house.id).pago).reduce((sum, house) => sum + Number(house.renda || 0), 0);
  app.innerHTML = heading('Receitas', 'Pagamentos', 'Edite o dia de vencimento e acompanhe os recebimentos.') + `<section class="summary"><div class="card metric"><span>Previsto no mês</span><strong>${money(total)}</strong></div><div class="card metric"><span>Recebido</span><strong>${money(received)}</strong></div><div class="card metric"><span>Pendente</span><strong>${money(total - received)}</strong></div></section><section class="card table-card"><div class="table-head"><h2>Controle mensal</h2><div class="toolbar"><label for="payment-month">Mês</label><input class="month-control" type="month" id="payment-month" value="${state.month}"><button id="reload" class="button secondary small">Atualizar</button></div></div><div class="table-wrap"><table><thead><tr><th>Casa</th><th>Renda</th><th>Vencimento</th><th>Status</th><th>Recebido em</th><th></th></tr></thead><tbody>${houses.length ? houses.map(house => { const payment = map.get(house.id); return `<tr><td><strong>${esc(houseName(house))}</strong></td><td>${money(house.renda)}</td><td><label class="due-day">Dia <input type="number" min="1" max="31" value="${payment.dia_vencimento || 5}" data-due-house="${house.id}"></label></td><td><span class="pill ${payment.pago ? 'ok' : 'pending'}">${payment.pago ? 'Recebido' : 'Pendente'}</span></td><td>${payment.data_pagamento ? dateTime(payment.data_pagamento) : '—'}</td><td><button class="icon-button" data-payment="${house.id}" data-paid="${payment.pago}">${payment.pago ? 'Marcar pendente' : 'Marcar recebido'}</button></td></tr>`; }).join('') : '<tr><td colspan="6" class="empty">Não há pagamentos neste mês.</td></tr>'}</tbody></table></div></section>`;
  document.querySelector('#payment-month').onchange = event => { state.month = event.target.value; refresh(); };
  document.querySelector('#reload').onclick = refresh;
  app.querySelectorAll('[data-payment]').forEach(button => button.onclick = () => updatePaymentStatus(button.dataset.payment, button.dataset.paid !== 'true'));
  app.querySelectorAll('[data-due-house]').forEach(input => input.onchange = () => updatePaymentDueDay(input.dataset.dueHouse, input.value));
}
async function updatePaymentStatus(houseId, paid) { try { await api(rest('pagamentos_casa', `casa_id=eq.${houseId}&data=eq.${isoMonth(state.month)}`), jsonOptions('PATCH', { pago: paid, data_pagamento: paid ? new Date().toISOString().slice(0, 10) : null }, { Prefer: 'return=minimal' })); notify(paid ? 'Pagamento marcado como recebido.' : 'Pagamento marcado como pendente.'); refresh(); } catch (error) { notify(error.message, true); } }
async function updatePaymentDueDay(houseId, rawDay) { const day = Number(rawDay); if (!Number.isInteger(day) || day < 1 || day > 31) return notify('Informe um dia entre 1 e 31.', true); try { await api(rest('pagamentos_casa', `casa_id=eq.${houseId}&data=eq.${isoMonth(state.month)}`), jsonOptions('PATCH', { dia_vencimento: day }, { Prefer: 'return=minimal' })); notify(`Vencimento alterado para o dia ${day}.`); refresh(); } catch (error) { notify(error.message, true); } }

async function loadGastos() {
  await fetchHouses(); const start = isoMonth(state.month); const next = new Date(`${start}T12:00:00`); next.setMonth(next.getMonth() + 1); const end = isoMonth(next.toISOString().slice(0, 7));
  const gastos = await api(rest('gastos_casa', `select=id,casa_id,descricao,categoria,valor,pago,recorrente,data&data=gte.${start}&data=lt.${end}&order=data.desc`)); state.gastos = gastos; const houseMap = new Map(state.houses.map(h => [h.id, h])); const total = gastos.reduce((sum, g) => sum + Number(g.valor), 0); const paid = gastos.filter(g => g.pago).reduce((sum, g) => sum + Number(g.valor), 0);
  app.innerHTML = heading('Despesas', 'Gastos', 'Registre despesas e marque o que já foi pago.') + `<section class="summary"><div class="card metric"><span>Total no mês</span><strong>${money(total)}</strong></div><div class="card metric"><span>Pago</span><strong>${money(paid)}</strong></div><div class="card metric"><span>Em aberto</span><strong>${money(total-paid)}</strong></div></section><section class="card form-card"><h2 class="card-title">Novo gasto</h2><form id="expense-form" class="form-grid"><div class="field"><label>Casa *</label><select name="casa_id" required><option value="">Selecione</option>${optionsHouses()}</select></div><div class="field"><label>Descrição *</label><input name="descricao" required></div><div class="field"><label>Categoria *</label><input name="categoria" placeholder="Ex.: manutenção" required></div><div class="field"><label>Valor *</label><input name="valor" type="number" min="0.01" step="0.01" required></div><div class="field"><label><input name="recorrente" type="checkbox"> Gasto recorrente</label></div><div class="form-actions"><button class="button">Salvar gasto</button></div></form></section><section class="card table-card"><div class="table-head"><h2>Gastos do mês</h2><div class="toolbar"><label for="expense-month">Mês</label><input class="month-control" type="month" id="expense-month" value="${state.month}"><button id="reload" class="button secondary small">Atualizar</button></div></div><div class="table-wrap"><table><thead><tr><th>Casa</th><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Status</th><th></th></tr></thead><tbody>${gastos.length ? gastos.map(g => `<tr><td>${esc(houseMap.has(g.casa_id) ? houseName(houseMap.get(g.casa_id)) : `Casa #${g.casa_id}`)}</td><td><strong>${esc(g.descricao)}</strong>${g.recorrente ? '<br><span class="pill recurring">Recorrente</span>' : ''}</td><td>${esc(g.categoria)}</td><td>${money(g.valor)}</td><td><span class="pill ${g.pago ? 'ok' : 'pending'}">${g.pago ? 'Pago' : 'Pendente'}</span></td><td><div class="action-row"><button class="icon-button" data-expense-paid="${g.id}" data-paid="${g.pago}">${g.pago ? 'Desfazer' : 'Pagar'}</button><button class="icon-button delete" data-delete-expense="${g.id}">Excluir</button></div></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhum gasto neste mês.</td></tr>'}</tbody></table></div></section>`;
  document.querySelector('#expense-form').onsubmit = createExpense; document.querySelector('#expense-month').onchange = e => { state.month = e.target.value; refresh(); }; document.querySelector('#reload').onclick = refresh;
  app.querySelectorAll('[data-expense-paid]').forEach(b => b.onclick = () => patchExpense(b.dataset.expensePaid, b.dataset.paid !== 'true')); app.querySelectorAll('[data-delete-expense]').forEach(b => b.onclick = () => deleteExpense(b.dataset.deleteExpense));
}
async function createExpense(event) { event.preventDefault(); const d = Object.fromEntries(new FormData(event.currentTarget)); try { await api(rest('gastos_casa'), jsonOptions('POST', { casa_id: Number(d.casa_id), descricao: d.descricao.trim(), categoria: d.categoria.trim(), valor: Number(d.valor), recorrente: d.recorrente === 'on', pago: false, data: isoMonth(state.month) }, { Prefer: 'return=minimal' })); notify('Gasto cadastrado.'); refresh(); } catch (error) { notify(error.message, true); } }
async function patchExpense(id, paid) { try { await api(rest('gastos_casa', `id=eq.${id}`), jsonOptions('PATCH', { pago: paid }, { Prefer: 'return=minimal' })); notify('Status atualizado.'); refresh(); } catch (error) { notify(error.message, true); } }
async function deleteExpense(id) { if (!confirm('Excluir este gasto?')) return; try { await api(rest('gastos_casa', `id=eq.${id}`), jsonOptions('DELETE', null, { Prefer: 'return=minimal' })); notify('Gasto excluído.'); refresh(); } catch (error) { notify(error.message, true); } }

async function loadDocumentos() {
  await fetchHouses(); const docs = await api(rest('documentos_casa', 'select=id,casa_id,nome_arquivo,tipo_arquivo,tamanho,caminho_arquivo,descricao,data_upload&order=data_upload.desc')); state.documentos = docs; const houseMap = new Map(state.houses.map(h => [h.id, h]));
  app.innerHTML = heading('Arquivos', 'Documentos', 'Armazene contratos, fotos e comprovantes de cada imóvel.') + `<section class="card form-card"><h2 class="card-title">Enviar documento</h2><form id="document-form" class="form-grid two"><div class="field"><label>Casa *</label><select name="casa_id" required><option value="">Selecione</option>${optionsHouses()}</select></div><div class="field"><label>Arquivo *</label><input name="file" type="file" accept="application/pdf,image/png,image/jpeg" required></div><div class="field"><label>Descrição</label><input name="descricao" placeholder="Ex.: contrato de locação"></div><div class="form-actions"><button class="button">Enviar arquivo</button></div></form><p class="upload-note">Formatos permitidos: PDF, PNG e JPEG. Tamanho máximo: 10 MB.</p></section><section class="card table-card"><div class="table-head"><h2>Documentos armazenados</h2><button id="reload" class="button secondary small">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>Casa</th><th>Arquivo</th><th>Descrição</th><th>Tipo</th><th>Enviado em</th><th></th></tr></thead><tbody>${docs.length ? docs.map(d => `<tr><td>${esc(houseMap.has(d.casa_id) ? houseName(houseMap.get(d.casa_id)) : `Casa #${d.casa_id}`)}</td><td title="${esc(d.nome_arquivo)}"><strong>${esc(shortFileName(d.nome_arquivo))}</strong><br><small>${Math.ceil(Number(d.tamanho || 0) / 1024)} KB</small></td><td>${esc(d.descricao || '—')}</td><td>${esc(fileType(d.tipo_arquivo))}</td><td>${dateTime(d.data_upload)}</td><td><div class="action-row"><button class="icon-button" data-open-doc="${d.id}">Abrir</button><button class="icon-button delete" data-delete-doc="${d.id}">Excluir</button></div></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhum documento enviado.</td></tr>'}</tbody></table></div></section>`;
  document.querySelector('#document-form').onsubmit = uploadDocument; document.querySelector('#reload').onclick = refresh; app.querySelectorAll('[data-open-doc]').forEach(b => b.onclick = () => openDocument(b.dataset.openDoc)); app.querySelectorAll('[data-delete-doc]').forEach(b => b.onclick = () => deleteDocument(b.dataset.deleteDoc));
}
function fileType(type) { return ({ 'application/pdf': 'PDF', 'image/png': 'PNG', 'image/jpeg': 'JPEG' })[type] || type; }
function shortFileName(name) { return name.length > 20 ? `${name.slice(0, 20)}…` : name; }
function safeFileName(name) { return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_'); }
async function uploadDocument(event) { event.preventDefault(); const d = new FormData(event.currentTarget); const file = d.get('file'); if (!file || file.size > 10 * 1024 * 1024) return notify('Escolha um arquivo de até 10 MB.', true); const houseId = Number(d.get('casa_id')); const path = `casas/${houseId}/${Date.now()}_${safeFileName(file.name)}`; try { await api(`/storage/v1/object/documentos/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { 'Content-Type': file.type, 'Cache-Control': '3600', 'x-upsert': 'false' }, body: file }); await api(rest('documentos_casa'), jsonOptions('POST', { casa_id: houseId, nome_arquivo: file.name, tipo_arquivo: file.type, tamanho: file.size, caminho_arquivo: path, descricao: d.get('descricao').trim() || null }, { Prefer: 'return=minimal' })); notify('Documento enviado.'); refresh(); } catch (error) { notify(error.message, true); } }
async function openDocument(id) { const doc = state.documentos.find(d => String(d.id) === String(id)); if (!doc) return; try { const data = await api(`/storage/v1/object/sign/documentos/${doc.caminho_arquivo.split('/').map(encodeURIComponent).join('/')}`, jsonOptions('POST', { expiresIn: 3600 })); const signed = data.signedURL || data.signedUrl; if (!signed) throw new Error('O Supabase não retornou uma URL de visualização.'); window.open(signed.startsWith('http') ? signed : `${supabaseBase()}/storage/v1${signed}`, '_blank', 'noopener'); } catch (error) { notify(error.message, true); } }
async function deleteDocument(id) { const doc = state.documentos.find(d => String(d.id) === String(id)); if (!doc || !confirm(`Excluir o documento “${doc.nome_arquivo}”?`)) return; try { await api(`/storage/v1/object/documentos/${doc.caminho_arquivo.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }); await api(rest('documentos_casa', `id=eq.${id}`), jsonOptions('DELETE', null, { Prefer: 'return=minimal' })); notify('Documento excluído.'); refresh(); } catch (error) { notify(error.message, true); } }

function renderAuth(mode = 'login') {
  shell.classList.add('hidden');
  document.querySelector('#sign-out').classList.add('hidden');
  document.querySelector('#auth-screen')?.remove();
  const registering = mode === 'register';
  const auth = document.createElement('section');
  auth.id = 'auth-screen'; auth.className = 'auth-page';
  auth.innerHTML = `<div class="auth-card"><div class="auth-brand"><img class="site-logo" src="assets/logo-facilitei.png" alt="Facilitei"> Sistema Patrimonial</div><h1>${registering ? 'Criar conta' : 'Bem-vindo de volta'}</h1><p>${registering ? 'Use seu e-mail para criar o acesso ao sistema.' : 'Entre para acessar sua gestão patrimonial.'}</p><form id="auth-form" class="auth-form"><div class="field"><label>E-mail</label><input name="email" type="email" autocomplete="email" required></div><div class="field"><label>Senha</label><input name="password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" minlength="6" required></div>${registering ? '<div class="field"><label>Confirmar senha</label><input name="confirmation" type="password" autocomplete="new-password" minlength="6" required></div>' : ''}<button class="button">${registering ? 'Criar conta' : 'Entrar'}</button></form><p class="auth-switch">${registering ? 'Já possui uma conta?' : 'Ainda não possui uma conta?'} <button id="auth-switch" type="button">${registering ? 'Entrar' : 'Criar conta'}</button></p></div>`;
  document.body.append(auth);
  auth.querySelector('#auth-switch').onclick = () => renderAuth(registering ? 'login' : 'register');
  auth.querySelector('#auth-form').onsubmit = event => submitAuth(event, mode);
}
async function submitAuth(event, mode) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  if (mode === 'register' && data.password !== data.confirmation) return notify('As senhas não coincidem.', true);
  try {
    const endpoint = mode === 'register' ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password';
    const response = await api(endpoint, jsonOptions('POST', { email: data.email.trim(), password: data.password }));
    if (mode === 'register' && !response.access_token) { notify('Conta criada. Confirme o e-mail enviado pelo Supabase para entrar.'); renderAuth('login'); return; }
    if (!response.access_token) throw new Error('O Supabase não retornou uma sessão válida.');
    saveSession(response); await openApplication(); notify(mode === 'register' ? 'Conta criada e acesso liberado.' : 'Login realizado.');
  } catch (error) { notify(friendlyAuthError(error), true); }
}
async function openApplication() {
  document.querySelector('#auth-screen')?.remove(); shell.classList.remove('hidden'); document.querySelector('#sign-out').classList.remove('hidden'); await refresh();
}
async function signOut() {
  try { if (configured() && state.session?.access_token) await api('/auth/v1/logout', { method: 'POST' }); } catch { /* A sessão local ainda deve ser encerrada. */ }
  localStorage.removeItem(sessionKey); state.session = null; renderAuth();
}
async function restoreSession() {
  if (!state.session?.refresh_token || !configured()) return false;
  try { const session = await api('/auth/v1/token?grant_type=refresh_token', jsonOptions('POST', { refresh_token: state.session.refresh_token })); saveSession(session); return true; }
  catch { localStorage.removeItem(sessionKey); state.session = null; return false; }
}
async function renderHomeCalendar() {
  const picker = app.querySelector('.property-picker'); if (!picker) return;
  const today = new Date(); const month = currentMonth(); const start = `${month}-01`; const next = new Date(`${start}T12:00:00`); next.setMonth(next.getMonth() + 1); const end = isoMonth(next.toISOString().slice(0, 7));
  try {
    const [payments, expenses] = await Promise.all([api(rest('pagamentos_casa', `select=casa_id,data_pagamento&data_pagamento=gte.${start}&data_pagamento=lt.${end}&pago=eq.true`)), api(rest('gastos_casa', `select=casa_id,descricao,valor,data&data=gte.${start}&data=lt.${end}`))]);
    const events = {}; const add = (date, label, type) => { if (!date) return; const day = Number(String(date).slice(8, 10)); (events[day] ||= []).push({ label, type }); };
    payments.forEach(item => add(item.data_pagamento, `Pagamento recebido · Casa ${item.casa_id}`, 'payment')); expenses.forEach(item => add(item.data, `Gasto · ${item.descricao} (${money(item.valor)})`, 'expense'));
    const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate(); const first = new Date(today.getFullYear(), today.getMonth(), 1).getDay(); const blanks = Array.from({ length: first }, () => '<div class="calendar-day blank"></div>').join('');
    const cells = Array.from({ length: days }, (_, index) => { const day = index + 1; return `<button type="button" class="calendar-day ${day === today.getDate() ? 'today' : ''}" data-calendar-day="${day}"><strong>${day}</strong>${(events[day] || []).map(event => `<span class="calendar-event ${event.type}" title="${esc(event.label)}">${esc(event.label)}</span>`).join('')}</button>`; }).join('');
    picker.insertAdjacentHTML('beforebegin', `<section class="calendar-card card"><div class="calendar-head"><div><p class="eyebrow">Visão geral</p><h2>Calendário de ${new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(today)}</h2></div><div class="calendar-legend"><span><i class="payment"></i>Recebidos</span><span><i class="expense"></i>Gastos</span></div></div><div class="calendar-weekdays"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div><div class="calendar-grid">${blanks}${cells}</div><div id="calendar-day-details" class="calendar-day-details">Clique em um dia para ver os lançamentos.</div></section>`);
    const calendar = app.querySelector('.calendar-card'); const details = app.querySelector('#calendar-day-details');
    if (calendar && details) { const layout = document.createElement('section'); layout.className = 'calendar-layout'; calendar.before(layout); layout.append(calendar); layout.append(details); }
    app.querySelectorAll('[data-calendar-day]').forEach(button => button.onclick = () => showCalendarDay(Number(button.dataset.calendarDay), events[Number(button.dataset.calendarDay)], today));
  } catch (error) { console.warn('Calendário indisponível:', error); }
}
function showCalendarDay(day, events, referenceDate) { const target = document.querySelector('#calendar-day-details'); if (!target) return; const label = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' }).format(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), day)); target.innerHTML = events?.length ? `<strong>${label}</strong>${events.map(event => `<span class="calendar-detail ${event.type}">${esc(event.label)}</span>`).join('')}` : `<strong>${label}</strong><span>Nenhum gasto ou pagamento recebido neste dia.</span>`; }
async function boot() { if (await restoreSession()) await openApplication(); else renderAuth(); }

boot();
