/* Sistema Patrimonial — JavaScript sem dependências */
const config = window.APP_CONFIG || {};
const state = { page: 'casas', houses: [], month: currentMonth(), gastos: [], pagamentos: [], documentos: [], session: readSession() };
const app = document.querySelector('#app');
const shell = document.querySelector('.app-shell');
const sessionKey = 'sistema-patrimonial-session';

document.querySelector('#today').textContent = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date());
document.querySelector('.menu-toggle').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
document.querySelectorAll('.nav-link').forEach(button => button.addEventListener('click', () => goTo(button.dataset.page)));
document.querySelector('#sign-out').addEventListener('click', signOut);

function currentMonth() { return new Date().toISOString().slice(0, 7); }
function readSession() { try { return JSON.parse(localStorage.getItem('sistema-patrimonial-session')) || null; } catch { return null; } }
function saveSession(session) { state.session = session; localStorage.setItem(sessionKey, JSON.stringify(session)); }
function isoMonth(month) { return `${month}-01`; }
function money(value) { return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function dateTime(value) { return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '-'; }
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
async function fetchHouses() { state.houses = await api(rest('casa', 'select=id,created_at,rua,numero,renda,complemento&order=id.desc')); return state.houses; }

function heading(eyebrow, title, subtitle, action = '') { return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${action}</div>`; }
async function loadCasas() {
  const houses = await fetchHouses();
  const income = houses.reduce((total, house) => total + Number(house.renda || 0), 0);
  app.innerHTML = heading('Patrimônio', 'Casas', 'Cadastre e acompanhe os imóveis da sua carteira.') + `
  <section class="summary"><div class="card metric"><span>Imóveis cadastrados</span><strong>${houses.length}</strong></div><div class="card metric"><span>Renda mensal estimada</span><strong>${money(income)}</strong></div><div class="card metric"><span>Último cadastro</span><strong>${houses[0] ? '#' + houses[0].id : '—'}</strong></div></section>
  <section class="card form-card"><h2 class="card-title">Cadastrar imóvel</h2><form id="house-form" class="form-grid"><div class="field"><label>Rua *</label><input name="rua" required></div><div class="field"><label>Número *</label><input name="numero" type="number" min="1" required></div><div class="field"><label>Complemento</label><input name="complemento"></div><div class="field"><label>Renda mensal *</label><input name="renda" type="number" min="0" step="0.01" required></div><div class="form-actions"><button class="button">Cadastrar</button></div></form></section>
  <section class="card table-card"><div class="table-head"><h2>Imóveis cadastrados</h2><button class="button secondary small" id="reload">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Endereço</th><th>Renda mensal</th><th>Cadastro</th><th></th></tr></thead><tbody>${houses.length ? houses.map(h => `<tr><td>#${h.id}</td><td><strong>${esc(h.rua)}, ${esc(h.numero)}</strong>${h.complemento ? `<br><small>${esc(h.complemento)}</small>` : ''}</td><td>${money(h.renda)}</td><td>${dateTime(h.created_at)}</td><td><button class="icon-button delete" data-delete-house="${h.id}">Excluir</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">Nenhuma casa cadastrada.</td></tr>'}</tbody></table></div></section>`;
  document.querySelector('#reload').onclick = refresh;
  document.querySelector('#house-form').onsubmit = createHouse;
  app.querySelectorAll('[data-delete-house]').forEach(b => b.onclick = () => removeHouse(b.dataset.deleteHouse));
}
async function createHouse(event) { event.preventDefault(); const d = Object.fromEntries(new FormData(event.currentTarget)); try { await api(rest('casa'), jsonOptions('POST', { rua: d.rua.trim(), numero: Number(d.numero), complemento: d.complemento.trim() || null, renda: Number(d.renda) }, { Prefer: 'return=minimal' })); notify('Casa cadastrada com sucesso.'); refresh(); } catch (error) { notify(error.message, true); } }
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
async function boot() { if (await restoreSession()) await openApplication(); else renderAuth(); }

boot();
