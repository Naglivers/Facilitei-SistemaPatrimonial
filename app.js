/* Sistema Patrimonial — JavaScript sem dependências */
const config = window.APP_CONFIG || {};
const state = { page: 'casas', houses: [], month: currentMonth(), gastos: [], pagamentos: [], documentos: [], selectedHouseId: null, session: readSession() };
const app = document.querySelector('#app');
const shell = document.querySelector('.app-shell');
const sessionKey = 'sistema-patrimonial-session';
let sessionExpiryTimer;

document.querySelector('#today').textContent = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date());
document.querySelector('.menu-toggle').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
document.querySelectorAll('.nav-link[data-page]').forEach(button => button.addEventListener('click', () => goTo(button.dataset.page)));
document.querySelector('#sign-out').addEventListener('click', signOut);
document.querySelector('#sign-out-sidebar').addEventListener('click', signOut);
updateProfileNav();

function currentMonth() { return new Date().toISOString().slice(0, 7); }
function readSession() { try { return JSON.parse(localStorage.getItem('sistema-patrimonial-session')) || null; } catch { return null; } }
function jwtExpiry(session) {
  if (Number(session?.expires_at)) return Number(session.expires_at) * 1000;
  try { const payload = JSON.parse(atob(String(session?.access_token || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return Number(payload.exp || 0) * 1000; } catch { return 0; }
}
function endExpiredSession() {
  clearTimeout(sessionExpiryTimer); localStorage.removeItem(sessionKey); state.session = null; renderAuth(); notify('Sua sessão expirou. Entre novamente para continuar.', true);
}
function scheduleSessionExpiry(session) {
  clearTimeout(sessionExpiryTimer); const expiry = jwtExpiry(session); if (!expiry) return;
  sessionExpiryTimer = setTimeout(endExpiredSession, Math.max(0, expiry - Date.now()));
}
function saveSession(session) { state.session = session; localStorage.setItem(sessionKey, JSON.stringify(session)); updateProfileNav(session?.user); scheduleSessionExpiry(session); }
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
  const isPublicAuth = path === '/auth/v1/signup' || path.startsWith('/auth/v1/token?');
  const token = isPublicAuth ? config.SUPABASE_ANON_KEY : (state.session?.access_token || config.SUPABASE_ANON_KEY);
  const headers = { apikey: config.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, ...options.headers };
  const response = await fetch(`${supabaseBase()}${path}`, { ...options, headers });
  if (!response.ok) { const text = await response.text(); let message = text; try { const data = JSON.parse(text); message = data.message || data.error || text; } catch { /* Resposta sem JSON. */ } if (response.status === 401 && state.session?.access_token) endExpiredSession(); throw new Error(message || `Erro HTTP ${response.status}`); }
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
  document.querySelector('#breadcrumb').textContent = page === 'configuracoes' ? 'Configurações' : page === 'perfil' ? 'Meu perfil' : page === 'assinaturas' ? 'Assinaturas' : page === 'contabilidade' ? 'Contabilidade' : page === 'relatorios' ? 'Relatórios' : page[0].toUpperCase() + page.slice(1);
  await refresh();
}
async function refresh() {
  document.documentElement.dataset.page = state.page;
  if (state.page === 'perfil') { await renderProfile(); return; }
  if (state.page === 'suporte') { await renderSupport(); return; }
  if (state.page === 'admin') { await renderAdminTickets(); return; }
  if (state.page === 'configuracoes') { renderSettings(); return; }
  if (state.page === 'assinaturas') { renderSubscriptions(); return; }
  if (state.page === 'contabilidade') { await renderAccounting(); return; }
  if (state.page === 'relatorios') { await renderReports(); return; }
  if (state.page === 'categorias') { await renderCategories(); return; }
  try { setLoading(); if (state.page === 'casas') { await loadCasas(); await appendPortfolioMetrics(); } if (state.page === 'pagamentos') await loadPagamentos(); if (state.page === 'gastos') { await loadGastos(); promoteFormToModal('#expense-form', 'Cadastrar gasto', 'add-expense', createExpense); await enhanceExpensePaymentDates(); } if (state.page === 'documentos') { await loadDocumentos(); promoteFormToModal('#document-form', 'Enviar documento', 'add-document', uploadDocument); } }
  catch (error) { showError(error); }
}
function profileName(user) {
  const value = user?.user_metadata?.nome || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Meu perfil';
  return String(value).trim() || 'Meu perfil';
}
function profileInitials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '●';
}
function updateProfileNav(user = state.session?.user) {
  const name = profileName(user);
  const avatar = document.querySelector('#profile-avatar');
  const navName = document.querySelector('#profile-nav-name');
  const navEmail = document.querySelector('#profile-nav-email');
  if (avatar) avatar.textContent = profileInitials(name);
  if (navName) navName.textContent = name;
  if (navEmail) navEmail.textContent = user?.email || 'Conta e assinatura';
  const adminNav = document.querySelector('.admin-nav');
  const isAdminEmail = String(user?.email || '').trim().toLowerCase() === 'lucasventura06@gmail.com';
  adminNav?.classList.toggle('hidden', !isAdminEmail);
}
async function getCurrentUser() {
  const user = await api('/auth/v1/user');
  if (!user?.id) throw new Error('Não foi possível carregar os dados da sua conta. Entre novamente.');
  if (state.session) saveSession({ ...state.session, user });
  return user;
}
function planLabel(plan) { return ({ free: 'Free', basico: 'Básico', pro: 'Pro' })[plan] || 'Free'; }
async function renderProfile() {
  setLoading('Carregando perfil…');
  try {
    const [user, plan] = await Promise.all([getCurrentUser(), readPlan()]);
    const meta = user.user_metadata || {};
    const name = profileName(user);
    const email = user.email || '';
    const phone = meta.telefone || meta.phone || '';
    const expires = plan.valid_until ? `Acesso pago até ${dateTime(plan.valid_until)}` : 'Plano sem mensalidade';
    app.innerHTML = heading('Conta', 'Meu perfil', 'Gerencie seus dados pessoais, acesso e assinatura.') + `
      <section class="profile-layout">
        <article class="card profile-summary"><span class="profile-avatar profile-avatar-large" aria-hidden="true">${esc(profileInitials(name))}</span><div><p class="eyebrow">Conta conectada</p><h2>${esc(name)}</h2><p>${esc(email)}</p></div></article>
        <article class="card profile-plan"><span>Plano atual</span><strong>${planLabel(plan.plan)}</strong><small>${esc(expires)}</small><button class="button secondary small" type="button" data-open-plans>Ver planos</button></article>
      </section>
      <section class="card profile-card"><div class="profile-card-head"><div><h2>Dados pessoais</h2><p>Essas informações ficam vinculadas à sua conta.</p></div></div>
        <form id="profile-form" class="profile-form" novalidate>
          <div class="field"><label for="profile-name">Nome</label><input id="profile-name" name="nome" autocomplete="name" maxlength="120" value="${esc(name)}" required></div>
          <div class="field"><label for="profile-phone">Telefone</label><input id="profile-phone" name="telefone" autocomplete="tel" inputmode="tel" maxlength="30" placeholder="(00) 00000-0000" value="${esc(phone)}"></div>
          <div class="field profile-email"><label for="profile-email">E-mail</label><input id="profile-email" name="email" type="email" autocomplete="email" maxlength="254" value="${esc(email)}" required><small>Ao alterar, o Supabase pode solicitar confirmação no novo e-mail.</small></div>
          <div class="profile-password"><h3>Alterar senha</h3><p>Deixe em branco para manter sua senha atual.</p><div class="form-grid two"><div class="field"><label for="profile-password">Nova senha</label><input id="profile-password" name="password" type="password" autocomplete="new-password" minlength="8" placeholder="Mínimo de 8 caracteres"></div><div class="field"><label for="profile-confirmation">Confirmar nova senha</label><input id="profile-confirmation" name="confirmation" type="password" autocomplete="new-password" minlength="8"></div></div></div>
          <div class="profile-actions"><button class="button" type="submit">Salvar alterações</button></div>
        </form>
      </section>`;
    app.querySelector('#profile-form').onsubmit = event => updateProfile(event, user);
    app.querySelector('[data-open-plans]').onclick = () => goTo('assinaturas');
  } catch (error) { showError(error); }
}
async function updateProfile(event, user) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const data = Object.fromEntries(new FormData(form));
  const nome = data.nome.trim();
  const telefone = data.telefone.trim();
  const email = data.email.trim().toLowerCase();
  if (!nome) return notify('Informe seu nome.', true);
  if (!email) return notify('Informe seu e-mail.', true);
  if (data.password && data.password.length < 8) return notify('A nova senha deve ter pelo menos 8 caracteres.', true);
  if (data.password !== data.confirmation) return notify('As senhas não coincidem.', true);
  const payload = { data: { ...(user.user_metadata || {}), nome, telefone: telefone || null } };
  if (email !== user.email) payload.email = email;
  if (data.password) payload.password = data.password;
  submit.disabled = true;
  try {
    const updated = await api('/auth/v1/user', jsonOptions('PUT', payload));
    if (state.session) saveSession({ ...state.session, user: updated });
    await renderProfile();
    notify(email !== user.email ? 'Dados atualizados. Confirme a alteração de e-mail nas mensagens recebidas, se solicitado.' : 'Perfil atualizado.');
  } catch (error) { notify(friendlyAuthError(error), true); }
  finally { submit.disabled = false; }
}
function renderSettings() {
  const dark = document.documentElement.dataset.theme === 'dark';
  app.innerHTML = heading('Preferências', 'Configurações', 'Personalize sua experiência no sistema.') + `
    <section class="card settings-card" aria-labelledby="appearance-title">
      <h2 id="appearance-title" class="card-title">Aparência</h2>
      <div class="settings-row">
        <div><h3 id="dark-mode-label">Modo escuro</h3><p id="dark-mode-description">Use cores escuras em todas as telas. Sua preferência é salva neste navegador.</p></div>
        <button class="theme-toggle" type="button" role="switch" aria-checked="${dark}" aria-labelledby="dark-mode-label" aria-describedby="dark-mode-description"><span class="theme-switch-knob" aria-hidden="true"></span></button>
      </div>
    </section><section id="billing-settings" class="billing-settings" aria-label="Planos e assinatura"><div class="billing-heading"><div><h2>Assinaturas</h2><p>Consulte seu plano atual sem sair das configurações.</p></div><button class="button secondary small" type="button" data-open-subscriptions>Ver assinaturas</button></div><p class="subtitle">Carregando seu plano…</p></section>`;
  const billingTarget = app.querySelector('#billing-settings');
  billingTarget.querySelector('[data-open-subscriptions]').onclick = () => goTo('assinaturas');
  renderBilling(billingTarget);
}
async function renderSupport() {
  const number = String(window.APP_CONFIG?.WHATSAPP_NUMBER || '').replace(/\D/g, '');
  const message = encodeURIComponent('Olá! Preciso de ajuda com o Sistema Patrimonial.');
  const whatsappUrl = number ? `https://wa.me/${number}?text=${message}` : '';
  try {
    const tickets = await api(rest('support_tickets', 'select=id,assunto,categoria,mensagem,status,created_at,updated_at&order=created_at.desc'));
    const ticketStatus = { aberto: 'Aberto', em_andamento: 'Em andamento', resolvido: 'Resolvido', fechado: 'Fechado' };
    app.innerHTML = heading('Atendimento', 'Suporte', 'Encontre orientações rápidas, fale conosco ou abra um ticket.') + `<section class="card support-hero"><div><p class="eyebrow">Precisa de ajuda?</p><h2>Fale com o suporte pelo WhatsApp</h2><p>Envie sua dúvida e informe, se possível, a tela em que ela aconteceu.</p></div>${whatsappUrl ? `<a class="button" href="${whatsappUrl}" target="_blank" rel="noopener">Abrir WhatsApp</a>` : '<span class="detail-empty">WhatsApp de suporte não configurado.</span>'}</section><section class="support-grid"><article class="card support-card"><h2>Patrimônios</h2><p>Cadastre casas, veículos e outros bens. Os detalhes de cada tipo aparecem no próprio formulário.</p></article><article class="card support-card"><h2>Receitas e gastos</h2><p>Use os lembretes e o calendário para receber ou pagar lançamentos pendentes.</p></article><article class="card support-card"><h2>Documentos e fotos</h2><p>Envie arquivos e imagens pelo patrimônio para manter tudo organizado no mesmo lugar.</p></article></section><section class="support-ticket-layout"><section class="card support-ticket-form"><h2>Abrir ticket</h2><p>Descreva sua dúvida ou problema para receber atendimento.</p><form id="support-ticket-form"><div class="field"><label>Assunto *</label><input name="assunto" maxlength="160" required placeholder="Ex.: Não consigo enviar um documento"></div><div class="field"><label>Categoria *</label><select name="categoria"><option value="geral">Dúvida geral</option><option value="conta">Conta e acesso</option><option value="pagamentos">Pagamentos e planos</option><option value="patrimonios">Patrimônios</option><option value="documentos">Documentos e fotos</option><option value="erro">Erro no sistema</option></select></div><div class="field"><label>Mensagem *</label><textarea name="mensagem" minlength="10" maxlength="4000" required placeholder="Conte o que aconteceu e em qual tela."></textarea></div><div class="modal-actions"><button class="button">Enviar ticket</button></div></form></section><section class="card support-ticket-list"><div class="table-head"><h2>Meus tickets</h2><button id="reload-tickets" class="button secondary small" type="button">Atualizar</button></div>${tickets.length ? `<div class="ticket-list">${tickets.map(ticket => `<article class="ticket-item"><div><span class="pill ticket-${esc(ticket.status)}">${esc(ticketStatus[ticket.status] || ticket.status)}</span><h3>#${ticket.id} · ${esc(ticket.assunto)}</h3><small>${dateTime(ticket.created_at)} · ${esc(ticket.categoria)}</small><p>${esc(ticket.mensagem)}</p></div></article>`).join('')}</div>` : '<p class="empty">Você ainda não abriu nenhum ticket.</p>'}</section></section>`;
    app.querySelectorAll('.ticket-item h3').forEach(title => { title.textContent = title.textContent.replace(/^#\d+\s*·\s*/, ''); });
    app.querySelector('#reload-tickets').onclick = renderSupport;
    app.querySelectorAll('.ticket-item').forEach((item, index) => {
      const open = () => openSupportTicket(tickets[index], ticketStatus);
      item.setAttribute('role', 'button'); item.tabIndex = 0; item.onclick = open;
      item.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } };
    });
    const ticketFormCard = app.querySelector('.support-ticket-form'); const ticketFormMarkup = ticketFormCard?.innerHTML; ticketFormCard?.remove();
    app.querySelector('.page-heading')?.insertAdjacentHTML('beforeend', '<button id="open-support-ticket" class="button" type="button">Abrir ticket</button>');
    app.querySelector('#open-support-ticket').onclick = () => {
      const modal = document.createElement('div'); modal.className = 'modal-backdrop'; modal.id = 'support-ticket-modal';
      modal.innerHTML = `<section class="modal property-modal support-ticket-modal"><button class="modal-close" type="button" aria-label="Fechar">×</button>${ticketFormMarkup}</section>`;
      document.body.append(modal); modal.querySelector('#support-ticket-form').onsubmit = createSupportTicket; modal.querySelector('.modal-close').onclick = () => modal.remove();
    };
  } catch (error) { app.innerHTML = heading('Atendimento', 'Suporte', 'Abra uma solicitação e acompanhe o atendimento por aqui.') + `<section class="card empty"><h2>Central de tickets aguardando configuração</h2><p>Rode a query de tickets no Supabase para ativar esta tela.</p></section>`; }
}
async function createSupportTicket(event) {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('.button'); const data = Object.fromEntries(new FormData(form));
  button.disabled = true;
  try { await api(rest('support_tickets'), jsonOptions('POST', { assunto: data.assunto.trim(), categoria: data.categoria, mensagem: data.mensagem.trim() }, { Prefer: 'return=minimal' })); notify('Ticket enviado. Você poderá acompanhar o status nesta aba.'); await renderSupport(); }
  catch (error) { notify(error.message, true); } finally { button.disabled = false; }
}
async function openSupportTicket(ticket, statusLabels) {
  if (!ticket) return;
  const modal = document.createElement('div'); modal.className = 'modal-backdrop'; modal.id = 'support-ticket-view-modal';
  modal.innerHTML = `<section class="modal property-modal support-ticket-modal"><button class="modal-close" type="button" aria-label="Fechar">×</button><p class="eyebrow">Solicitação de suporte</p><h2>${esc(ticket.assunto)}</h2><div class="ticket-view-meta"><span class="pill ticket-${esc(ticket.status)}">${esc(statusLabels[ticket.status] || ticket.status)}</span><span>${esc(ticket.categoria)}</span><span>Aberto em ${dateTime(ticket.created_at)}</span></div><p class="ticket-view-message">${esc(ticket.mensagem)}</p><div class="ticket-replies"><strong>Respostas do suporte</strong><p class="detail-empty">Carregando respostas…</p></div><div class="modal-actions"><button class="button secondary modal-cancel" type="button">Fechar</button></div></section>`;
  document.body.append(modal); modal.querySelectorAll('.modal-close,.modal-cancel').forEach(button => button.onclick = () => modal.remove());
  try { const replies = await api(rest('support_ticket_messages', `select=mensagem,is_admin,created_at&ticket_id=eq.${ticket.id}&order=created_at.asc`)); const target = modal.querySelector('.ticket-replies'); if (target) target.innerHTML = `<strong>Respostas do suporte</strong>${replies.length ? replies.map(reply => `<article class="ticket-reply ${reply.is_admin ? 'admin-reply' : ''}"><small>${reply.is_admin ? 'Suporte' : 'Você'} · ${dateTime(reply.created_at)}</small><p>${esc(reply.mensagem)}</p></article>`).join('') : '<p class="detail-empty">Ainda não há resposta para este ticket.</p>'}`; }
  catch (error) { modal.querySelector('.ticket-replies .detail-empty')?.replaceWith(Object.assign(document.createElement('p'), { className: 'detail-empty', textContent: 'Não foi possível carregar as respostas.' })); }
}
async function renderAdminTickets() {
  try {
    const tickets = await api(rest('support_tickets', 'select=id,assunto,categoria,mensagem,status,created_at,user_id&order=created_at.desc'));
    const labels = { aberto: 'Aberto', em_andamento: 'Em andamento', resolvido: 'Resolvido', fechado: 'Fechado' };
    app.innerHTML = heading('Atendimento', 'Administração de tickets', 'Responda as solicitações e atualize o status do atendimento.') + `<section class="summary"><article class="card metric"><span>Tickets abertos</span><strong>${tickets.filter(ticket => ticket.status === 'aberto').length}</strong></article><article class="card metric"><span>Em andamento</span><strong>${tickets.filter(ticket => ticket.status === 'em_andamento').length}</strong></article><article class="card metric"><span>Total</span><strong>${tickets.length}</strong></article></section><section class="card admin-ticket-list"><div class="table-head"><h2>Todos os tickets</h2><button id="reload-admin-tickets" class="button secondary small">Atualizar</button></div>${tickets.length ? `<div class="ticket-list">${tickets.map(ticket => `<article class="ticket-item admin-ticket"><div><span class="pill ticket-${esc(ticket.status)}">${esc(labels[ticket.status] || ticket.status)}</span><h3>#${ticket.id} · ${esc(ticket.assunto)}</h3><small>${dateTime(ticket.created_at)} · ${esc(ticket.categoria)}</small><p>${esc(ticket.mensagem)}</p><form class="admin-ticket-form" data-admin-ticket="${ticket.id}"><div class="field"><label>Status</label><select name="status">${Object.entries(labels).map(([value, label]) => `<option value="${value}" ${ticket.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="field"><label>Resposta</label><textarea name="mensagem" maxlength="4000" placeholder="Escreva uma resposta ao cliente"></textarea></div><button class="button small">Salvar e responder</button></form></div></article>`).join('')}</div>` : '<p class="empty">Nenhum ticket aberto.</p>'}</section>`;
    app.querySelectorAll('.admin-ticket h3').forEach(title => { title.textContent = title.textContent.replace(/^#\d+\s*·\s*/, ''); });
    app.querySelector('#reload-admin-tickets').onclick = renderAdminTickets; app.querySelectorAll('[data-admin-ticket]').forEach(form => form.onsubmit = sendAdminTicketReply);
  } catch (error) { app.innerHTML = heading('Atendimento', 'Administração de tickets', 'Acesso restrito ao administrador.') + `<section class="card empty"><h2>Sem acesso à central administrativa</h2><p>Cadastre sua conta como administradora na query de tickets para visualizar e responder solicitações.</p></section>`; }
}
async function sendAdminTicketReply(event) {
  event.preventDefault(); const form = event.currentTarget; const id = Number(form.dataset.adminTicket); const data = Object.fromEntries(new FormData(form)); const button = form.querySelector('.button'); button.disabled = true;
  try {
    await api(rest('support_tickets', `id=eq.${id}`), jsonOptions('PATCH', { status: data.status }, { Prefer: 'return=minimal' }));
    if (data.mensagem.trim()) await api(rest('support_ticket_messages'), jsonOptions('POST', { ticket_id: id, mensagem: data.mensagem.trim(), is_admin: true }, { Prefer: 'return=minimal' }));
    notify('Ticket atualizado.'); await renderAdminTickets();
  } catch (error) { notify(error.message, true); } finally { button.disabled = false; }
}
function renderSubscriptions() {
  app.innerHTML = heading('Plano', 'Assinaturas', 'Escolha seu plano e acompanhe pagamentos, Pix e renovação.') + '<section id="billing-settings" class="billing-settings" aria-label="Planos e assinatura"><p class="subtitle">Carregando seu plano…</p></section>';
  renderBilling(app.querySelector('#billing-settings'));
}
async function renderAccounting() {
  setLoading('Carregando dados para a contabilidade…');
  try {
    const rows = await api(rest('contabilidade_perfil', 'select=*&limit=1'));
    const data = rows[0] || {};
    app.innerHTML = heading('Organização fiscal', 'Contabilidade', 'Mantenha os dados essenciais prontos para compartilhar com seu contador.') + `
      <section class="summary accounting-summary"><article class="card metric"><span>Cadastro fiscal</span><strong>${data.razao_social ? 'Preenchido' : 'Pendente'}</strong></article><article class="card metric"><span>Regime tributário</span><strong>${esc(data.regime_tributario || 'Não informado')}</strong></article><article class="card metric"><span>Contato contábil</span><strong>${data.contador_nome ? 'Cadastrado' : 'Pendente'}</strong></article></section>
      <section class="card accounting-card"><div class="profile-card-head"><h2>Dados para o contador</h2><p>Informe somente dados do titular ou da empresa. Eles ficam privados na sua conta.</p></div>
      <form id="accounting-form" class="accounting-form"><div class="accounting-section"><h3>Identificação fiscal</h3><div class="form-grid two"><div class="field"><label>Nome ou razão social *</label><input name="razao_social" maxlength="180" required value="${esc(data.razao_social || '')}"></div><div class="field"><label>CPF ou CNPJ *</label><input name="documento_fiscal" inputmode="numeric" maxlength="18" required value="${esc(data.documento_fiscal || '')}"></div><div class="field"><label>Regime tributário</label><select name="regime_tributario"><option value="">Selecione</option>${['Pessoa física','MEI','Simples Nacional','Lucro Presumido','Lucro Real'].map(value => `<option ${data.regime_tributario === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="field"><label>Inscrição municipal/estadual</label><input name="inscricao" maxlength="60" value="${esc(data.inscricao || '')}"></div></div></div>
      <div class="accounting-section"><h3>Endereço fiscal</h3><div class="form-grid"><div class="field"><label>CEP</label><input name="cep" inputmode="numeric" maxlength="9" value="${esc(data.cep || '')}"></div><div class="field"><label>Logradouro</label><input name="logradouro" maxlength="160" value="${esc(data.logradouro || '')}"></div><div class="field"><label>Número</label><input name="numero" maxlength="20" value="${esc(data.numero || '')}"></div><div class="field"><label>Cidade / UF</label><input name="cidade_uf" maxlength="100" value="${esc(data.cidade_uf || '')}"></div></div></div>
      <div class="accounting-section"><h3>Contato da contabilidade</h3><div class="form-grid two"><div class="field"><label>Nome do contador ou escritório</label><input name="contador_nome" maxlength="160" value="${esc(data.contador_nome || '')}"></div><div class="field"><label>E-mail do contador</label><input name="contador_email" type="email" maxlength="254" value="${esc(data.contador_email || '')}"></div><div class="field"><label>Telefone</label><input name="contador_telefone" inputmode="tel" maxlength="30" value="${esc(data.contador_telefone || '')}"></div><div class="field"><label>Observações</label><input name="observacoes" maxlength="500" value="${esc(data.observacoes || '')}"></div></div></div><div class="profile-actions"><button class="button" type="submit">Salvar dados contábeis</button></div></form></section>`;
    app.querySelector('#accounting-form').onsubmit = saveAccounting;
  } catch (error) { showError(new Error('A tabela de contabilidade ainda não foi criada. Rode a query que vou te enviar depois desta tela.')); }
}
async function saveAccounting(event) {
  event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form));
  const payload = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value).trim() || null]));
  try { await api(rest('contabilidade_perfil'), jsonOptions('POST', payload, { Prefer: 'resolution=merge-duplicates,return=minimal' })); notify('Dados contábeis salvos.'); await renderAccounting(); }
  catch (error) { notify(error.message, true); }
}
async function fetchHouses() { state.houses = await api(rest('casa', 'select=id,created_at,rua,numero,valor_casa,complemento&order=id.desc')); return state.houses; }

function heading(eyebrow, title, subtitle, action = '') { return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${action}</div>`; }
async function appendPortfolioMetrics() {
  const summary = app.querySelector('.summary'); if (!summary) return;
  const [payments, expenses] = await Promise.all([api(rest('pagamentos_casa', 'select=valor,pago')), api(rest('gastos_casa', 'select=valor,pago'))]);
  const faturado = payments.reduce((sum, item) => sum + Number(item.valor || 0), 0); const received = payments.filter(item => item.pago).reduce((sum, item) => sum + Number(item.valor || 0), 0); const spent = expenses.filter(item => item.pago).reduce((sum, item) => sum + Number(item.valor || 0), 0); const profit = received - spent;
  summary.insertAdjacentHTML('beforeend', `<article class="card metric financial-metric revenue-metric"><span>Já faturado</span><strong>${money(faturado)}</strong><small>Receitas cadastradas</small></article><article class="card metric financial-metric expense-metric"><span>Já gasto</span><strong>− ${money(spent)}</strong><small>Gastos marcados como pagos</small></article><article class="card metric financial-metric ${profit < 0 ? 'expense-metric' : 'revenue-metric'}"><span>Já lucrado</span><strong>${profit < 0 ? '− ' : ''}${money(Math.abs(profit))}</strong><small>Recebido menos gastos pagos</small></article>`);
}
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
function assetLabel(asset) {
  const type = asset.tipo_patrimonio === 'casa' ? 'Casa' : asset.tipo_patrimonio === 'carro' ? 'Carro' : 'Outro';
  if (asset.tipo_patrimonio !== 'casa') return `${type}: ${asset.nome || 'Sem identificação'}`;
  const address = [asset.rua, asset.numero].filter(Boolean).join(', ') || asset.nome || 'Sem endereço';
  return `${type}: ${address}${asset.complemento ? ` - ${asset.complemento}` : ''}`;
}

function propertyIcon(type = 'casa') {
  if (type === 'carro') return '<svg class="property-icon asset-car-front-icon" viewBox="0 0 120 120" aria-hidden="true"><path d="M34 57 42 33q3-9 13-9h10q10 0 13 9l8 24Z"/><path d="M19 58h82q11 0 11 11v26H97v9a9 9 0 0 1-18 0v-9H41v9a9 9 0 0 1-18 0v-9H8V69q0-11 11-11Z"/><circle class="car-headlight" cx="32" cy="74" r="7"/><circle class="car-headlight" cx="88" cy="74" r="7"/></svg>';
  if (type === 'outro') return '<svg class="property-icon" viewBox="0 0 120 120" aria-hidden="true"><path d="m60 15 42 23v45l-42 23-42-23V38Z"/><path d="m18 38 42 24 42-24M60 62v44"/></svg>';
  return '<svg class="property-icon" viewBox="0 0 120 120" aria-hidden="true"><path d="M15 54 60 16l45 38v49H76V74a16 16 0 0 0-32 0v29H15Z"/></svg>';
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
async function deleteDocument(id) { const doc = state.documentos.find(d => String(d.id) === String(id)); if (!doc || !confirm(`Excluir o documento “${doc.nome_arquivo}”?`)) return; try { await api('/storage/v1/object/documentos', jsonOptions('DELETE', { prefixes: [doc.caminho_arquivo] })); await api(rest('documentos_casa', `id=eq.${id}`), jsonOptions('DELETE', null, { Prefer: 'return=minimal' })); notify('Documento excluído.'); refresh(); } catch (error) { notify(error.message, true); } }

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
  document.querySelector('#auth-screen')?.remove(); shell.classList.remove('hidden'); document.querySelector('#sign-out').classList.remove('hidden');
  const returning = new URLSearchParams(window.location.search).get('billing') === 'return';
  if (returning || window.location.hash === '#configuracoes') {
    if (returning) {
      try { await billingRequest('status'); } catch { notify('Pagamento em verificação. Atualize o status da assinatura em instantes.'); }
      const url = new URL(window.location.href); url.searchParams.delete('billing'); history.replaceState(null, '', url);
    }
    await goTo('configuracoes');
  } else await refresh();
}
async function signOut() {
  try { if (configured() && state.session?.access_token) await api('/auth/v1/logout', { method: 'POST' }); } catch { /* A sessão local ainda deve ser encerrada. */ }
  clearTimeout(sessionExpiryTimer); localStorage.removeItem(sessionKey); state.session = null; renderAuth();
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
    picker.insertAdjacentHTML('afterend', `<section class="calendar-card card"><div class="calendar-head"><div><p class="eyebrow">Visão geral</p><h2>Calendário de ${new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(today)}</h2></div><div class="calendar-legend"><span><i class="payment"></i>Recebidos</span><span><i class="expense"></i>Gastos</span></div></div><div class="calendar-weekdays"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div><div class="calendar-grid">${blanks}${cells}</div><div id="calendar-day-details" class="calendar-day-details">Clique em um dia para ver os lançamentos.</div></section>`);
    const calendar = app.querySelector('.calendar-card'); const details = app.querySelector('#calendar-day-details');
    if (calendar && details) { const layout = document.createElement('section'); layout.className = 'calendar-layout'; calendar.before(layout); layout.append(calendar); layout.append(details); }
    app.querySelectorAll('[data-calendar-day]').forEach(button => button.onclick = () => showCalendarDay(Number(button.dataset.calendarDay), events[Number(button.dataset.calendarDay)], today));
  } catch (error) { console.warn('Calendário indisponível:', error); }
}
function showCalendarDay(day, events, referenceDate) { const target = document.querySelector('#calendar-day-details'); if (!target) return; const label = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' }).format(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), day)); target.innerHTML = events?.length ? `<strong>${label}</strong>${events.map(event => `<span class="calendar-detail ${event.type}">${esc(event.label)}</span>`).join('')}` : `<strong>${label}</strong><span>Nenhum gasto ou pagamento recebido neste dia.</span>`; }
async function createHouse(event) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  try { await api(rest('casa'), jsonOptions('POST', { rua: data.rua.trim(), numero: Number(data.numero), complemento: data.complemento.trim() || null, valor_casa: data.valor_casa === '' ? null : Number(data.valor_casa) }, { Prefer: 'return=minimal' })); document.querySelector('#add-property-modal')?.remove(); notify('Casa cadastrada com sucesso.'); refresh(); } catch (error) { notify(error.message, true); }
}
function openPropertyForm() {
  document.querySelector('#add-property-modal')?.remove(); const modal = document.createElement('div'); modal.id = 'add-property-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<section class="modal property-modal"><button class="modal-close" type="button" aria-label="Fechar">×</button><p class="eyebrow">Novo imóvel</p><h2>Adicionar casa</h2><p>Preencha as informações do imóvel.</p><form id="add-property-form" class="form-grid"><div class="field"><label>Rua *</label><input name="rua" required></div><div class="field"><label>Número *</label><input name="numero" type="number" min="1" required></div><div class="field"><label>Complemento</label><input name="complemento"></div><div class="field"><label>Valor da casa</label><input name="valor_casa" type="number" min="0" step="0.01" placeholder="Ex.: 250000"></div><div class="modal-actions"><button type="button" class="button secondary modal-cancel">Cancelar</button><button class="button">Cadastrar</button></div></form></section>`;
  document.body.append(modal); modal.querySelector('#add-property-form').onsubmit = createHouse; modal.querySelectorAll('.modal-close,.modal-cancel').forEach(button => button.onclick = () => modal.remove());
}
async function loadCasas() {
  const houses = await fetchHouses(); if (!houses.some(house => house.id === state.selectedHouseId)) state.selectedHouseId = null;
  const portfolio = houses.reduce((sum, house) => sum + Number(house.valor_casa || 0), 0);
  app.innerHTML = heading('Patrimônio', 'Meus imóveis', 'Escolha uma casa para consultar todas as informações dela.', '<div class="heading-actions"><button id="reload" class="button secondary">Atualizar</button><button id="add-property" class="button">Adicionar casa</button></div>') + `<section class="summary"><div class="card metric"><span>Imóveis cadastrados</span><strong>${houses.length}</strong></div><div class="card metric"><span>Valor patrimonial</span><strong>${money(portfolio)}</strong></div><div class="card metric"><span>Casa selecionada</span><strong>${state.selectedHouseId ? 'Casa ' + state.selectedHouseId : '—'}</strong></div></section><section class="property-picker"><div class="picker-heading"><div><p class="eyebrow">Seleção de imóvel</p><h2>Escolha uma casa</h2></div><p>Clique no ícone para abrir os detalhes.</p></div><div class="property-grid">${houses.length ? houses.map(house => `<button class="property-choice ${state.selectedHouseId === house.id ? 'selected' : ''}" data-property="${house.id}">${propertyIcon()}<strong>CASA ${house.id}</strong><small>${esc(house.rua)}, ${esc(house.numero)}</small></button>`).join('') : '<div class="card empty">Você ainda não cadastrou nenhuma casa.</div>'}</div></section><div id="selected-property">${state.selectedHouseId ? '<div class="card empty">Carregando dados da casa…</div>' : '<section class="card property-empty"><div>⌂</div><h2>Selecione uma casa</h2><p>Os detalhes financeiros e documentos aparecerão aqui.</p></section>'}</div>`;
  document.querySelector('#reload').onclick = refresh; document.querySelector('#add-property').onclick = openPropertyForm;
  app.querySelectorAll('[data-property]').forEach(button => { const house = houses.find(item => item.id === Number(button.dataset.property)); if (house) { button.querySelector('strong').textContent = house.rua; button.querySelector('small').textContent = `Nº ${house.numero}${house.complemento ? ` · ${house.complemento}` : ''}`; } button.onclick = () => selectProperty(Number(button.dataset.property)); });
  await renderHomeCalendar(); if (state.selectedHouseId) await renderSelectedProperty();
  const calendarLayout = app.querySelector('.calendar-layout'); const selectedProperty = app.querySelector('#selected-property'); if (calendarLayout && selectedProperty) calendarLayout.before(selectedProperty);
}
async function renderSelectedProperty() {
  const house = state.houses.find(item => item.id === state.selectedHouseId); const target = document.querySelector('#selected-property'); if (!house || !target) return;
  try {
    const [payments, expenses, docs] = await Promise.all([api(rest('pagamentos_casa', `select=id,tipo,valor,pago,data_vencimento,data_recebimento&casa_id=eq.${house.id}&order=data_vencimento.desc.nullslast`)), api(rest('gastos_casa', `select=descricao,categoria,valor,pago,data&casa_id=eq.${house.id}&order=data.desc`)), api(rest('documentos_casa', `select=id,nome_arquivo,tipo_arquivo,descricao,data_upload&casa_id=eq.${house.id}&order=data_upload.desc`))]);
    const expensesTotal = expenses.reduce((sum, item) => sum + Number(item.valor || 0), 0); const received = payments.filter(item => item.pago).reduce((sum, item) => sum + Number(item.valor || 0), 0); const recurring = payments.filter(item => item.tipo === 'recorrente').reduce((sum, item) => sum + Number(item.valor || 0), 0); const investment = Number(house.valor_casa || 0) + expensesTotal; const remaining = Math.max(0, investment - received); const months = recurring > 0 ? Math.ceil(remaining / recurring) : null;
    target.innerHTML = `<section class="property-summary"><div class="property-summary-title">${propertyIcon()}<div><p class="eyebrow">Casa ${house.id}</p><h2>${esc(houseName(house))}</h2><p>${house.complemento ? esc(house.complemento) + ' · ' : ''}Cadastrada em ${dateTime(house.created_at)}</p></div></div><button class="icon-button delete" data-delete-house="${house.id}">Excluir casa</button></section><section class="detail-metrics"><div class="card metric"><span>Valor do imóvel</span><strong>${house.valor_casa == null ? '—' : money(house.valor_casa)}</strong></div><div class="card metric"><span>Recebido</span><strong>${money(received)}</strong></div><div class="card metric"><span>Gastos</span><strong>${money(expensesTotal)}</strong></div><div class="card metric"><span>Documentos</span><strong>${docs.length}</strong></div></section><section class="amortization-card card"><div><p class="eyebrow">Projeção financeira</p><h3>Amortização do imóvel</h3><p>Baseada no valor do imóvel, gastos e pagamentos manuais recebidos.</p></div><div class="amortization-values"><span>Investido <strong>${money(investment)}</strong></span><span>Falta amortizar <strong>${money(remaining)}</strong></span><span>Recorrente previsto <strong>${money(recurring)}/mês</strong></span><span>Prazo <strong>${remaining <= 0 ? 'Amortizado' : months === null ? 'Sem recorrência' : `${months} meses`}</strong></span></div></section><section class="property-panels"><article class="card property-panel"><h3>Pagamentos</h3>${payments.length ? payments.slice(0, 4).map(item => `<div class="property-row"><span><strong>${item.tipo === 'recorrente' ? 'Recorrente' : 'Avulso'}</strong><small>${item.data_vencimento ? `Vence: ${dateTime(item.data_vencimento)}` : 'Sem vencimento'}</small></span><span>${money(item.valor)}<small class="${item.pago ? 'text-ok' : 'text-pending'}">${item.pago ? 'Recebido' : 'Pendente'}</small></span></div>`).join('') : '<p class="detail-empty">Nenhum pagamento registrado.</p>'}</article><article class="card property-panel"><h3>Gastos</h3>${expenses.length ? expenses.slice(0, 4).map(item => `<div class="property-row"><span><strong>${esc(item.descricao)}</strong><small>${esc(item.categoria)}</small></span><span>${money(item.valor)}</span></div>`).join('') : '<p class="detail-empty">Nenhum gasto registrado.</p>'}</article><article class="card property-panel"><h3>Documentos</h3>${docs.length ? docs.slice(0, 4).map(item => `<div class="property-row"><span><strong>${esc(shortFileName(item.nome_arquivo))}</strong><small>${esc(item.descricao || fileType(item.tipo_arquivo))}</small></span><button class="icon-button small" data-open-property-document="${item.id}">Abrir</button></div>`).join('') : '<p class="detail-empty">Nenhum documento enviado.</p>'}</article></section><section class="card edit-property"><h3>Editar informações da casa</h3><form id="property-edit-form" class="form-grid"><div class="field"><label>Rua *</label><input name="rua" required value="${esc(house.rua)}"></div><div class="field"><label>Número *</label><input name="numero" type="number" min="1" required value="${esc(house.numero)}"></div><div class="field"><label>Complemento</label><input name="complemento" value="${esc(house.complemento || '')}"></div><div class="field"><label>Valor da casa</label><input name="valor_casa" type="number" min="0" step="0.01" value="${house.valor_casa == null ? '' : esc(house.valor_casa)}"></div><div class="form-actions"><button class="button">Salvar alterações</button></div></form></section>`;
    target.querySelector('[data-delete-house]').onclick = () => removeHouse(house.id); target.querySelector('#property-edit-form').onsubmit = event => updateProperty(event, house.id); target.querySelectorAll('[data-open-property-document]').forEach(button => button.onclick = () => openPropertyDocument(Number(button.dataset.openPropertyDocument)));
  } catch (error) { target.innerHTML = `<div class="card empty">Não foi possível carregar esta casa.<br><small>${esc(error.message)}</small></div>`; }
}
async function updateProperty(event, houseId) { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); try { await api(rest('casa', `id=eq.${houseId}`), jsonOptions('PATCH', { rua: data.rua.trim(), numero: Number(data.numero), complemento: data.complemento.trim() || null, valor_casa: data.valor_casa === '' ? null : Number(data.valor_casa) }, { Prefer: 'return=minimal' })); notify('Informações atualizadas.'); await loadCasas(); } catch (error) { notify(error.message, true); } }
async function openManualPaymentForm() {
  const houses = state.houses.length ? state.houses : await fetchHouses(); const modal = document.createElement('div'); modal.className = 'modal-backdrop'; modal.id = 'manual-payment-modal';
  modal.innerHTML = `<section class="modal property-modal payment-modal"><button class="modal-close" type="button">×</button><p class="eyebrow">Novo pagamento</p><h2>Adicionar pagamento</h2><form id="manual-payment-form" class="form-grid"><div class="field"><label>Casa *</label><select name="casa_id" required><option value="">Selecione</option>${houses.map(house => `<option value="${house.id}">${esc(houseName(house))}</option>`).join('')}</select></div><div class="field"><label>Tipo *</label><select name="tipo" id="payment-type"><option value="recorrente">Recorrente</option><option value="avulso">Avulso</option></select></div><div class="field"><label>Valor *</label><input name="valor" type="number" min="0.01" step="0.01" required></div><div class="field" id="due-date-field"><label>Data de vencimento *</label><input name="data_vencimento" type="date" required></div><div class="modal-actions"><button type="button" class="button secondary modal-cancel">Cancelar</button><button class="button">Salvar</button></div></form></section>`;
  document.body.append(modal); const form = modal.querySelector('#manual-payment-form'); const type = modal.querySelector('#payment-type'); const due = modal.querySelector('#due-date-field'); type.onchange = () => { const recurring = type.value === 'recorrente'; due.classList.toggle('hidden', !recurring); due.querySelector('input').required = recurring; }; form.onsubmit = createManualPayment; modal.querySelectorAll('.modal-close,.modal-cancel').forEach(button => button.onclick = () => modal.remove());
}
async function createManualPayment(event) { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); try { await api(rest('pagamentos_casa'), jsonOptions('POST', { casa_id: Number(data.casa_id), tipo: data.tipo, valor: Number(data.valor), data_vencimento: data.tipo === 'recorrente' ? data.data_vencimento : null, pago: false }, { Prefer: 'return=minimal' })); document.querySelector('#manual-payment-modal')?.remove(); notify('Pagamento criado.'); await loadPagamentos(); } catch (error) { notify(error.message, true); } }
async function loadPagamentos() {
  await fetchHouses(); const payments = await api(rest('pagamentos_casa', 'select=id,casa_id,tipo,valor,data_vencimento,pago,data_recebimento&order=data_vencimento.asc.nullslast')); const map = new Map(state.houses.map(house => [house.id, house])); const received = payments.filter(item => item.pago).reduce((sum, item) => sum + Number(item.valor), 0); const pending = payments.filter(item => !item.pago).reduce((sum, item) => sum + Number(item.valor), 0);
  app.innerHTML = heading('Receitas', 'Pagamentos', 'Cadastre e acompanhe pagamentos recorrentes ou avulsos.', '<button id="add-manual-payment" class="button">Adicionar pagamento</button>') + `<section class="summary"><div class="card metric"><span>Pagamentos cadastrados</span><strong>${payments.length}</strong></div><div class="card metric"><span>Recebido</span><strong>${money(received)}</strong></div><div class="card metric"><span>Pendente</span><strong>${money(pending)}</strong></div></section><section class="card table-card"><div class="table-head"><h2>Todos os pagamentos</h2><button id="reload" class="button secondary small">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>Casa</th><th>Tipo</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Recebido em</th><th></th></tr></thead><tbody>${payments.length ? payments.map(item => `<tr><td>${esc(map.has(item.casa_id) ? houseName(map.get(item.casa_id)) : `Casa #${item.casa_id}`)}</td><td><span class="pill recurring">${item.tipo === 'recorrente' ? 'Recorrente' : 'Avulso'}</span></td><td>${money(item.valor)}</td><td>${item.data_vencimento ? dateTime(item.data_vencimento) : '—'}</td><td><span class="pill ${item.pago ? 'ok' : 'pending'}">${item.pago ? 'Recebido' : 'Pendente'}</span></td><td>${item.data_recebimento ? dateTime(item.data_recebimento) : '—'}</td><td><button class="icon-button" data-manual-payment="${item.id}" data-paid="${item.pago}">${item.pago ? 'Marcar pendente' : 'Marcar recebido'}</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Nenhum pagamento cadastrado.</td></tr>'}</tbody></table></div></section>`;
  document.querySelector('#reload').onclick = refresh; document.querySelector('#add-manual-payment').onclick = openManualPaymentForm; app.querySelectorAll('[data-manual-payment]').forEach(button => button.onclick = () => updateManualPayment(button.dataset.manualPayment, button.dataset.paid !== 'true'));
}
async function updateManualPayment(id, paid) { try { await api(rest('pagamentos_casa', `id=eq.${id}`), jsonOptions('PATCH', { pago: paid, data_recebimento: paid ? new Date().toISOString().slice(0, 10) : null }, { Prefer: 'return=minimal' })); notify(paid ? 'Pagamento marcado como recebido.' : 'Pagamento marcado como pendente.'); await loadPagamentos(); } catch (error) { notify(error.message, true); } }
async function renderHomeCalendar() {
  const picker = app.querySelector('.property-picker'); if (!picker) return; const today = new Date(); const month = currentMonth(); const start = `${month}-01`; const next = new Date(`${start}T12:00:00`); next.setMonth(next.getMonth() + 1); const end = isoMonth(next.toISOString().slice(0, 7));
  try { const [payments, expenses] = await Promise.all([api(rest('pagamentos_casa', `select=casa_id,data_recebimento&data_recebimento=gte.${start}&data_recebimento=lt.${end}&pago=eq.true`)), api(rest('gastos_casa', `select=casa_id,descricao,valor,data&data=gte.${start}&data=lt.${end}`))]); const events = {}; const add = (date, label, type) => { if (!date) return; const day = Number(String(date).slice(8, 10)); (events[day] ||= []).push({ label, type }); }; payments.forEach(item => add(item.data_recebimento, `Pagamento recebido · Casa ${item.casa_id}`, 'payment')); expenses.forEach(item => add(item.data, `Gasto · ${item.descricao} (${money(item.valor)})`, 'expense')); const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate(); const first = new Date(today.getFullYear(), today.getMonth(), 1).getDay(); const blanks = Array.from({ length: first }, () => '<div class="calendar-day blank"></div>').join(''); const cells = Array.from({ length: days }, (_, index) => { const day = index + 1; return `<button type="button" class="calendar-day ${day === today.getDate() ? 'today' : ''}" data-calendar-day="${day}"><strong>${day}</strong>${(events[day] || []).map(event => `<span class="calendar-event ${event.type}">${esc(event.label)}</span>`).join('')}</button>`; }).join(''); picker.insertAdjacentHTML('afterend', `<section class="calendar-card card"><div class="calendar-head"><div><p class="eyebrow">Visão geral</p><h2>Calendário de ${new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(today)}</h2></div><div class="calendar-legend"><span><i class="payment"></i>Recebidos</span><span><i class="expense"></i>Gastos</span></div></div><div class="calendar-weekdays"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div><div class="calendar-grid">${blanks}${cells}</div><div id="calendar-day-details" class="calendar-day-details">Clique em um dia para ver os lançamentos.</div></section>`); const calendar = app.querySelector('.calendar-card'); const details = app.querySelector('#calendar-day-details'); if (calendar && details) { const layout = document.createElement('section'); layout.className = 'calendar-layout'; calendar.before(layout); layout.append(calendar); layout.append(details); } app.querySelectorAll('[data-calendar-day]').forEach(button => button.onclick = () => showCalendarDay(Number(button.dataset.calendarDay), events[Number(button.dataset.calendarDay)], today)); } catch (error) { console.warn('Calendário indisponível:', error); }
}
function assetLabel(asset) { return asset.tipo_patrimonio === 'casa' ? `${asset.nome} — ${asset.rua || 'Sem rua'}${asset.numero ? `, ${asset.numero}` : ''}` : asset.nome; }
function assetOptions() { return state.houses.map(asset => `<option value="${asset.id}">${esc(assetLabel(asset))}</option>`).join(''); }
async function fetchHouses() { state.houses = await api(rest('patrimonio', 'select=id,created_at,nome,tipo_patrimonio,rua,numero,complemento,valor_patrimonio&order=id.desc')); return state.houses; }
async function removeHouse(id) { if (!confirm('Excluir este patrimônio? Registros relacionados podem impedir a operação.')) return; try { await api(rest('patrimonio', `id=eq.${id}`), jsonOptions('DELETE', null, { Prefer: 'return=minimal' })); state.selectedHouseId = null; notify('Patrimônio excluído.'); refresh(); } catch (error) { notify(error.message, true); } }
function propertyIcon(type = 'casa') { return type === 'carro' ? '<span class="asset-emoji">🚗</span>' : type === 'outro' ? '<span class="asset-emoji">◆</span>' : '<svg class="property-icon" viewBox="0 0 120 120" aria-hidden="true"><path d="M15 54 60 16l45 38v49H76V74a16 16 0 0 0-32 0v29H15Z"/></svg>'; }
function openPropertyForm() {
  document.querySelector('#add-property-modal')?.remove(); const modal = document.createElement('div'); modal.id = 'add-property-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<section class="modal property-modal asset-modal"><button class="modal-close" type="button">×</button><p class="eyebrow">Novo patrimônio</p><h2>Adicionar patrimônio</h2><form id="add-property-form" class="form-grid"><div class="field"><label>Tipo *</label><select name="tipo_patrimonio" id="asset-type"><option value="casa">Casa</option><option value="carro">Carro</option><option value="outro">Outro</option></select></div><div class="field"><label>Nome / identificação *</label><input name="nome" required placeholder="Ex.: Casa Jardim ou Honda Civic"></div><div class="field"><label>Valor do patrimônio</label><input name="valor_patrimonio" type="number" min="0" step="0.01"></div><div id="asset-address-fields" class="asset-address-fields"><div class="field"><label>Rua</label><input name="rua"></div><div class="field"><label>Número</label><input name="numero" type="number" min="1"></div><div class="field"><label>Complemento</label><input name="complemento"></div></div><div class="modal-actions"><button type="button" class="button secondary modal-cancel">Cancelar</button><button class="button">Cadastrar</button></div></form></section>`;
  document.body.append(modal); const type = modal.querySelector('#asset-type'); const address = modal.querySelector('#asset-address-fields'); type.onchange = () => address.classList.toggle('hidden', type.value !== 'casa'); modal.querySelector('#add-property-form').onsubmit = createHouse; modal.querySelectorAll('.modal-close,.modal-cancel').forEach(button => button.onclick = () => modal.remove());
}
async function createHouse(event) { event.preventDefault(); const form = event.currentTarget; const button = form.querySelector(".button:not([type=button])"); if (button.disabled) return; button.disabled = true; const data = Object.fromEntries(new FormData(form)); try { await checkPlanQuota("asset"); await api(rest('patrimonio'), jsonOptions('POST', { tipo_patrimonio: data.tipo_patrimonio, nome: data.nome.trim(), rua: data.tipo_patrimonio === 'casa' ? data.rua.trim() || null : null, numero: data.tipo_patrimonio === 'casa' && data.numero !== '' ? Number(data.numero) : null, complemento: data.tipo_patrimonio === 'casa' ? data.complemento.trim() || null : null, valor_patrimonio: data.valor_patrimonio === '' ? null : Number(data.valor_patrimonio) }, { Prefer: 'return=minimal' })); document.querySelector('#add-property-modal')?.remove(); notify('Patrimônio cadastrado.'); refresh(); } catch (error) { notify(error.message, true); } finally { button.disabled = false; } }
async function loadCasas() { const assets = await fetchHouses(); if (!assets.some(asset => asset.id === state.selectedHouseId)) state.selectedHouseId = null; const total = assets.reduce((sum, asset) => sum + Number(asset.valor_patrimonio || 0), 0); app.innerHTML = heading('Patrimônio', 'Meus patrimônios', 'Gerencie casas, veículos e outros bens.', '<div class="heading-actions"><button id="reload" class="button secondary">Atualizar</button><button id="add-property" class="button">Adicionar patrimônio</button></div>') + `<section class="summary"><div class="card metric"><span>Patrimônios cadastrados</span><strong>${assets.length}</strong></div><div class="card metric"><span>Valor patrimonial</span><strong>${money(total)}</strong></div><div class="card metric"><span>Selecionado</span><strong>${state.selectedHouseId ? assetLabel(assets.find(asset => asset.id === state.selectedHouseId)) : '—'}</strong></div></section><section class="property-picker"><div class="picker-heading"><div><p class="eyebrow">Seleção de patrimônio</p><h2>Escolha um patrimônio</h2></div><p>Clique em um item para abrir os detalhes.</p></div><div class="property-grid">${assets.length ? assets.map(asset => `<button class="property-choice ${state.selectedHouseId === asset.id ? 'selected' : ''}" data-property="${asset.id}">${propertyIcon(asset.tipo_patrimonio)}<strong>${esc(asset.nome)}</strong><small>${asset.tipo_patrimonio === 'casa' ? `Casa · ${esc(asset.rua || 'Sem endereço')}${asset.numero ? `, ${esc(asset.numero)}` : ''}` : asset.tipo_patrimonio === 'carro' ? 'Veículo' : 'Outro patrimônio'}</small></button>`).join('') : '<div class="card empty">Você ainda não cadastrou patrimônios.</div>'}</div></section><div id="selected-property">${state.selectedHouseId ? '<div class="card empty">Carregando dados…</div>' : '<section class="card property-empty"><div>◆</div><h2>Selecione um patrimônio</h2><p>Os detalhes financeiros, gastos e documentos aparecerão aqui.</p></section>'}</div>`; document.querySelector('#reload').onclick = refresh; document.querySelector('#add-property').onclick = openPropertyForm; app.querySelectorAll('[data-property]').forEach(button => button.onclick = () => selectProperty(Number(button.dataset.property))); await renderHomeCalendar(); if (state.selectedHouseId) await renderSelectedProperty(); const layout = app.querySelector('.calendar-layout'); const selected = app.querySelector('#selected-property'); if (layout && selected) layout.before(selected); }
async function renderSelectedProperty() { const asset = state.houses.find(item => item.id === state.selectedHouseId); const target = document.querySelector('#selected-property'); if (!asset || !target) return; try { const [payments, expenses, docs] = await Promise.all([api(rest('pagamentos_casa', `select=id,tipo,valor,pago,data_vencimento,data_recebimento&patrimonio_id=eq.${asset.id}&order=data_vencimento.desc.nullslast`)), api(rest('gastos_casa', `select=descricao,categoria,valor,pago,data&patrimonio_id=eq.${asset.id}&order=data.desc`)), api(rest('documentos_casa', `select=id,nome_arquivo,tipo_arquivo,descricao,data_upload&patrimonio_id=eq.${asset.id}&order=data_upload.desc`))]); const expensesTotal = expenses.reduce((sum, item) => sum + Number(item.valor || 0), 0); const received = payments.filter(item => item.pago).reduce((sum, item) => sum + Number(item.valor || 0), 0); const investment = Number(asset.valor_patrimonio || 0) + expensesTotal; const remaining = Math.max(0, investment - received); target.innerHTML = `<section class="property-summary"><div class="property-summary-title">${propertyIcon(asset.tipo_patrimonio)}<div><p class="eyebrow">${esc(asset.tipo_patrimonio)}</p><h2>${esc(assetLabel(asset))}</h2><p>${asset.complemento ? esc(asset.complemento) : 'Patrimônio cadastrado'}</p></div></div><button class="icon-button delete" data-delete-house="${asset.id}">Excluir</button></section><section class="detail-metrics"><div class="card metric"><span>Valor do patrimônio</span><strong>${asset.valor_patrimonio == null ? '—' : money(asset.valor_patrimonio)}</strong></div><div class="card metric"><span>Recebido</span><strong>${money(received)}</strong></div><div class="card metric"><span>Gastos</span><strong>${money(expensesTotal)}</strong></div><div class="card metric"><span>Documentos</span><strong>${docs.length}</strong></div></section><section class="amortization-card card"><div><p class="eyebrow">Resumo financeiro</p><h3>Amortização</h3></div><div class="amortization-values"><span>Investido <strong>${money(investment)}</strong></span><span>Falta amortizar <strong>${money(remaining)}</strong></span></div></section><section class="card edit-property"><h3>Editar patrimônio</h3><form id="property-edit-form" class="form-grid"><div class="field"><label>Nome *</label><input name="nome" required value="${esc(asset.nome)}"></div><div class="field"><label>Valor</label><input name="valor_patrimonio" type="number" min="0" step="0.01" value="${asset.valor_patrimonio == null ? '' : esc(asset.valor_patrimonio)}"></div>${asset.tipo_patrimonio === 'casa' ? `<div class="field"><label>Rua</label><input name="rua" value="${esc(asset.rua || '')}"></div><div class="field"><label>Número</label><input name="numero" type="number" value="${asset.numero || ''}"></div><div class="field"><label>Complemento</label><input name="complemento" value="${esc(asset.complemento || '')}"></div>` : ''}<div class="form-actions"><button class="button">Salvar alterações</button></div></form></section>`; target.querySelector('[data-delete-house]').onclick = () => removeHouse(asset.id); target.querySelector('#property-edit-form').onsubmit = event => updateProperty(event, asset.id); } catch (error) { target.innerHTML = `<div class="card empty">Não foi possível carregar este patrimônio.<br><small>${esc(error.message)}</small></div>`; } }
async function updateProperty(event, id) { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); const asset = state.houses.find(item => item.id === id); try { await api(rest('patrimonio', `id=eq.${id}`), jsonOptions('PATCH', { nome: data.nome.trim(), valor_patrimonio: data.valor_patrimonio === '' ? null : Number(data.valor_patrimonio), rua: asset.tipo_patrimonio === 'casa' ? data.rua.trim() || null : null, numero: asset.tipo_patrimonio === 'casa' && data.numero !== '' ? Number(data.numero) : null, complemento: asset.tipo_patrimonio === 'casa' ? data.complemento.trim() || null : null }, { Prefer: 'return=minimal' })); notify('Patrimônio atualizado.'); await loadCasas(); } catch (error) { notify(error.message, true); } }
async function loadPagamentos() { await fetchHouses(); const payments = await api(rest('pagamentos_casa', 'select=id,patrimonio_id,tipo,valor,data_vencimento,pago,data_recebimento&order=data_vencimento.asc.nullslast')); const map = new Map(state.houses.map(asset => [asset.id, asset])); const received = payments.filter(item => item.pago).reduce((sum, item) => sum + Number(item.valor), 0); app.innerHTML = heading('Receitas', 'Pagamentos', 'Cadastre pagamentos recorrentes ou avulsos.', '<button id="add-manual-payment" class="button">Adicionar pagamento</button>') + `<section class="summary"><div class="card metric"><span>Pagamentos cadastrados</span><strong>${payments.length}</strong></div><div class="card metric"><span>Recebido</span><strong>${money(received)}</strong></div><div class="card metric"><span>Pendente</span><strong>${money(payments.filter(item => !item.pago).reduce((sum, item) => sum + Number(item.valor), 0))}</strong></div></section><section class="card table-card"><div class="table-head"><h2>Todos os pagamentos</h2><button id="reload" class="button secondary small">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>Patrimônio</th><th>Tipo</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Recebido em</th><th></th></tr></thead><tbody>${payments.length ? payments.map(item => `<tr><td>${esc(map.has(item.patrimonio_id) ? assetLabel(map.get(item.patrimonio_id)) : 'Patrimônio removido')}</td><td>${item.tipo}</td><td>${money(item.valor)}</td><td>${item.data_vencimento ? dateTime(item.data_vencimento) : '—'}</td><td><span class="pill ${item.pago ? 'ok' : 'pending'}">${item.pago ? 'Recebido' : 'Pendente'}</span></td><td>${item.data_recebimento ? dateTime(item.data_recebimento) : '—'}</td><td><button class="icon-button" data-manual-payment="${item.id}" data-paid="${item.pago}">${item.pago ? 'Desfazer' : 'Receber'}</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Nenhum pagamento cadastrado.</td></tr>'}</tbody></table></div></section>`; document.querySelector('#reload').onclick = refresh; document.querySelector('#add-manual-payment').onclick = openManualPaymentForm; app.querySelectorAll('[data-manual-payment]').forEach(button => button.onclick = () => updateManualPayment(button.dataset.manualPayment, button.dataset.paid !== 'true')); }
async function openManualPaymentForm() { const assets = state.houses.length ? state.houses : await fetchHouses(); const modal = document.createElement('div'); modal.className = 'modal-backdrop'; modal.id = 'manual-payment-modal'; modal.innerHTML = `<section class="modal property-modal payment-modal"><button class="modal-close" type="button">×</button><p class="eyebrow">Novo pagamento</p><h2>Adicionar pagamento</h2><form id="manual-payment-form" class="form-grid"><div class="field"><label>Patrimônio *</label><select name="patrimonio_id" required><option value="">Selecione</option>${assets.map(asset => `<option value="${asset.id}">${esc(assetLabel(asset))}</option>`).join('')}</select></div><div class="field"><label>Tipo *</label><select name="tipo" id="payment-type"><option value="recorrente">Recorrente</option><option value="avulso">Avulso</option></select></div><div class="field"><label>Valor *</label><input name="valor" type="number" min="0.01" step="0.01" required></div><div class="field" id="due-date-field"><label>Data de vencimento *</label><input name="data_vencimento" type="date" required></div><div class="modal-actions"><button type="button" class="button secondary modal-cancel">Cancelar</button><button class="button">Salvar</button></div></form></section>`; document.body.append(modal); const type = modal.querySelector('#payment-type'); const due = modal.querySelector('#due-date-field'); type.onchange = () => { const recurring = type.value === 'recorrente'; due.classList.toggle('hidden', !recurring); due.querySelector('input').required = recurring; }; modal.querySelector('#manual-payment-form').onsubmit = createManualPayment; modal.querySelectorAll('.modal-close,.modal-cancel').forEach(button => button.onclick = () => modal.remove()); }
async function createManualPayment(event) { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); try { await api(rest('pagamentos_casa'), jsonOptions('POST', { patrimonio_id: Number(data.patrimonio_id), tipo: data.tipo, valor: Number(data.valor), data_vencimento: data.tipo === 'recorrente' ? data.data_vencimento : null, pago: false }, { Prefer: 'return=minimal' })); document.querySelector('#manual-payment-modal')?.remove(); notify('Pagamento criado.'); await loadPagamentos(); } catch (error) { notify(error.message, true); } }
async function updateManualPayment(id, paid) { try { await api(rest('pagamentos_casa', `id=eq.${id}`), jsonOptions('PATCH', { pago: paid, data_recebimento: paid ? new Date().toISOString().slice(0, 10) : null }, { Prefer: 'return=minimal' })); notify('Pagamento atualizado.'); await loadPagamentos(); } catch (error) { notify(error.message, true); } }
async function loadGastos() { await fetchHouses(); const gastos = await api(rest('gastos_casa', 'select=id,patrimonio_id,descricao,categoria,valor,pago,recorrente,data&order=data.desc')); const map = new Map(state.houses.map(asset => [asset.id, asset])); app.innerHTML = heading('Despesas', 'Gastos', 'Registre gastos associados aos seus patrimônios.') + `<section class="card form-card"><h2 class="card-title">Novo gasto</h2><form id="expense-form" class="form-grid"><div class="field"><label>Patrimônio *</label><select name="patrimonio_id" required><option value="">Selecione</option>${assetOptions()}</select></div><div class="field"><label>Descrição *</label><input name="descricao" required></div><div class="field"><label>Categoria *</label><input name="categoria" required></div><div class="field"><label>Valor *</label><input name="valor" type="number" min="0.01" step="0.01" required></div><div class="form-actions"><button class="button">Salvar gasto</button></div></form></section><section class="card table-card"><div class="table-head"><h2>Gastos</h2><button id="reload" class="button secondary small">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>Patrimônio</th><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Status</th><th></th></tr></thead><tbody>${gastos.map(item => `<tr><td>${esc(map.has(item.patrimonio_id) ? assetLabel(map.get(item.patrimonio_id)) : 'Patrimônio removido')}</td><td>${esc(item.descricao)}</td><td>${esc(item.categoria)}</td><td>${money(item.valor)}</td><td><span class="pill ${item.pago ? 'ok' : 'pending'}">${item.pago ? 'Pago' : 'Pendente'}</span></td><td><button class="icon-button" data-expense-paid="${item.id}" data-paid="${item.pago}">${item.pago ? 'Desfazer' : 'Pagar'}</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhum gasto cadastrado.</td></tr>'}</tbody></table></div></section>`; document.querySelector('#expense-form').onsubmit = createExpense; document.querySelector('#reload').onclick = refresh; app.querySelectorAll('[data-expense-paid]').forEach(button => button.onclick = () => patchExpense(button.dataset.expensePaid, button.dataset.paid !== 'true')); }
async function createExpense(event) { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); try { await api(rest('gastos_casa'), jsonOptions('POST', { patrimonio_id: Number(data.patrimonio_id), descricao: data.descricao.trim(), categoria: data.categoria.trim(), valor: Number(data.valor), pago: false, recorrente: false, data: new Date().toISOString().slice(0, 10) }, { Prefer: 'return=minimal' })); notify('Gasto cadastrado.'); await loadGastos(); } catch (error) { notify(error.message, true); } }
async function renderHomeCalendar() { const picker = app.querySelector('.property-picker'); if (!picker) return; const today = new Date(); const month = currentMonth(); const start = `${month}-01`; const next = new Date(`${start}T12:00:00`); next.setMonth(next.getMonth() + 1); const end = isoMonth(next.toISOString().slice(0, 7)); try { const [payments, expenses] = await Promise.all([api(rest('pagamentos_casa', `select=patrimonio_id,data_recebimento&data_recebimento=gte.${start}&data_recebimento=lt.${end}&pago=eq.true`)), api(rest('gastos_casa', `select=patrimonio_id,descricao,valor,data&data=gte.${start}&data=lt.${end}`))]); const events = {}; const add = (date, label, type) => { if (!date) return; const day = Number(String(date).slice(8, 10)); (events[day] ||= []).push({ label, type }); }; payments.forEach(item => add(item.data_recebimento, `Pagamento recebido · Patrimônio ${item.patrimonio_id}`, 'payment')); expenses.forEach(item => add(item.data, `Gasto · ${item.descricao} (${money(item.valor)})`, 'expense')); const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate(); const first = new Date(today.getFullYear(), today.getMonth(), 1).getDay(); const blanks = Array.from({ length: first }, () => '<div class="calendar-day blank"></div>').join(''); const cells = Array.from({ length: days }, (_, i) => { const day = i + 1; return `<button type="button" class="calendar-day ${day === today.getDate() ? 'today' : ''}" data-calendar-day="${day}"><strong>${day}</strong>${(events[day] || []).map(event => `<span class="calendar-event ${event.type}">${esc(event.label)}</span>`).join('')}</button>`; }).join(''); picker.insertAdjacentHTML('afterend', `<section class="calendar-card card"><div class="calendar-head"><div><p class="eyebrow">Visão geral</p><h2>Calendário de ${new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(today)}</h2></div></div><div class="calendar-weekdays"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div><div class="calendar-grid">${blanks}${cells}</div><div id="calendar-day-details" class="calendar-day-details">Clique em um dia para ver os lançamentos.</div></section>`); const calendar = app.querySelector('.calendar-card'); const details = app.querySelector('#calendar-day-details'); if (calendar && details) { const layout = document.createElement('section'); layout.className = 'calendar-layout'; calendar.before(layout); layout.append(calendar); layout.append(details); } app.querySelectorAll('[data-calendar-day]').forEach(button => button.onclick = () => showCalendarDay(Number(button.dataset.calendarDay), events[Number(button.dataset.calendarDay)], today)); } catch (error) { console.warn(error); } }
async function loadDocumentos() { await fetchHouses(); const docs = await api(rest('documentos_casa', 'select=id,patrimonio_id,nome_arquivo,tipo_arquivo,tamanho,caminho_arquivo,descricao,data_upload&order=data_upload.desc')); state.documentos = docs; const map = new Map(state.houses.map(asset => [asset.id, asset])); app.innerHTML = heading('Arquivos', 'Documentos', 'Armazene documentos dos seus patrimônios.') + `<section class="card form-card"><h2 class="card-title">Enviar documento</h2><form id="document-form" class="form-grid two"><div class="field"><label>Patrimônio *</label><select name="patrimonio_id" required><option value="">Selecione</option>${assetOptions()}</select></div><div class="field"><label>Arquivo *</label><input name="file" type="file" accept="application/pdf,image/png,image/jpeg" required></div><div class="field"><label>Descrição</label><input name="descricao"></div><div class="form-actions"><button class="button">Enviar arquivo</button></div></form><p class="upload-note">PDF, PNG ou JPEG. O espaço disponível depende do plano da conta.</p></section><section class="card table-card"><div class="table-head"><h2>Documentos armazenados</h2><button id="reload" class="button secondary small">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>Patrimônio</th><th>Arquivo</th><th>Descrição</th><th>Enviado em</th><th></th></tr></thead><tbody>${docs.length ? docs.map(doc => `<tr><td>${esc(map.has(doc.patrimonio_id) ? assetLabel(map.get(doc.patrimonio_id)) : 'Patrimônio removido')}</td><td>${esc(shortFileName(doc.nome_arquivo))}</td><td>${esc(doc.descricao || '—')}</td><td>${dateTime(doc.data_upload)}</td><td><div class="action-row"><button class="icon-button" data-open-doc="${doc.id}">Abrir</button><button class="icon-button delete" data-delete-doc="${doc.id}">Excluir</button></div></td></tr>`).join('') : '<tr><td colspan="5" class="empty">Nenhum documento enviado.</td></tr>'}</tbody></table></div></section>`; document.querySelector('#document-form').onsubmit = uploadDocument; document.querySelector('#reload').onclick = refresh; app.querySelectorAll('[data-open-doc]').forEach(button => button.onclick = () => openDocument(button.dataset.openDoc)); app.querySelectorAll('[data-delete-doc]').forEach(button => button.onclick = () => deleteDocument(button.dataset.deleteDoc)); }
async function uploadDocument(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('.button');
  if (button.disabled) return;
  const data = new FormData(form);
  const file = data.get('file');
  if (!file?.size || file.size > 1024 * 1024 * 1024 || !['application/pdf','image/png','image/jpeg'].includes(file.type)) return notify('Escolha um PDF, PNG ou JPEG de até 1 GB.', true);
  const assetId = Number(data.get('patrimonio_id'));
  const path = 'patrimonios/' + assetId + '/' + crypto.randomUUID() + '_' + safeFileName(file.name);
  let reservation;
  let uploaded = false;
  button.disabled = true;
  try {
    await checkPlanQuota('document', assetId);
    // A reserva de cota deve existir antes do envio ao Storage.
    const rows = await api(rest('documentos_casa'), jsonOptions('POST', {
      patrimonio_id: assetId, nome_arquivo: file.name, tipo_arquivo: file.type, tamanho: file.size,
      caminho_arquivo: path, descricao: data.get('descricao').trim() || null,
    }, { Prefer: 'return=representation' }));
    reservation = rows[0];
    await api('/storage/v1/object/documentos/' + path.split('/').map(encodeURIComponent).join('/'), {
      method: 'POST', headers: { 'Content-Type': file.type, 'x-upsert': 'false' }, body: file,
    });
    uploaded = true;
    notify('Documento enviado.');
    await loadDocumentos();
  } catch (error) {
    if (reservation && !uploaded) {
      try {
        await api('/storage/v1/object/documentos', jsonOptions('DELETE', { prefixes: [path] }));
        await api(rest('documentos_casa', 'id=eq.' + reservation.id), jsonOptions('DELETE', null));
      } catch { notify('O envio não terminou. Exclua o documento incompleto antes de tentar novamente.', true); }
    }
    notify(error.message, true);
  } finally { button.disabled = false; }
}
async function openPropertyDocument(id) { try { const records = await api(rest('documentos_casa', `select=id,caminho_arquivo&patrimonio_id=eq.${state.selectedHouseId}&id=eq.${id}`)); const doc = records[0]; if (!doc) throw new Error('Documento não encontrado.'); const data = await api(`/storage/v1/object/sign/documentos/${doc.caminho_arquivo.split('/').map(encodeURIComponent).join('/')}`, jsonOptions('POST', { expiresIn: 3600 })); const signed = data.signedURL || data.signedUrl; if (!signed) throw new Error('Não foi possível gerar o link.'); window.open(signed.startsWith('http') ? signed : `${supabaseBase()}/storage/v1${signed}`, '_blank', 'noopener'); } catch (error) { notify(error.message, true); } }
async function openManualPaymentForm() {
  const assets = state.houses.length ? state.houses : await fetchHouses(); const modal = document.createElement('div'); modal.className = 'modal-backdrop'; modal.id = 'manual-payment-modal';
  modal.innerHTML = `<section class="modal property-modal payment-modal"><button class="modal-close" type="button">×</button><p class="eyebrow">Novo pagamento</p><h2>Adicionar pagamento</h2><form id="manual-payment-form" class="form-grid"><div class="field"><label>Patrimônio *</label><select name="patrimonio_id" required><option value="">Selecione</option>${assets.map(asset => `<option value="${asset.id}">${esc(assetLabel(asset))}</option>`).join('')}</select></div><div class="field"><label>Tipo *</label><select name="tipo"><option value="recorrente">Recorrente</option><option value="avulso">Avulso</option></select></div><div class="field"><label>Valor *</label><input name="valor" type="number" min="0.01" step="0.01" required></div><div class="field"><label>Data do lançamento ou vencimento *</label><input name="data_vencimento" type="date" required value="${new Date().toISOString().slice(0,10)}"></div><div class="modal-actions"><button type="button" class="button secondary modal-cancel">Cancelar</button><button class="button">Salvar</button></div></form></section>`;
  document.body.append(modal); modal.querySelector('#manual-payment-form').onsubmit = createManualPayment; modal.querySelectorAll('.modal-close,.modal-cancel').forEach(button => button.onclick = () => modal.remove());
}
async function createManualPayment(event) { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); try { await api(rest('pagamentos_casa'), jsonOptions('POST', { patrimonio_id: Number(data.patrimonio_id), tipo: data.tipo, valor: Number(data.valor), data_vencimento: data.data_vencimento, pago: false }, { Prefer: 'return=minimal' })); document.querySelector('#manual-payment-modal')?.remove(); notify('Pagamento cadastrado.'); await loadPagamentos(); } catch (error) { notify(error.message, true); } }
async function updateManualPayment(id, paid) { const date = paid ? prompt('Informe a data em que este pagamento foi recebido (AAAA-MM-DD):', new Date().toISOString().slice(0,10)) : null; if (paid && !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return notify('Informe uma data válida no formato AAAA-MM-DD.', true); try { await api(rest('pagamentos_casa', `id=eq.${id}`), jsonOptions('PATCH', { pago: paid, data_recebimento: date }, { Prefer: 'return=minimal' })); notify('Pagamento atualizado.'); await loadPagamentos(); } catch (error) { notify(error.message, true); } }
async function loadGastos() { await fetchHouses(); const gastos = await api(rest('gastos_casa', 'select=id,patrimonio_id,descricao,categoria,valor,pago,recorrente,data,data_pagamento&order=data.desc')); const map = new Map(state.houses.map(asset => [asset.id, asset])); app.innerHTML = heading('Despesas', 'Gastos', 'Registre gastos atuais ou retroativos associados aos seus patrimônios.') + `<section class="card form-card"><h2 class="card-title">Novo gasto</h2><form id="expense-form" class="form-grid"><div class="field"><label>Patrimônio *</label><select name="patrimonio_id" required><option value="">Selecione</option>${assetOptions()}</select></div><div class="field"><label>Descrição *</label><input name="descricao" required></div><div class="field"><label>Categoria *</label><input name="categoria" required></div><div class="field"><label>Valor *</label><input name="valor" type="number" min="0.01" step="0.01" required></div><div class="field"><label>Data do gasto *</label><input name="data" type="date" required value="${new Date().toISOString().slice(0,10)}"></div><div class="form-actions"><button class="button">Salvar gasto</button></div></form></section><section class="card table-card"><div class="table-head"><h2>Gastos</h2><button id="reload" class="button secondary small">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>Patrimônio</th><th>Descrição</th><th>Valor</th><th>Data</th><th>Status</th><th>Pago em</th><th></th></tr></thead><tbody>${gastos.map(item => `<tr><td>${esc(map.has(item.patrimonio_id) ? assetLabel(map.get(item.patrimonio_id)) : 'Patrimônio removido')}</td><td>${esc(item.descricao)}<br><small>${esc(item.categoria)}</small></td><td>${money(item.valor)}</td><td>${dateTime(item.data)}</td><td><span class="pill ${item.pago ? 'ok' : 'pending'}">${item.pago ? 'Pago' : 'Pendente'}</span></td><td>${item.data_pagamento ? dateTime(item.data_pagamento) : '—'}</td><td><button class="icon-button" data-expense-paid="${item.id}" data-paid="${item.pago}">${item.pago ? 'Desfazer' : 'Marcar pago'}</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhum gasto cadastrado.</td></tr>'}</tbody></table></div></section>`; document.querySelector('#expense-form').onsubmit = createExpense; document.querySelector('#reload').onclick = refresh; app.querySelectorAll('[data-expense-paid]').forEach(button => button.onclick = () => patchExpense(button.dataset.expensePaid, button.dataset.paid !== 'true')); }
async function createExpense(event) { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); try { await api(rest('gastos_casa'), jsonOptions('POST', { patrimonio_id: Number(data.patrimonio_id), descricao: data.descricao.trim(), categoria: data.categoria.trim(), valor: Number(data.valor), pago: false, recorrente: false, data: data.data }, { Prefer: 'return=minimal' })); notify('Gasto cadastrado.'); await loadGastos(); } catch (error) { notify(error.message, true); } }
async function patchExpense(id, paid) { const date = paid ? prompt('Informe a data em que este gasto foi pago (AAAA-MM-DD):', new Date().toISOString().slice(0,10)) : null; if (paid && !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return notify('Informe uma data válida no formato AAAA-MM-DD.', true); try { await api(rest('gastos_casa', `id=eq.${id}`), jsonOptions('PATCH', { pago: paid, data_pagamento: date }, { Prefer: 'return=minimal' })); notify('Gasto atualizado.'); await loadGastos(); } catch (error) { notify(error.message, true); } }
async function boot() { if (await restoreSession()) await openApplication(); else renderAuth(); }

function propertyIcon(type = 'casa') {
  if (type === 'carro') return '<svg class="property-icon asset-car-icon" viewBox="0 0 120 120" aria-hidden="true"><path d="M17 72 29 47h62l12 25v24H17Z"/><path d="m39 47 10-17h22l10 17M17 72h86M27 72h13m40 0h13"/><circle cx="37" cy="96" r="8"/><circle cx="83" cy="96" r="8"/></svg>';
  if (type === 'outro') return '<svg class="property-icon" viewBox="0 0 120 120" aria-hidden="true"><path d="m60 15 42 23v45l-42 23-42-23V38Z"/><path d="m18 38 42 24 42-24M60 62v44"/></svg>';
  return '<svg class="property-icon" viewBox="0 0 120 120" aria-hidden="true"><path d="M15 54 60 16l45 38v49H76V74a16 16 0 0 0-32 0v29H15Z"/></svg>';
}

function assetLabel(asset) {
  const type = asset.tipo_patrimonio === 'casa' ? 'Casa' : asset.tipo_patrimonio === 'carro' ? 'Carro' : 'Outro';
  if (asset.tipo_patrimonio !== 'casa') return `${type}: ${asset.nome || 'Sem identificação'}`;
  const address = [asset.rua, asset.numero].filter(Boolean).join(', ') || asset.nome || 'Sem endereço';
  return `${type}: ${address}${asset.complemento ? ` - ${asset.complemento}` : ''}`;
}

function propertyIcon(type = 'casa') {
  if (type === 'carro') return '<svg class="property-icon asset-car-front-icon" viewBox="0 0 120 120" aria-hidden="true"><path d="M34 57 42 33q3-9 13-9h10q10 0 13 9l8 24Z"/><path d="M19 58h82q11 0 11 11v26H97v9a9 9 0 0 1-18 0v-9H41v9a9 9 0 0 1-18 0v-9H8V69q0-11 11-11Z"/><circle class="car-headlight" cx="32" cy="74" r="7"/><circle class="car-headlight" cx="88" cy="74" r="7"/></svg>';
  if (type === 'outro') return '<svg class="property-icon" viewBox="0 0 120 120" aria-hidden="true"><path d="m60 15 42 23v45l-42 23-42-23V38Z"/><path d="m18 38 42 24 42-24M60 62v44"/></svg>';
  return '<svg class="property-icon" viewBox="0 0 120 120" aria-hidden="true"><path d="M15 54 60 16l45 38v49H76V74a16 16 0 0 0-32 0v29H15Z"/></svg>';
}

boot();

async function renderHomeCalendar() {
  const picker = app.querySelector('.property-picker'); if (!picker) return;
  const month = state.calendarMonth || currentMonth(); state.calendarMonth = month;
  const start = `${month}-01`; const reference = new Date(`${start}T12:00:00`); const next = new Date(reference); next.setMonth(next.getMonth() + 1); const end = isoMonth(next.toISOString().slice(0, 7));
  try {
    const [payments, expenses] = await Promise.all([
      api(rest('pagamentos_casa', `select=patrimonio_id,data_recebimento,valor&data_recebimento=gte.${start}&data_recebimento=lt.${end}&pago=eq.true`)),
      api(rest('gastos_casa', 'select=patrimonio_id,descricao,valor,pago,data,data_pagamento')),
    ]);
    const assets = new Map(state.houses.map(asset => [asset.id, asset])); const events = {};
    const labelFor = id => assets.has(id) ? assetLabel(assets.get(id)) : 'Patrimônio removido';
    const add = (date, label, type) => { if (!date) return; const day = Number(String(date).slice(8, 10)); (events[day] ||= []).push({ label, type }); };
    payments.forEach(item => add(item.data_recebimento, `Recebido ${money(item.valor)} · ${labelFor(item.patrimonio_id)}`, 'payment'));
    expenses.forEach(item => add(item.data, `${item.pago ? 'Gasto pago' : 'Gasto pendente'} · ${item.descricao} · ${labelFor(item.patrimonio_id)} (${money(item.valor)})`, item.pago ? 'expense-paid' : 'expense-pending'));
    const days = new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate(); const first = new Date(reference.getFullYear(), reference.getMonth(), 1).getDay();
    const today = new Date(); const blanks = Array.from({ length: first }, () => '<div class="calendar-day blank"></div>').join('');
    const cells = Array.from({ length: days }, (_, i) => { const day = i + 1; const isToday = day === today.getDate() && reference.getMonth() === today.getMonth() && reference.getFullYear() === today.getFullYear(); return `<button type="button" class="calendar-day ${isToday ? 'today' : ''}" data-calendar-day="${day}"><strong>${day}</strong>${(events[day] || []).map(event => `<span class="calendar-event ${event.type}">${esc(event.label)}</span>`).join('')}</button>`; }).join('');
    app.querySelector('.calendar-layout')?.remove();
    picker.insertAdjacentHTML('afterend', `<section class="calendar-card card"><div class="calendar-head"><div><p class="eyebrow">Visão geral</p><h2>Calendário financeiro</h2></div><div class="toolbar"><label for="calendar-month">Mês</label><input class="month-control" id="calendar-month" type="month" value="${month}"></div></div><div class="calendar-legend"><span><i class="payment"></i>Recebidos</span><span><i class="expense"></i>Gastos</span></div><div class="calendar-weekdays"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div><div class="calendar-grid">${blanks}${cells}</div><div id="calendar-day-details" class="calendar-day-details">Clique em um dia para ver os lançamentos.</div></section>`);
    const calendar = app.querySelector('.calendar-card'); const details = app.querySelector('#calendar-day-details'); if (calendar && details) { const layout = document.createElement('section'); layout.className = 'calendar-layout'; calendar.before(layout); layout.append(calendar); layout.append(details); setTimeout(() => picker.before(layout)); }
    app.querySelector('#calendar-month').onchange = async event => { state.calendarMonth = event.currentTarget.value || currentMonth(); await renderHomeCalendar(); };
    app.querySelectorAll('[data-calendar-day]').forEach(button => button.onclick = () => showCalendarDay(Number(button.dataset.calendarDay), events[Number(button.dataset.calendarDay)], reference));
  } catch (error) { console.warn('Calendário indisponível:', error); }
}

async function loadGastos() {
  await fetchHouses(); const gastos = await api(rest('gastos_casa', 'select=id,patrimonio_id,descricao,categoria,valor,pago,recorrente,data,data_pagamento&order=data.desc')); const assets = new Map(state.houses.map(asset => [asset.id, asset]));
  app.innerHTML = heading('Despesas', 'Gastos', 'Registre gastos atuais ou retroativos associados aos seus patrimônios.') + `<section class="card form-card"><h2 class="card-title">Novo gasto</h2><form id="expense-form" class="form-grid"><div class="field"><label>Patrimônio *</label><select name="patrimonio_id" required><option value="">Selecione</option>${assetOptions()}</select></div><div class="field"><label>Descrição *</label><input name="descricao" required></div><div class="field"><label>Categoria *</label><input name="categoria" required></div><div class="field"><label>Valor *</label><input name="valor" type="number" min="0.01" step="0.01" required></div><div class="field"><label>Data do gasto *</label><input name="data" type="date" required value="${new Date().toISOString().slice(0,10)}"></div><div class="form-actions"><button class="button">Salvar gasto</button></div></form></section><section class="card table-card"><div class="table-head"><h2>Gastos</h2><button id="reload" class="button secondary small">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>Patrimônio</th><th>Descrição</th><th>Valor</th><th>Data do gasto</th><th>Status</th><th>Pago em</th><th></th></tr></thead><tbody>${gastos.map(item => `<tr><td>${esc(assets.has(item.patrimonio_id) ? assetLabel(assets.get(item.patrimonio_id)) : 'Patrimônio removido')}</td><td>${esc(item.descricao)}<br><small>${esc(item.categoria)}</small></td><td>${money(item.valor)}</td><td><input class="table-date" type="date" data-expense-date="${item.id}" value="${esc(item.data)}"></td><td><span class="pill ${item.pago ? 'ok' : 'pending'}">${item.pago ? 'Pago' : 'Pendente'}</span></td><td>${item.data_pagamento ? dateTime(item.data_pagamento) : '—'}</td><td><div class="action-row"><button class="icon-button" data-save-expense-date="${item.id}">Atualizar data</button><button class="icon-button" data-expense-paid="${item.id}" data-paid="${item.pago}">${item.pago ? 'Desfazer' : 'Marcar pago'}</button></div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhum gasto cadastrado.</td></tr>'}</tbody></table></div></section>`;
  app.querySelector('#expense-form').onsubmit = createExpense; app.querySelector('#reload').onclick = refresh;
  app.querySelectorAll('[data-save-expense-date]').forEach(button => button.onclick = async () => { const date = app.querySelector(`[data-expense-date="${button.dataset.saveExpenseDate}"]`).value; if (!date) return notify('Informe a data do gasto.', true); try { await api(rest('gastos_casa', `id=eq.${button.dataset.saveExpenseDate}`), jsonOptions('PATCH', { data: date }, { Prefer: 'return=minimal' })); notify('Data do gasto atualizada.'); await loadGastos(); } catch (error) { notify(error.message, true); } });
  app.querySelectorAll('[data-expense-paid]').forEach(button => button.onclick = () => patchExpense(button.dataset.expensePaid, button.dataset.paid !== 'true'));
}

async function openManualPaymentForm() {
  const assets = state.houses.length ? state.houses : await fetchHouses(); const modal = document.createElement('div'); modal.className = 'modal-backdrop'; modal.id = 'manual-payment-modal';
  modal.innerHTML = `<section class="modal property-modal payment-modal"><button class="modal-close" type="button">×</button><p class="eyebrow">Novo pagamento</p><h2>Adicionar pagamento</h2><form id="manual-payment-form" class="form-grid"><div class="field"><label>Patrimônio *</label><select name="patrimonio_id" required><option value="">Selecione</option>${assets.map(asset => `<option value="${asset.id}">${esc(assetLabel(asset))}</option>`).join('')}</select></div><div class="field"><label>Tipo *</label><select name="tipo"><option value="recorrente">Recorrente</option><option value="avulso">Avulso</option></select></div><div class="field"><label>Valor *</label><input name="valor" type="number" min="0.01" step="0.01" required></div><div class="field"><label>Data do lançamento *</label><input name="data_lancamento" type="date" required value="${new Date().toISOString().slice(0,10)}"></div><div class="field"><label>Data de vencimento <small>(somente recorrente)</small></label><input name="data_vencimento" type="date"></div><div class="modal-actions"><button type="button" class="button secondary modal-cancel">Cancelar</button><button class="button">Salvar</button></div></form></section>`;
  document.body.append(modal); modal.querySelector('#manual-payment-form').onsubmit = createManualPayment; modal.querySelectorAll('.modal-close,.modal-cancel').forEach(button => button.onclick = () => modal.remove());
}
async function createManualPayment(event) { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); if (data.tipo === 'recorrente' && !data.data_vencimento) return notify('Informe a data de vencimento do pagamento recorrente.', true); try { await api(rest('pagamentos_casa'), jsonOptions('POST', { patrimonio_id: Number(data.patrimonio_id), tipo: data.tipo, valor: Number(data.valor), data_lancamento: data.data_lancamento, data_vencimento: data.tipo === 'recorrente' ? data.data_vencimento : null, pago: false }, { Prefer: 'return=minimal' })); document.querySelector('#manual-payment-modal')?.remove(); notify('Pagamento cadastrado.'); await loadPagamentos(); } catch (error) { notify(error.message, true); } }
async function loadPagamentos() {
  await fetchHouses(); const payments = await api(rest('pagamentos_casa', 'select=id,patrimonio_id,tipo,valor,data_lancamento,data_vencimento,pago,data_recebimento&order=data_lancamento.desc.nullslast')); const assets = new Map(state.houses.map(asset => [asset.id, asset]));
  const received = payments.filter(item => item.pago).reduce((sum, item) => sum + Number(item.valor), 0); const pending = payments.filter(item => !item.pago).reduce((sum, item) => sum + Number(item.valor), 0);
  app.innerHTML = heading('Receitas', 'Pagamentos', 'Cadastre pagamentos atuais ou retroativos.', '<button id="add-manual-payment" class="button">Adicionar pagamento</button>') + `<section class="summary"><div class="card metric"><span>Pagamentos cadastrados</span><strong>${payments.length}</strong></div><div class="card metric"><span>Recebido</span><strong>${money(received)}</strong></div><div class="card metric"><span>Pendente</span><strong>${money(pending)}</strong></div></section><section class="card table-card"><div class="table-head"><h2>Todos os pagamentos</h2><button id="reload" class="button secondary small">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>Patrimônio</th><th>Tipo</th><th>Valor</th><th>Lançamento</th><th>Vencimento</th><th>Status</th><th>Recebido em</th><th></th></tr></thead><tbody>${payments.length ? payments.map(item => `<tr><td>${esc(assets.has(item.patrimonio_id) ? assetLabel(assets.get(item.patrimonio_id)) : 'Patrimônio removido')}</td><td>${item.tipo === 'recorrente' ? 'Recorrente' : 'Avulso'}</td><td>${money(item.valor)}</td><td>${item.data_lancamento ? dateTime(item.data_lancamento) : '—'}</td><td>${item.data_vencimento ? dateTime(item.data_vencimento) : '—'}</td><td><span class="pill ${item.pago ? 'ok' : 'pending'}">${item.pago ? 'Recebido' : 'Pendente'}</span></td><td><input class="table-date" type="date" data-received-date="${item.id}" value="${esc(item.data_recebimento || new Date().toISOString().slice(0,10))}"></td><td><button class="icon-button" data-save-payment="${item.id}" data-paid="${item.pago}">${item.pago ? 'Atualizar' : 'Marcar recebido'}</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty">Nenhum pagamento cadastrado.</td></tr>'}</tbody></table></div></section>`;
  document.querySelector('#reload').onclick = refresh; document.querySelector('#add-manual-payment').onclick = openManualPaymentForm;
  app.querySelectorAll('[data-save-payment]').forEach(button => button.onclick = async () => { const date = app.querySelector(`[data-received-date="${button.dataset.savePayment}"]`).value; if (!date) return notify('Informe a data de recebimento.', true); try { await api(rest('pagamentos_casa', `id=eq.${button.dataset.savePayment}`), jsonOptions('PATCH', { pago: true, data_recebimento: date }, { Prefer: 'return=minimal' })); notify('Pagamento atualizado.'); await loadPagamentos(); } catch (error) { notify(error.message, true); } });
}

async function showCalendarDay(day, events, referenceDate) {
  const target = document.querySelector('#calendar-day-details'); if (!target) return;
  const date = `${referenceDate.getFullYear()}-${String(referenceDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const label = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00`));
  target.innerHTML = `<strong>${label}</strong>${events?.length ? events.map(event => `<span class="calendar-detail ${event.type}">${esc(event.label)}</span>`).join('') : '<span>Nenhum lançamento neste dia.</span>'}<p class="detail-empty">Carregando…</p>`;
  try {
    const [payments, expensesByDueDate, expensesByDate] = await Promise.all([
      api(rest('pagamentos_casa', `select=id,patrimonio_id,categoria,valor&data_vencimento=eq.${date}&pago=eq.false`)),
      api(rest('gastos_casa', `select=id,patrimonio_id,descricao,categoria,valor&data_vencimento=eq.${date}&pago=eq.false`)),
      api(rest('gastos_casa', `select=id,patrimonio_id,descricao,categoria,valor&data=eq.${date}&pago=eq.false`)),
    ]);
    const expenses = [...new Map([...expensesByDueDate, ...expensesByDate].map(item => [item.id, item])).values()];
    const assets = new Map(state.houses.map(asset => [asset.id, asset])); const labelFor = id => assets.has(id) ? assetLabel(assets.get(id)) : 'Patrimônio removido';
    const actions = `${payments.map(item => `<div class="calendar-day-action receive"><span><strong>${esc(labelFor(item.patrimonio_id))}</strong><small>Receber ${money(item.valor)} · ${esc(normalizeCategory(item.categoria || 'OUTRAS RECEITAS'))}</small></span><button class="calendar-reminder-action" data-day-receive="${item.id}">Receber</button></div>`).join('')}${expenses.map(item => `<div class="calendar-day-action pay"><span><strong>${esc(item.descricao)}</strong><small>Pagar ${money(item.valor)} · ${esc(normalizeCategory(item.categoria || 'SEM CATEGORIA'))}</small></span><button class="calendar-reminder-action" data-day-pay="${item.id}">Pagar</button></div>`).join('')}`;
    const loading = target.querySelector('.detail-empty'); if (loading) loading.outerHTML = actions || '<p class="detail-empty">Nenhuma ação pendente neste dia.</p>';
    target.querySelectorAll('[data-day-receive]').forEach(button => button.onclick = async () => { try { await api(rest('pagamentos_casa', `id=eq.${button.dataset.dayReceive}`), jsonOptions('PATCH', { pago: true, data_recebimento: new Date().toISOString().slice(0, 10) }, { Prefer: 'return=minimal' })); notify('Receita marcada como recebida.'); await renderHomeCalendar(); } catch (error) { notify(error.message, true); } });
    target.querySelectorAll('[data-day-pay]').forEach(button => button.onclick = async () => { try { await api(rest('gastos_casa', `id=eq.${button.dataset.dayPay}`), jsonOptions('PATCH', { pago: true, data_pagamento: new Date().toISOString().slice(0, 10) }, { Prefer: 'return=minimal' })); notify('Gasto marcado como pago.'); await renderHomeCalendar(); } catch (error) { notify(error.message, true); } });
  } catch (error) { target.querySelector('.detail-empty')?.replaceWith(Object.assign(document.createElement('p'), { className: 'detail-empty', textContent: error.message })); }
}

async function loadCasas() {
  const assets = await fetchHouses();
  if (!assets.some(asset => asset.id === state.selectedHouseId)) state.selectedHouseId = null;
  const total = assets.reduce((sum, asset) => sum + Number(asset.valor_patrimonio || 0), 0);
  const selected = assets.find(asset => asset.id === state.selectedHouseId);
  const cards = assets.length ? assets.map(asset => `<button class="property-choice ${state.selectedHouseId === asset.id ? 'selected' : ''}" data-property="${asset.id}">${propertyIcon(asset.tipo_patrimonio)}<strong>${esc(asset.nome)}</strong><small>${asset.tipo_patrimonio === 'casa' ? `Casa · ${esc(asset.rua || 'Sem endereço')}${asset.numero ? `, ${esc(asset.numero)}` : ''}` : asset.tipo_patrimonio === 'carro' ? 'Veículo' : 'Outro patrimônio'}</small></button>`).join('') : '<div class="card empty">Você ainda não cadastrou patrimônios.</div>';
  app.innerHTML = heading('Patrimônio', 'Meus patrimônios', 'Gerencie casas, veículos e outros bens.', '<div class="heading-actions"><button id="reload" class="button secondary">Atualizar</button><button id="add-property" class="button">Adicionar patrimônio</button></div>') + `<section class="summary"><div class="card metric"><span>Patrimônios cadastrados</span><strong>${assets.length}</strong></div><div class="card metric"><span>Valor patrimonial</span><strong>${money(total)}</strong></div><div class="card metric"><span>Selecionado</span><strong>${selected ? esc(assetLabel(selected)) : '—'}</strong></div></section><section class="property-picker"><div class="picker-heading"><div><p class="eyebrow">Seleção de patrimônio</p><h2>Escolha um patrimônio</h2></div><p>Clique em um item para abrir os detalhes.</p></div><div class="property-grid">${cards}</div></section><div id="selected-property">${state.selectedHouseId ? '<div class="card empty">Carregando dados…</div>' : '<section class="card property-empty"><div>◆</div><h2>Selecione um patrimônio</h2><p>Os detalhes financeiros, gastos e documentos aparecerão aqui.</p></section>'}</div>`;
  app.querySelector('#reload').onclick = refresh; app.querySelector('#add-property').onclick = openPropertyForm; app.querySelectorAll('[data-property]').forEach(button => button.onclick = () => selectProperty(Number(button.dataset.property)));
  await renderHomeCalendar();
  if (state.selectedHouseId) await renderSelectedProperty();
  const layout = app.querySelector('.calendar-layout'); const picker = app.querySelector('.property-picker');
  // A ordem da página é estável: resumo, calendário, lista e detalhes.
  if (layout && picker) picker.before(layout);
}

// Campos ampliados do patrimônio. As fotos são guardadas como documentos de imagem
// do próprio patrimônio, para que também respeitem o limite de armazenamento do plano.
function propertySpecificFields(type, asset = {}) {
  const field = (label, name, extra = '') => `<div class="field"><label>${label}</label><input name="${name}" ${extra} value="${esc(asset[name] ?? '')}"></div>`;
  if (type === 'casa') return `${field('Rua', 'rua')}${field('Número', 'numero', 'type="number" min="1"')}${field('Complemento', 'complemento')}${field('Matrícula', 'matricula')}${field('Inscrição IPTU', 'inscricao_iptu')}${field('Área (m²)', 'area_m2', 'type="number" min="0" step="0.01"')}${field('Quartos', 'quartos', 'type="number" min="0"')}${field('Banheiros', 'banheiros', 'type="number" min="0"')}`;
  if (type === 'carro') return `${field('Marca e modelo', 'marca_modelo')}${field('Placa', 'placa', 'maxlength="8" placeholder="ABC1D23"')}${field('RENAVAM', 'renavam')}${field('Ano de fabricação', 'ano_fabricacao', 'type="number" min="1886" max="2100"')}${field('Cor', 'cor')}`;
  return field('Documento ou referência', 'documento_referencia');
}
function propertyCommonFields(asset = {}, includePhotos = true) {
  return `<div class="field"><label>Data de aquisição</label><input name="data_aquisicao" type="date" value="${esc(asset.data_aquisicao || '')}"></div><div class="field"><label>Descrição</label><input name="descricao" value="${esc(asset.descricao || '')}" placeholder="Ex.: imóvel para locação"></div><div class="field property-notes"><label>Observações</label><textarea name="observacoes" placeholder="Informações adicionais">${esc(asset.observacoes || '')}</textarea></div>${includePhotos ? '<div class="field property-photos"><label>Fotos</label><input name="fotos" type="file" accept="image/png,image/jpeg,image/webp" multiple><small>PNG, JPEG ou WebP. As fotos ficam nos documentos do patrimônio.</small></div>' : ''}`;
}
function propertyPayload(data, type) {
  const number = name => data[name] === '' || data[name] == null ? null : Number(data[name]);
  const text = name => String(data[name] || '').trim() || null;
  return {
    tipo_patrimonio: type, nome: String(data.nome || '').trim(), valor_patrimonio: number('valor_patrimonio'),
    descricao: text('descricao'), data_aquisicao: data.data_aquisicao || null, observacoes: text('observacoes'),
    rua: type === 'casa' ? text('rua') : null, numero: type === 'casa' ? number('numero') : null, complemento: type === 'casa' ? text('complemento') : null,
    matricula: type === 'casa' ? text('matricula') : null, inscricao_iptu: type === 'casa' ? text('inscricao_iptu') : null, area_m2: type === 'casa' ? number('area_m2') : null, quartos: type === 'casa' ? number('quartos') : null, banheiros: type === 'casa' ? number('banheiros') : null,
    placa: type === 'carro' ? text('placa')?.toLocaleUpperCase('pt-BR') : null, renavam: type === 'carro' ? text('renavam') : null, marca_modelo: type === 'carro' ? text('marca_modelo') : null, ano_fabricacao: type === 'carro' ? number('ano_fabricacao') : null, cor: type === 'carro' ? text('cor') : null,
    documento_referencia: type === 'outro' ? text('documento_referencia') : null,
  };
}
async function uploadPropertyPhotos(assetId, files) {
  for (const file of [...files]) {
    if (!file.size) continue;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Use imagens PNG, JPEG ou WebP.');
    await checkPlanQuota('document', assetId);
    const path = `patrimonios/${assetId}/fotos/${crypto.randomUUID()}_${safeFileName(file.name)}`;
    const rows = await api(rest('documentos_casa'), jsonOptions('POST', { patrimonio_id: assetId, nome_arquivo: file.name, tipo_arquivo: file.type, tamanho: file.size, caminho_arquivo: path, descricao: 'Foto do patrimônio' }, { Prefer: 'return=representation' }));
    try { await api('/storage/v1/object/documentos/' + path.split('/').map(encodeURIComponent).join('/'), { method: 'POST', headers: { 'Content-Type': file.type, 'x-upsert': 'false' }, body: file }); }
    catch (error) { await api(rest('documentos_casa', `id=eq.${rows[0].id}`), jsonOptions('DELETE', null)); throw error; }
  }
}
function openPropertyForm() {
  document.querySelector('#add-property-modal')?.remove(); const modal = document.createElement('div'); modal.id = 'add-property-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<section class="modal property-modal asset-modal"><button class="modal-close" type="button">×</button><p class="eyebrow">Novo patrimônio</p><h2>Adicionar patrimônio</h2><form id="add-property-form" class="form-grid"><div class="field"><label>Tipo *</label><select name="tipo_patrimonio" id="asset-type"><option value="casa">Casa</option><option value="carro">Carro</option><option value="outro">Outro</option></select></div><div class="field"><label>Nome / identificação *</label><input name="nome" required placeholder="Ex.: Casa Jardim ou Honda Civic"></div><div class="field"><label>Valor do patrimônio</label><input name="valor_patrimonio" type="number" min="0" step="0.01"></div><div id="asset-specific-fields" class="asset-extra-fields">${propertySpecificFields('casa')}</div>${propertyCommonFields()}<div class="modal-actions"><button type="button" class="button secondary modal-cancel">Cancelar</button><button class="button">Cadastrar</button></div></form></section>`;
  document.body.append(modal); const type = modal.querySelector('#asset-type'); type.onchange = () => { modal.querySelector('#asset-specific-fields').innerHTML = propertySpecificFields(type.value); };
  modal.querySelector('#add-property-form').onsubmit = createHouse; modal.querySelectorAll('.modal-close,.modal-cancel').forEach(button => button.onclick = () => modal.remove());
}
async function createHouse(event) {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('.button:not([type=button])'); if (button.disabled) return; button.disabled = true;
  const data = Object.fromEntries(new FormData(form)); const files = form.querySelector('[name="fotos"]')?.files || [];
  try { await checkPlanQuota('asset'); const rows = await api(rest('patrimonio'), jsonOptions('POST', propertyPayload(data, data.tipo_patrimonio), { Prefer: 'return=representation' })); await uploadPropertyPhotos(rows[0].id, files); document.querySelector('#add-property-modal')?.remove(); notify('Patrimônio cadastrado.'); await refresh(); }
  catch (error) { notify(error.message, true); } finally { button.disabled = false; }
}
async function fetchHouses() { state.houses = await api(rest('patrimonio', 'select=id,created_at,nome,tipo_patrimonio,rua,numero,complemento,valor_patrimonio,descricao,data_aquisicao,observacoes,matricula,inscricao_iptu,area_m2,quartos,banheiros,placa,renavam,marca_modelo,ano_fabricacao,cor,documento_referencia&order=id.desc')); return state.houses; }
async function renderSelectedProperty() {
  const asset = state.houses.find(item => item.id === state.selectedHouseId); const target = document.querySelector('#selected-property'); if (!asset || !target) return;
  try {
    const [payments, expenses, docs] = await Promise.all([api(rest('pagamentos_casa', `select=id,valor,pago&patrimonio_id=eq.${asset.id}`)), api(rest('gastos_casa', `select=valor&patrimonio_id=eq.${asset.id}`)), api(rest('documentos_casa', `select=id,nome_arquivo,tipo_arquivo,descricao&patrimonio_id=eq.${asset.id}&order=data_upload.desc`))]);
    const received = payments.filter(item => item.pago).reduce((sum, item) => sum + Number(item.valor || 0), 0); const expensesTotal = expenses.reduce((sum, item) => sum + Number(item.valor || 0), 0); const photos = docs.filter(item => String(item.tipo_arquivo || '').startsWith('image/'));
    const detailRows = asset.tipo_patrimonio === 'casa' ? [['Matrícula', asset.matricula], ['IPTU', asset.inscricao_iptu], ['Área', asset.area_m2 == null ? null : `${asset.area_m2} m²`], ['Quartos', asset.quartos], ['Banheiros', asset.banheiros]] : asset.tipo_patrimonio === 'carro' ? [['Marca/modelo', asset.marca_modelo], ['Placa', asset.placa], ['RENAVAM', asset.renavam], ['Ano', asset.ano_fabricacao], ['Cor', asset.cor]] : [['Referência', asset.documento_referencia]];
    target.innerHTML = `<section class="property-summary"><div class="property-summary-title">${propertyIcon(asset.tipo_patrimonio)}<div><p class="eyebrow">${esc(asset.tipo_patrimonio)}</p><h2>${esc(assetLabel(asset))}</h2><p>${esc(asset.descricao || 'Patrimônio cadastrado')}</p></div></div><button class="icon-button delete" data-delete-house="${asset.id}">Excluir</button></section><section class="detail-metrics"><div class="card metric"><span>Valor do patrimônio</span><strong>${asset.valor_patrimonio == null ? '—' : money(asset.valor_patrimonio)}</strong></div><div class="card metric"><span>Recebido</span><strong>${money(received)}</strong></div><div class="card metric"><span>Gastos</span><strong>${money(expensesTotal)}</strong></div><div class="card metric"><span>Fotos</span><strong>${photos.length}</strong></div></section><section class="card asset-information"><h3>Informações do patrimônio</h3><div class="asset-information-grid">${detailRows.filter(([, value]) => value !== null && value !== '').map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(String(value))}</strong></div>`).join('') || '<p class="detail-empty">Nenhuma informação adicional cadastrada.</p>'}</div>${asset.observacoes ? `<p class="asset-notes"><strong>Observações</strong>${esc(asset.observacoes)}</p>` : ''}</section><section class="card property-panel property-photo-panel"><h3>Fotos</h3>${photos.length ? photos.map(photo => `<div class="property-row"><span><strong>${esc(shortFileName(photo.nome_arquivo))}</strong><small>${esc(photo.descricao || 'Foto do patrimônio')}</small></span><button class="icon-button small" data-open-property-document="${photo.id}">Abrir</button></div>`).join('') : '<p class="detail-empty">Nenhuma foto enviada.</p>'}</section><section class="card edit-property"><h3>Editar patrimônio</h3><form id="property-edit-form" class="form-grid"><div class="field"><label>Nome *</label><input name="nome" required value="${esc(asset.nome)}"></div><div class="field"><label>Valor</label><input name="valor_patrimonio" type="number" min="0" step="0.01" value="${asset.valor_patrimonio ?? ''}"></div><div class="asset-extra-fields">${propertySpecificFields(asset.tipo_patrimonio, asset)}</div>${propertyCommonFields(asset)}<div class="modal-actions"><button class="button">Salvar alterações</button></div></form></section>`;
    target.querySelector('[data-delete-house]').onclick = () => removeHouse(asset.id); target.querySelector('#property-edit-form').onsubmit = event => updateProperty(event, asset.id); target.querySelectorAll('[data-open-property-document]').forEach(button => button.onclick = () => openPropertyDocument(Number(button.dataset.openPropertyDocument)));
  } catch (error) { target.innerHTML = `<div class="card empty">Não foi possível carregar este patrimônio.<br><small>${esc(error.message)}</small></div>`; }
}
async function updateProperty(event, id) { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); const asset = state.houses.find(item => item.id === id); try { await api(rest('patrimonio', `id=eq.${id}`), jsonOptions('PATCH', propertyPayload(data, asset.tipo_patrimonio), { Prefer: 'return=minimal' })); await uploadPropertyPhotos(id, form.querySelector('[name="fotos"]')?.files || []); notify('Patrimônio atualizado.'); await loadCasas(); } catch (error) { notify(error.message, true); } }

function openPropertyMetricModal(title, content, action = null) {
  document.querySelector('#property-metric-modal')?.remove();
  const modal = document.createElement('div'); modal.id = 'property-metric-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<section class="modal property-modal metric-modal"><button class="modal-close" type="button" aria-label="Fechar">×</button><p class="eyebrow">Detalhes</p><h2>${esc(title)}</h2><div class="metric-modal-content">${content}</div><div class="modal-actions">${action ? `<button type="button" class="button" data-metric-add>${esc(action.label)}</button>` : ''}<button type="button" class="button secondary modal-cancel">Fechar</button></div></section>`;
  document.body.append(modal); modal.querySelectorAll('.modal-close,.modal-cancel').forEach(button => button.onclick = () => modal.remove());
  modal.querySelectorAll('[data-open-metric-document]').forEach(button => button.onclick = () => openPropertyDocument(Number(button.dataset.openMetricDocument)));
  modal.querySelectorAll('[data-preview-property-photo]').forEach(button => button.onclick = () => previewPropertyPhoto(Number(button.dataset.previewPropertyPhoto)));
  modal.querySelector('[data-metric-add]')?.addEventListener('click', () => action.run(modal));
}
async function previewPropertyPhoto(id) {
  try {
    const rows = await api(rest('documentos_casa', `select=id,nome_arquivo,caminho_arquivo&patrimonio_id=eq.${state.selectedHouseId}&id=eq.${id}`)); const photo = rows[0];
    if (!photo) throw new Error('Foto não encontrada.');
    const signedData = await api(`/storage/v1/object/sign/documentos/${photo.caminho_arquivo.split('/').map(encodeURIComponent).join('/')}`, jsonOptions('POST', { expiresIn: 3600 })); const signed = signedData.signedURL || signedData.signedUrl;
    if (!signed) throw new Error('Não foi possível carregar a foto.');
    const url = signed.startsWith('http') ? signed : `${supabaseBase()}/storage/v1${signed}`; document.querySelector('#property-metric-modal')?.remove();
    const modal = document.createElement('div'); modal.id = 'property-photo-preview'; modal.className = 'modal-backdrop';
    modal.innerHTML = `<section class="modal property-modal photo-preview-modal"><button class="modal-close" type="button" aria-label="Fechar">×</button><p class="eyebrow">Foto do patrimônio</p><h2>${esc(shortFileName(photo.nome_arquivo))}</h2><img src="${esc(url)}" alt="${esc(photo.nome_arquivo)}"><div class="modal-actions"><a class="button secondary" href="${esc(url)}" target="_blank" rel="noopener">Abrir em outra aba</a><button type="button" class="button modal-cancel">Fechar</button></div></section>`;
    document.body.append(modal); modal.querySelectorAll('.modal-close,.modal-cancel').forEach(button => button.onclick = () => modal.remove());
  } catch (error) { notify(error.message, true); }
}
function metricRows(items, render, empty) { return items.length ? `<div class="metric-list">${items.map(render).join('')}</div>` : `<p class="detail-empty">${empty}</p>`; }
async function renderSelectedProperty() {
  const asset = state.houses.find(item => item.id === state.selectedHouseId); const target = document.querySelector('#selected-property'); if (!asset || !target) return;
  try {
    const [payments, expenses, docs] = await Promise.all([
      api(rest('pagamentos_casa', `select=id,categoria,tipo,valor,pago,data_lancamento,data_vencimento,data_recebimento&patrimonio_id=eq.${asset.id}&order=data_lancamento.desc.nullslast`)),
      api(rest('gastos_casa', `select=id,descricao,categoria,valor,pago,data,data_pagamento,data_vencimento&patrimonio_id=eq.${asset.id}&order=data.desc`)),
      api(rest('documentos_casa', `select=id,nome_arquivo,tipo_arquivo,descricao,data_upload&patrimonio_id=eq.${asset.id}&order=data_upload.desc`)),
    ]);
    const receivedPayments = payments.filter(item => item.pago); const received = receivedPayments.reduce((sum, item) => sum + Number(item.valor || 0), 0); const expensesTotal = expenses.reduce((sum, item) => sum + Number(item.valor || 0), 0); const photos = docs.filter(item => String(item.tipo_arquivo || '').startsWith('image/')); const documents = docs.filter(item => !String(item.tipo_arquivo || '').startsWith('image/'));
    const detailRows = asset.tipo_patrimonio === 'casa' ? [['Matrícula', asset.matricula], ['IPTU', asset.inscricao_iptu], ['Área', asset.area_m2 == null ? null : `${asset.area_m2} m²`], ['Quartos', asset.quartos], ['Banheiros', asset.banheiros]] : asset.tipo_patrimonio === 'carro' ? [['Marca/modelo', asset.marca_modelo], ['Placa', asset.placa], ['RENAVAM', asset.renavam], ['Ano', asset.ano_fabricacao], ['Cor', asset.cor]] : [['Referência', asset.documento_referencia]];
    const metric = (kind, label, value, tone = '') => `<button type="button" class="card metric metric-clickable ${tone}" data-property-metric="${kind}"><span>${label}</span><strong>${value}</strong><small>Ver detalhes</small></button>`;
    target.innerHTML = `<section class="property-summary"><div class="property-summary-title">${propertyIcon(asset.tipo_patrimonio)}<div><p class="eyebrow">${esc(asset.tipo_patrimonio)}</p><h2>${esc(assetLabel(asset))}</h2><p>${esc(asset.descricao || 'Patrimônio cadastrado')}</p></div></div><button class="icon-button delete" data-delete-house="${asset.id}">Excluir</button></section><section class="detail-metrics detail-metrics-five">${metric('value', 'Valor do patrimônio', asset.valor_patrimonio == null ? '—' : money(asset.valor_patrimonio))}${metric('received', 'Recebido', money(received), 'revenue-metric')}${metric('expenses', 'Gastos', `− ${money(expensesTotal)}`, 'expense-metric')}${metric('photos', 'Fotos', photos.length)}${metric('documents', 'Documentos', documents.length)}</section><section class="card asset-information"><h3>Informações do patrimônio</h3><div class="asset-information-grid">${detailRows.filter(([, value]) => value !== null && value !== '').map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(String(value))}</strong></div>`).join('') || '<p class="detail-empty">Nenhuma informação adicional cadastrada.</p>'}</div>${asset.observacoes ? `<p class="asset-notes"><strong>Observações</strong>${esc(asset.observacoes)}</p>` : ''}</section><section class="card edit-property"><h3>Editar patrimônio</h3><form id="property-edit-form" class="form-grid"><div class="field"><label>Nome *</label><input name="nome" required value="${esc(asset.nome)}"></div><div class="field"><label>Valor</label><input name="valor_patrimonio" type="number" min="0" step="0.01" value="${asset.valor_patrimonio ?? ''}"></div><div class="asset-extra-fields">${propertySpecificFields(asset.tipo_patrimonio, asset)}</div>${propertyCommonFields(asset)}<div class="modal-actions"><button class="button">Salvar alterações</button></div></form></section>`;
    const details = `<div class="asset-information-grid">${[['Tipo', asset.tipo_patrimonio], ['Nome', asset.nome], ['Valor', asset.valor_patrimonio == null ? '—' : money(asset.valor_patrimonio)], ['Aquisição', asset.data_aquisicao ? dateTime(asset.data_aquisicao) : '—'], ...detailRows].filter(([, value]) => value !== null && value !== '').map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(String(value))}</strong></div>`).join('')}</div>${asset.descricao ? `<p class="asset-notes"><strong>Descrição</strong>${esc(asset.descricao)}</p>` : ''}${asset.observacoes ? `<p class="asset-notes"><strong>Observações</strong>${esc(asset.observacoes)}</p>` : ''}`;
    const paymentList = metricRows(receivedPayments, item => `<div class="metric-list-row"><span><strong>${esc(normalizeCategory(item.categoria || 'OUTRAS RECEITAS'))}</strong><small>${item.data_recebimento ? `Recebido em ${dateTime(item.data_recebimento)}` : 'Recebido'}</small></span><b class="income-positive">${money(item.valor)}</b></div>`, 'Nenhum pagamento recebido.');
    const expenseList = metricRows(expenses, item => `<div class="metric-list-row"><span><strong>${esc(item.descricao)}</strong><small>${esc(normalizeCategory(item.categoria || 'SEM CATEGORIA'))} · ${dateTime(item.data)}</small></span><b class="expense-value">− ${money(item.valor)}</b></div>`, 'Nenhum gasto registrado.');
    const fileList = (items, message, photoList = false) => metricRows(items, item => `<div class="metric-list-row"><span><strong>${esc(shortFileName(item.nome_arquivo))}</strong><small>${esc(item.descricao || dateTime(item.data_upload))}</small></span><button class="icon-button small" ${photoList ? `data-preview-property-photo="${item.id}">Ver foto` : `data-open-metric-document="${item.id}">Abrir`}</button></div>`, message);
    target.querySelector('[data-delete-house]').onclick = () => removeHouse(asset.id); target.querySelector('#property-edit-form').onsubmit = event => updateProperty(event, asset.id);
    target.querySelectorAll('[data-property-metric]').forEach(button => button.onclick = () => {
      const content = { value: details, received: paymentList, expenses: expenseList, photos: fileList(photos, 'Nenhuma foto enviada.', true), documents: fileList(documents, 'Nenhum documento enviado.') }[button.dataset.propertyMetric];
      const openPageForm = async (page, buttonId) => { await goTo(page); app.querySelector(`#${buttonId}`)?.click(); const select = document.querySelector('[name="patrimonio_id"]'); if (select) select.value = String(asset.id); };
      const actions = {
        value: { label: 'Editar patrimônio', run: modal => { modal.remove(); target.querySelector('.edit-property')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
        received: { label: 'Adicionar receita', run: async modal => { modal.remove(); await openManualPaymentForm(); const select = document.querySelector('#manual-payment-form [name="patrimonio_id"]'); if (select) select.value = String(asset.id); } },
        expenses: { label: 'Adicionar gasto', run: modal => { modal.remove(); openPageForm('gastos', 'add-expense'); } },
        photos: { label: 'Adicionar fotos', run: modal => { modal.remove(); openPageForm('documentos', 'add-document'); } },
        documents: { label: 'Adicionar documento', run: modal => { modal.remove(); openPageForm('documentos', 'add-document'); } },
      };
      openPropertyMetricModal(button.querySelector('span').textContent, content, actions[button.dataset.propertyMetric]);
    });
  } catch (error) { target.innerHTML = `<div class="card empty">Não foi possível carregar este patrimônio.<br><small>${esc(error.message)}</small></div>`; }
}

function recurringPaymentKey(item, dueDate) { return [item.patrimonio_id, normalizeCategory(item.categoria || 'OUTRAS RECEITAS'), Number(item.valor || 0), dueDate].join('|'); }
async function ensureRecurringPaymentsForCurrentMonth(month) {
  if (month !== currentMonth()) return;
  const payments = await api(rest('pagamentos_casa', 'select=patrimonio_id,tipo,categoria,valor,data_vencimento,pago'));
  const [year, monthNumber] = month.split('-').map(Number); const lastDay = new Date(year, monthNumber, 0).getDate();
  const existing = new Set(payments.filter(item => item.data_vencimento).map(item => recurringPaymentKey(item, item.data_vencimento)));
  for (const payment of payments.filter(item => item.tipo === 'recorrente' && item.data_vencimento && item.data_vencimento.slice(0, 7) < month)) {
    const day = Math.min(Number(payment.data_vencimento.slice(8, 10)), lastDay); const dueDate = `${month}-${String(day).padStart(2, '0')}`; const key = recurringPaymentKey(payment, dueDate);
    if (existing.has(key)) continue;
    await api(rest('pagamentos_casa'), jsonOptions('POST', { patrimonio_id: payment.patrimonio_id, tipo: 'recorrente', categoria: normalizeCategory(payment.categoria || 'OUTRAS RECEITAS'), valor: Number(payment.valor), data_lancamento: dueDate, data_vencimento: dueDate, pago: false }, { Prefer: 'return=minimal' }));
    existing.add(key);
  }
}
async function renderHomeCalendar() {
  const picker = app.querySelector('.property-picker'); if (!picker) return;
  const month = state.calendarMonth || currentMonth(); state.calendarMonth = month; const start = `${month}-01`; const reference = new Date(`${start}T12:00:00`); const next = new Date(reference); next.setMonth(next.getMonth() + 1); const end = isoMonth(next.toISOString().slice(0, 7));
  try {
    await ensureRecurringPaymentsForCurrentMonth(month);
    const reminderStart = month === currentMonth() ? new Date().toISOString().slice(0, 10) : start;
    const [payments, expenses, reminders, expenseReminders] = await Promise.all([
      api(rest('pagamentos_casa', `select=patrimonio_id,data_recebimento,valor&data_recebimento=gte.${start}&data_recebimento=lt.${end}&pago=eq.true`)),
      api(rest('gastos_casa', `select=patrimonio_id,descricao,valor,pago,data&data=gte.${start}&data=lt.${end}`)),
      api(rest('pagamentos_casa', 'select=id,patrimonio_id,tipo,categoria,valor,data_vencimento&pago=eq.false&order=data_vencimento.asc.nullslast')),
      api(rest('gastos_casa', 'select=id,patrimonio_id,descricao,categoria,valor,data_vencimento&pago=eq.false&order=data_vencimento.asc.nullslast')),
    ]);
    const assets = new Map(state.houses.map(asset => [asset.id, asset])); const labelFor = id => assets.has(id) ? assetLabel(assets.get(id)) : 'Patrimônio removido'; const events = {}; const add = (date, label, type) => { if (!date) return; const day = Number(String(date).slice(8, 10)); (events[day] ||= []).push({ label, type }); };
    payments.forEach(item => add(item.data_recebimento, `Recebido ${money(item.valor)} · ${labelFor(item.patrimonio_id)}`, 'payment'));
    expenses.forEach(item => { const eventDate = item.pago ? (item.data_pagamento || item.data) : item.data; if (String(eventDate || '').slice(0, 7) === month) add(eventDate, `${item.pago ? 'Gasto pago' : 'Gasto pendente'} · ${item.descricao} (${money(item.valor)})`, item.pago ? 'expense-paid' : 'expense-pending'); });
    reminders.forEach(item => { if (String(item.data_vencimento || '').slice(0, 7) === month) add(item.data_vencimento, `Lembrete de receber · ${money(item.valor)}`, 'due'); });
    const days = new Date(reference.getFullYear(), reference.getMonth() + 1, 0).getDate(); const first = new Date(reference.getFullYear(), reference.getMonth(), 1).getDay(); const blanks = Array.from({ length: first }, () => '<div class="calendar-day blank"></div>').join(''); const today = new Date();
    const cells = Array.from({ length: days }, (_, index) => { const day = index + 1; const isToday = day === today.getDate() && reference.getMonth() === today.getMonth() && reference.getFullYear() === today.getFullYear(); const dayEvents = events[day] || []; const summary = dayEvents.length >= 3 ? `<span class="calendar-event calendar-more">${dayEvents.length} ações</span>` : dayEvents.map(event => `<span class="calendar-event ${event.type}">${esc(event.label)}</span>`).join(''); return `<button type="button" class="calendar-day ${isToday ? 'today' : ''}" data-calendar-day="${day}"><strong>${day}</strong>${summary}</button>`; }).join('');
    app.querySelector('.calendar-layout')?.remove(); picker.insertAdjacentHTML('afterend', `<section class="calendar-card card"><div class="calendar-head"><div><p class="eyebrow">Visão geral</p><h2>Calendário financeiro</h2></div><div class="toolbar"><label for="calendar-month">Mês</label><input class="month-control" id="calendar-month" type="month" value="${month}"></div></div><div class="calendar-weekdays"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Sex</span><span>Sáb</span></div><div class="calendar-grid">${blanks}${cells}</div></section><section id="calendar-day-details" class="calendar-day-details card">Clique em um dia para ver os lançamentos.</section><aside class="card calendar-reminders"><p class="eyebrow">Lembretes</p><h2>Próximos vencimentos</h2><p class="calendar-reminder-note">Receitas e gastos pendentes em ${esc(new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(reference))}.</p>${reminders.map(item => `<div class="calendar-reminder"><span>${dateTime(item.data_vencimento)}</span><button class="calendar-reminder-action" data-reminder-payment="${item.id}">Recebi</button><strong>${esc(labelFor(item.patrimonio_id))}</strong><small>RECEBER · ${esc(normalizeCategory(item.categoria || 'OUTRAS RECEITAS'))}</small><b>${money(item.valor)}</b></div>`).join('')}${expenseReminders.map(item => `<div class="calendar-reminder expense-reminder"><span>${dateTime(item.data_vencimento)}</span><button class="calendar-reminder-action" data-reminder-expense="${item.id}">Paguei</button><strong>${esc(labelFor(item.patrimonio_id))}</strong><small>PAGAR · ${esc(normalizeCategory(item.categoria || 'SEM CATEGORIA'))}</small><b>− ${money(item.valor)}</b></div>`).join('')}${!reminders.length && !expenseReminders.length ? '<p class="detail-empty">Nenhum vencimento pendente neste período.</p>' : ''}</aside>`);
    const calendar = app.querySelector('.calendar-card'); const details = app.querySelector('#calendar-day-details'); const reminderCard = app.querySelector('.calendar-reminders'); if (calendar && details && reminderCard) { reminderCard.querySelector('h2').textContent = 'Pendências'; reminderCard.querySelector('.calendar-reminder-note').textContent = 'Todas as receitas e gastos ainda pendentes.'; const layout = document.createElement('section'); layout.className = 'calendar-layout'; calendar.before(layout); layout.append(calendar, details, reminderCard); setTimeout(() => picker.before(layout)); }
    app.querySelector('#calendar-month').onchange = async event => { state.calendarMonth = event.currentTarget.value || currentMonth(); await renderHomeCalendar(); }; app.querySelectorAll('[data-calendar-day]').forEach(button => button.onclick = () => showCalendarDay(Number(button.dataset.calendarDay), events[Number(button.dataset.calendarDay)], reference));
    app.querySelectorAll('[data-reminder-payment]').forEach(button => button.onclick = async () => { try { await api(rest('pagamentos_casa', `id=eq.${button.dataset.reminderPayment}`), jsonOptions('PATCH', { pago: true, data_recebimento: new Date().toISOString().slice(0, 10) }, { Prefer: 'return=minimal' })); notify('Receita marcada como recebida.'); await renderHomeCalendar(); } catch (error) { notify(error.message, true); } });
    app.querySelectorAll('[data-reminder-expense]').forEach(button => button.onclick = async () => { try { await api(rest('gastos_casa', `id=eq.${button.dataset.reminderExpense}`), jsonOptions('PATCH', { pago: true, data_pagamento: new Date().toISOString().slice(0, 10) }, { Prefer: 'return=minimal' })); notify('Gasto marcado como pago.'); await renderHomeCalendar(); } catch (error) { notify(error.message, true); } });
  } catch (error) { console.warn('Calendário indisponível:', error); }
}

function promoteFormToModal(selector, buttonText, buttonId, submitHandler) {
  const form = app.querySelector(selector); const card = form?.closest('.form-card'); const headingElement = app.querySelector('.page-heading');
  if (!form || !card || !headingElement) return;
  const markup = card.innerHTML; card.remove();
  headingElement.insertAdjacentHTML('beforeend', `<button id="${buttonId}" class="button" type="button">${buttonText}</button>`);
  app.querySelector(`#${buttonId}`).onclick = () => {
    const modal = document.createElement('div'); modal.className = 'modal-backdrop'; modal.innerHTML = `<section class="modal property-modal payment-modal"><button class="modal-close" type="button">×</button>${markup.replace(/<h2[^>]*>.*?<\/h2>/, '')}</section>`; document.body.append(modal);
    const modalForm = modal.querySelector(selector); if (selector === '#expense-form') { const expenseDate = modalForm.querySelector('[name="data"]')?.closest('.field'); expenseDate?.insertAdjacentHTML('afterend', `<div class="field"><label>Data de vencimento</label><input name="data_vencimento" type="date"></div>`); } modalForm.onsubmit = submitHandler;
    const category = modal.querySelector('[name="categoria"]'); if (category) category.oninput = () => { category.value = category.value.toLocaleUpperCase('pt-BR'); };
    modal.querySelector('.modal-close').onclick = () => modal.remove();
  };
}

async function enhanceExpensePaymentDates() {
  const dueDates = new Map((await api(rest('gastos_casa', 'select=id,data_vencimento'))).map(item => [String(item.id), item.data_vencimento || '']));
  const header = app.querySelector('thead th:nth-child(6)'); if (header) header.textContent = 'Vencimento';
  app.querySelectorAll('tbody tr').forEach(row => {
    const update = row.querySelector('[data-update-expense]'); const toggle = row.querySelector('[data-toggle-expense]');
    if (!update || !toggle || !row.cells[5]) return;
    const dueDate = dueDates.get(String(update.dataset.updateExpense)) || '';
    row.cells[5].innerHTML = `<input class="table-date" type="date" data-expense-due-date="${update.dataset.updateExpense}" value="${dueDate}">`;
    update.onclick = async () => {
      const expenseDate = app.querySelector(`[data-expense-date="${update.dataset.updateExpense}"]`).value;
      const dueDate = app.querySelector(`[data-expense-due-date="${update.dataset.updateExpense}"]`).value;
      if (!expenseDate) return notify('Informe a data do gasto.', true);
      try { await api(rest('gastos_casa', `id=eq.${update.dataset.updateExpense}`), jsonOptions('PATCH', { data: expenseDate, data_vencimento: dueDate || null }, { Prefer: 'return=minimal' })); notify('Datas atualizadas.'); await refresh(); }
      catch (error) { notify(error.message, true); }
    };
  });
}

async function patchExpense(id, paid) {
  const date = paid ? new Date().toISOString().slice(0, 10) : null;
  try {
    await api(rest('gastos_casa', `id=eq.${id}`), jsonOptions('PATCH', { pago: paid, data_pagamento: date }, { Prefer: 'return=minimal' }));
    notify('Gasto atualizado.');
    await refresh();
  } catch (error) { notify(error.message, true); }
}

async function renderCategories() {
  setLoading('Carregando categorias…');
  try {
    const [payments, expenses, custom] = await Promise.all([
      api(rest('pagamentos_casa', 'select=categoria,valor')),
      api(rest('gastos_casa', 'select=categoria,valor')),
      fetchCustomCategories(),
    ]);
    const totalByCategory = rows => [...rows.reduce((map, row) => { const category = normalizeCategory(row.categoria || 'SEM CATEGORIA'); map.set(category, (map.get(category) || 0) + Number(row.valor || 0)); return map; }, new Map()).entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
    const income = totalByCategory(payments); const expense = totalByCategory(expenses);
    const defaults = { income: [...DEFAULT_INCOME_CATEGORIES, ...custom.filter(row => row.tipo === 'income').map(row => row.nome)], expense: [...DEFAULT_EXPENSE_CATEGORIES, ...custom.filter(row => row.tipo === 'expense').map(row => row.nome)] };
    const categoryRows = (rows, preset) => [...new Set([...preset, ...rows.map(row => row.name)])].map(name => ({ name, total: rows.find(row => row.name === name)?.total || 0 }));
    const card = (title, description, rows, preset, action) => `<article class="card category-card"><div><p class="eyebrow">${title}</p><h2>${description}</h2></div><div class="category-list">${categoryRows(rows, preset).map(row => `<div><span>${esc(row.name)}</span><strong>${money(row.total)}</strong></div>`).join('')}</div><button type="button" class="button secondary small" data-category-action="${action}">Cadastrar ${action === 'income' ? 'receita' : 'gasto'}</button></article>`;
    app.innerHTML = heading('Organização financeira', 'Categorias', 'Use as categorias básicas ou cadastre categorias exclusivas da sua conta.', '<button id="add-category" class="button">Nova categoria</button>') + `<section class="summary"><article class="card metric"><span>Categorias de receitas</span><strong>${categoryRows(income, defaults.income).length}</strong></article><article class="card metric"><span>Categorias de gastos</span><strong>${categoryRows(expense, defaults.expense).length}</strong></article><article class="card metric"><span>Total categorizado</span><strong>${money(payments.reduce((sum, row) => sum + Number(row.valor || 0), 0) + expenses.reduce((sum, row) => sum + Number(row.valor || 0), 0))}</strong></article></section><section class="category-grid">${card('Receitas', 'Total por categoria de receita', income, defaults.income, 'income')}${card('Gastos', 'Total por categoria de gasto', expense, defaults.expense, 'expense')}</section>`;
    app.querySelector('#add-category').onclick = () => openCategoryForm();
    app.querySelectorAll('[data-category-action]').forEach(button => button.onclick = () => goTo(button.dataset.categoryAction === 'income' ? 'pagamentos' : 'gastos'));
  } catch (error) { showError(error); }
}
async function selectProperty(id) {
  state.selectedHouseId = id;
  await loadCasas();
  const calendar = app.querySelector('.calendar-layout');
  const picker = app.querySelector('.property-picker');
  if (calendar && picker) picker.before(calendar);
}
async function removeFinancialRecord(table, id, reload) {
  if (!confirm('Excluir este lançamento? Esta ação não pode ser desfeita.')) return;
  try { await api(rest(table, `id=eq.${id}`), jsonOptions('DELETE', null, { Prefer: 'return=minimal' })); notify('Lançamento excluído.'); await reload(); }
  catch (error) { notify(error.message, true); }
}
async function loadPagamentos() {
  await fetchHouses(); const payments = await api(rest('pagamentos_casa', 'select=id,patrimonio_id,tipo,valor,data_lancamento,data_vencimento,pago,data_recebimento&order=data_lancamento.desc.nullslast')); const assets = new Map(state.houses.map(asset => [asset.id, asset]));
  const received = payments.filter(item => item.pago).reduce((sum, item) => sum + Number(item.valor), 0); const pending = payments.filter(item => !item.pago).reduce((sum, item) => sum + Number(item.valor), 0);
  app.innerHTML = heading('Receitas', 'Pagamentos', 'Cadastre pagamentos atuais ou retroativos.', '<button id="add-manual-payment" class="button">Adicionar pagamento</button>') + `<section class="summary"><div class="card metric"><span>Pagamentos cadastrados</span><strong>${payments.length}</strong></div><div class="card metric"><span>Recebido</span><strong>${money(received)}</strong></div><div class="card metric"><span>Pendente</span><strong>${money(pending)}</strong></div></section><section class="card table-card"><div class="table-head"><h2>Todos os pagamentos</h2><button id="reload" class="button secondary small">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>Patrimônio</th><th>Tipo</th><th>Valor</th><th>Lançamento</th><th>Vencimento</th><th>Status</th><th>Recebido em</th><th></th></tr></thead><tbody>${payments.length ? payments.map(item => `<tr><td>${esc(assets.has(item.patrimonio_id) ? assetLabel(assets.get(item.patrimonio_id)) : 'Patrimônio removido')}</td><td>${item.tipo === 'recorrente' ? 'Recorrente' : 'Avulso'}</td><td>${money(item.valor)}</td><td>${item.data_lancamento ? dateTime(item.data_lancamento) : '—'}</td><td>${item.data_vencimento ? dateTime(item.data_vencimento) : '—'}</td><td><span class="pill ${item.pago ? 'ok' : 'pending'}">${item.pago ? 'Recebido' : 'Pendente'}</span></td><td><input class="table-date" type="date" data-received-date="${item.id}" value="${esc(item.data_recebimento || new Date().toISOString().slice(0,10))}"></td><td><div class="action-row"><button class="icon-button" title="Atualizar data" aria-label="Atualizar data" data-update-payment="${item.id}">↻</button><button class="icon-button" title="${item.pago ? 'Marcar pendente' : 'Marcar recebido'}" aria-label="${item.pago ? 'Marcar pendente' : 'Marcar recebido'}" data-toggle-payment="${item.id}" data-paid="${item.pago}">${item.pago ? '↩' : '✓'}</button><button class="icon-button delete" title="Excluir pagamento" aria-label="Excluir pagamento" data-delete-payment="${item.id}">⌫</button></div></td></tr>`).join('') : '<tr><td colspan="8" class="empty">Nenhum pagamento cadastrado.</td></tr>'}</tbody></table></div></section>`;
  app.querySelector('#reload').onclick = refresh; app.querySelector('#add-manual-payment').onclick = openManualPaymentForm;
  app.querySelectorAll('[data-update-payment]').forEach(button => button.onclick = async () => { const date = app.querySelector(`[data-received-date="${button.dataset.updatePayment}"]`).value; if (!date) return notify('Informe a data de recebimento.', true); try { await api(rest('pagamentos_casa', `id=eq.${button.dataset.updatePayment}`), jsonOptions('PATCH', { pago: true, data_recebimento: date }, { Prefer: 'return=minimal' })); notify('Pagamento atualizado.'); await loadPagamentos(); } catch (error) { notify(error.message, true); } });
  app.querySelectorAll('[data-toggle-payment]').forEach(button => button.onclick = async () => { const paid = button.dataset.paid !== 'true'; const date = paid ? app.querySelector(`[data-received-date="${button.dataset.togglePayment}"]`).value : null; if (paid && !date) return notify('Informe a data de recebimento.', true); try { await api(rest('pagamentos_casa', `id=eq.${button.dataset.togglePayment}`), jsonOptions('PATCH', { pago: paid, data_recebimento: date }, { Prefer: 'return=minimal' })); notify('Status atualizado.'); await loadPagamentos(); } catch (error) { notify(error.message, true); } });
  app.querySelectorAll('[data-delete-payment]').forEach(button => button.onclick = () => removeFinancialRecord('pagamentos_casa', button.dataset.deletePayment, loadPagamentos));
}
  async function loadGastos() {
  await fetchHouses(); const gastos = await api(rest('gastos_casa', 'select=id,patrimonio_id,descricao,categoria,valor,pago,recorrente,data,data_pagamento&order=data.desc')); const assets = new Map(state.houses.map(asset => [asset.id, asset]));
  app.innerHTML = heading('Despesas', 'Gastos', 'Registre gastos atuais ou retroativos associados aos seus patrimônios.') + `<section class="card form-card"><h2 class="card-title">Novo gasto</h2><form id="expense-form" class="form-grid"><div class="field"><label>Patrimônio *</label><select name="patrimonio_id" required><option value="">Selecione</option>${assetOptions()}</select></div><div class="field"><label>Descrição *</label><input name="descricao" required></div><div class="field"><label>Categoria *</label><input name="categoria" required></div><div class="field"><label>Valor *</label><input name="valor" type="number" min="0.01" step="0.01" required></div><div class="field"><label>Data do gasto *</label><input name="data" type="date" required value="${new Date().toISOString().slice(0,10)}"></div><div class="form-actions"><button class="button">Salvar gasto</button></div></form></section><section class="card table-card"><div class="table-head"><h2>Gastos</h2><button id="reload" class="button secondary small">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>Patrimônio</th><th>Descrição</th><th>Valor</th><th>Data do gasto</th><th>Status</th><th>Pago em</th><th></th></tr></thead><tbody>${gastos.map(item => `<tr><td>${esc(assets.has(item.patrimonio_id) ? assetLabel(assets.get(item.patrimonio_id)) : 'Patrimônio removido')}</td><td>${esc(item.descricao)}<br><small>${esc(item.categoria)}</small></td><td>${money(item.valor)}</td><td><input class="table-date" type="date" data-expense-date="${item.id}" value="${esc(item.data)}"></td><td><span class="pill ${item.pago ? 'ok' : 'pending'}">${item.pago ? 'Pago' : 'Pendente'}</span></td><td>${item.data_pagamento ? dateTime(item.data_pagamento) : '—'}</td><td><div class="action-row"><button class="icon-button" title="Atualizar data" aria-label="Atualizar data" data-update-expense="${item.id}">↻</button><button class="icon-button" title="${item.pago ? 'Marcar pendente' : 'Marcar pago'}" aria-label="${item.pago ? 'Marcar pendente' : 'Marcar pago'}" data-toggle-expense="${item.id}" data-paid="${item.pago}">${item.pago ? '↩' : '✓'}</button><button class="icon-button delete" title="Excluir gasto" aria-label="Excluir gasto" data-delete-expense="${item.id}">⌫</button></div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhum gasto cadastrado.</td></tr>'}</tbody></table></div></section>`;
  app.querySelector('#expense-form').onsubmit = createExpense; app.querySelector('#reload').onclick = refresh;
  app.querySelectorAll('[data-update-expense]').forEach(button => button.onclick = async () => { const date = app.querySelector(`[data-expense-date="${button.dataset.updateExpense}"]`).value; if (!date) return notify('Informe a data do gasto.', true); try { await api(rest('gastos_casa', `id=eq.${button.dataset.updateExpense}`), jsonOptions('PATCH', { data: date }, { Prefer: 'return=minimal' })); notify('Data atualizada.'); await loadGastos(); } catch (error) { notify(error.message, true); } });
  app.querySelectorAll('[data-toggle-expense]').forEach(button => button.onclick = () => patchExpense(button.dataset.toggleExpense, button.dataset.paid !== 'true'));
  app.querySelectorAll('[data-delete-expense]').forEach(button => button.onclick = () => removeFinancialRecord('gastos_casa', button.dataset.deleteExpense, loadGastos));
}
async function selectProperty(id) {
  state.selectedHouseId = id;
  await loadCasas();
  await appendPortfolioMetrics();
  const placeCalendarFirst = () => {
    const calendar = app.querySelector('.calendar-layout');
    const summary = app.querySelector('.summary');
    const picker = app.querySelector('.property-picker');
    const details = app.querySelector('#selected-property');
    if (calendar && summary) summary.after(calendar);
    if (picker && details) picker.after(details);
  };
  placeCalendarFirst();
  requestAnimationFrame(placeCalendarFirst);
  setTimeout(placeCalendarFirst, 50);
}

function reportRange(mode, value) {
  const selected = value || (mode === 'year' ? String(new Date().getFullYear()) : currentMonth());
  const start = mode === 'year' ? `${selected}-01-01` : `${selected}-01`;
  const reference = new Date(`${start}T12:00:00`);
  if (mode === 'year') reference.setFullYear(reference.getFullYear() + 1); else reference.setMonth(reference.getMonth() + 1);
  return { selected, start, end: reference.toISOString().slice(0, 10) };
}
function reportDate(row) { return row.data_recebimento || row.data_lancamento || row.data_vencimento || ''; }
function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
function exportAccountingExcel(report) {
  if (!window.XLSX) return notify('Não foi possível carregar o gerador de Excel. Atualize a página e tente novamente.', true);
  const workbook = XLSX.utils.book_new();
  const summary = [['RELATÓRIO CONTÁBIL', report.label], [], ['INDICADOR', 'VALOR'], ['RECEBIDO', report.received], ['PAGAMENTOS PENDENTES', report.paymentPending], ['GASTOS PAGOS', report.expensePaid], ['GASTOS PENDENTES', report.expensePending]];
  const payments = [['DATA', 'PATRIMÔNIO', 'TIPO', 'VALOR', 'STATUS'], ...report.payments.map(row => [reportDate(row), row.asset, row.tipo === 'recorrente' ? 'RECORRENTE' : 'AVULSO', Number(row.valor || 0), row.pago ? 'RECEBIDO' : 'PENDENTE'])];
  const expenses = [['DATA', 'PATRIMÔNIO', 'DESCRIÇÃO', 'CATEGORIA', 'VALOR', 'STATUS'], ...report.expenses.map(row => [row.data, row.asset, row.descricao, row.categoria, Number(row.valor || 0), row.pago ? 'PAGO' : 'PENDENTE'])];
  [['Resumo', summary], ['Pagamentos', payments], ['Gastos', expenses]].forEach(([name, rows]) => { const sheet = XLSX.utils.aoa_to_sheet(rows); sheet['!cols'] = rows[0].map((_, index) => ({ wch: Math.min(42, Math.max(14, ...rows.map(row => String(row[index] ?? '').length + 2))) })); XLSX.utils.book_append_sheet(workbook, sheet, name); });
  XLSX.writeFile(workbook, `relatorio-contabil-${report.range.selected}.xlsx`);
}
function exportAccountingPdf(report) {
  const paymentRows = report.payments.map(row => `<tr><td>${esc(dateTime(reportDate(row)))}</td><td>${esc(row.asset)}</td><td>${esc(row.tipo === 'recorrente' ? 'Recorrente' : 'Avulso')}</td><td>${money(row.valor)}</td><td>${row.pago ? 'Recebido' : 'Pendente'}</td></tr>`).join('') || '<tr><td colspan="5">Nenhum pagamento no período.</td></tr>';
  const expenseRows = report.expenses.map(row => `<tr><td>${esc(dateTime(row.data))}</td><td>${esc(row.asset)}</td><td>${esc(row.descricao)}</td><td>${esc(row.categoria)}</td><td>${money(row.valor)}</td><td>${row.pago ? 'Pago' : 'Pendente'}</td></tr>`).join('') || '<tr><td colspan="6">Nenhum gasto no período.</td></tr>';
  const popup = window.open('', '_blank');
  if (!popup) return notify('Permita pop-ups no navegador para exportar o PDF.', true);
  try { popup.opener = null; } catch { /* O navegador pode bloquear esta proteção adicional. */ }
  popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório contábil</title><style>body{font:12px Arial;color:#15231d;margin:32px}h1{margin:0}p{color:#506058}section{margin:24px 0}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.summary div{border:1px solid #d7e0da;padding:12px;border-radius:7px}.summary span{display:block;color:#64736b;font-size:10px;text-transform:uppercase}.summary strong{font-size:17px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #dfe7e2;padding:8px;text-align:left}th{font-size:10px;color:#526158;text-transform:uppercase}@media print{body{margin:16px}}</style></head><body><h1>Relatório contábil</h1><p>Período: ${esc(report.label)}</p><section class="summary"><div><span>Recebido</span><strong>${money(report.received)}</strong></div><div><span>Pagamentos pendentes</span><strong>${money(report.paymentPending)}</strong></div><div><span>Gastos pagos</span><strong>${money(report.expensePaid)}</strong></div><div><span>Gastos pendentes</span><strong>${money(report.expensePending)}</strong></div></section><section><h2>Pagamentos</h2><table><thead><tr><th>Data</th><th>Patrimônio</th><th>Tipo</th><th>Valor</th><th>Status</th></tr></thead><tbody>${paymentRows}</tbody></table></section><section><h2>Gastos</h2><table><thead><tr><th>Data</th><th>Patrimônio</th><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Status</th></tr></thead><tbody>${expenseRows}</tbody></table></section><script>window.onload=()=>window.print()</script></body></html>`);
  popup.document.close();
}
function renderReportBreakdown(rows, label) {
  return rows.length ? rows.map(row => `<div class="report-breakdown-row"><span>${esc(row.name)}</span><strong>${money(row.total)}</strong></div>`).join('') : `<div class="empty">Nenhum ${label} no período.</div>`;
}
async function renderReports() {
  setLoading('Gerando relatório contábil…');
  try {
    const mode = state.reportMode || 'month'; const range = reportRange(mode, state.reportPeriod); state.reportPeriod = range.selected;
    const [assets, payments, expenses, allExpenseCategories] = await Promise.all([
      fetchHouses(),
      api(rest('pagamentos_casa', `select=id,patrimonio_id,tipo,categoria,valor,pago,data_lancamento,data_vencimento,data_recebimento&order=data_lancamento.desc.nullslast`)),
      api(rest('gastos_casa', `select=id,patrimonio_id,descricao,categoria,valor,pago,data,data_pagamento&data=gte.${range.start}&data=lt.${range.end}&order=data.desc`)),
      api(rest('gastos_casa', 'select=categoria')),
    ]);
    const assetMap = new Map(assets.map(asset => [asset.id, assetLabel(asset)]));
    const inRangePayments = payments.filter(row => { const date = reportDate(row); return date >= range.start && date < range.end; }).map(row => ({ ...row, asset: assetMap.get(row.patrimonio_id) || 'Patrimônio removido', categoria: normalizeCategory(row.categoria || 'OUTRAS RECEITAS') }));
    const inRangeExpenses = expenses.map(row => ({ ...row, asset: assetMap.get(row.patrimonio_id) || 'Patrimônio removido', categoria: String(row.categoria || 'SEM CATEGORIA').trim().toUpperCase() }));
    const reportCategories = [...new Set([...payments.map(row => normalizeCategory(row.categoria || 'OUTRAS RECEITAS')), ...allExpenseCategories.map(row => normalizeCategory(row.categoria || 'SEM CATEGORIA'))].filter(Boolean))].sort();
    const selectedCategory = state.reportCategory || '';
    const filteredPayments = selectedCategory ? inRangePayments.filter(row => row.categoria === selectedCategory) : inRangePayments;
    const filteredExpenses = selectedCategory ? inRangeExpenses.filter(row => row.categoria === selectedCategory) : inRangeExpenses;
    const received = filteredPayments.filter(row => row.pago).reduce((sum, row) => sum + Number(row.valor || 0), 0);
    const paymentPending = filteredPayments.filter(row => !row.pago).reduce((sum, row) => sum + Number(row.valor || 0), 0);
    const expensePaid = filteredExpenses.filter(row => row.pago).reduce((sum, row) => sum + Number(row.valor || 0), 0);
    const expensePending = filteredExpenses.filter(row => !row.pago).reduce((sum, row) => sum + Number(row.valor || 0), 0);
    const group = (rows, key) => [...rows.reduce((map, row) => map.set(row[key], (map.get(row[key]) || 0) + Number(row.valor || 0)), new Map()).entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
    const label = new Intl.DateTimeFormat('pt-BR', mode === 'year' ? { year: 'numeric' } : { month: 'long', year: 'numeric' }).format(new Date(`${range.start}T12:00:00`));
    const report = { range, label, payments: filteredPayments, expenses: filteredExpenses, received, paymentPending, expensePaid, expensePending };
    state.accountingReport = report;
    app.innerHTML = heading('Organização fiscal', 'Relatórios contábeis', 'Consulte, filtre e exporte os lançamentos financeiros.') + `<section class="card report-filters"><div class="field"><label for="report-mode">Período</label><select id="report-mode"><option value="month" ${mode === 'month' ? 'selected' : ''}>MÊS</option><option value="year" ${mode === 'year' ? 'selected' : ''}>ANO</option></select></div><div class="field"><label for="report-period">Selecione</label><input id="report-period" type="${mode === 'year' ? 'number' : 'month'}" ${mode === 'year' ? 'min="2000" max="2100" step="1"' : ''} value="${esc(range.selected)}"></div><div class="field"><label for="report-category">Categoria</label><select id="report-category"><option value="">TODAS AS CATEGORIAS</option>${reportCategories.map(category => `<option value="${esc(category)}" ${category === selectedCategory ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select></div><div class="report-export"><button class="button secondary" type="button" data-export-excel>Exportar Excel</button><button class="button" type="button" data-export-pdf>Exportar PDF</button></div></section><section class="summary report-summary"><article class="card metric"><span>Recebido</span><strong>${money(received)}</strong></article><article class="card metric"><span>Pagamentos pendentes</span><strong>${money(paymentPending)}</strong></article><article class="card metric"><span>Gastos pagos</span><strong>${money(expensePaid)}</strong></article><article class="card metric"><span>Gastos pendentes</span><strong>${money(expensePending)}</strong></article></section><section class="report-breakdowns"><article class="card report-breakdown"><h2>Por patrimônio</h2>${renderReportBreakdown(group([...filteredPayments, ...filteredExpenses], 'asset'), 'lançamento')}</article><article class="card report-breakdown"><h2>Receitas por categoria</h2>${renderReportBreakdown(group(filteredPayments, 'categoria'), 'receita')}</article><article class="card report-breakdown"><h2>Gastos por categoria</h2>${renderReportBreakdown(group(filteredExpenses, 'categoria'), 'gasto')}</article></section>`;
    app.querySelector('#report-mode').onchange = event => { state.reportMode = event.target.value; state.reportPeriod = event.target.value === 'year' ? String(new Date().getFullYear()) : currentMonth(); state.reportCategory = ''; renderReports(); };
    app.querySelector('#report-period').onchange = event => { state.reportPeriod = event.target.value; state.reportCategory = ''; renderReports(); };
    app.querySelector('#report-category').onchange = event => { state.reportCategory = event.target.value; renderReports(); };
    app.querySelector('[data-export-excel]').onclick = () => exportAccountingExcel(state.accountingReport);
    app.querySelector('[data-export-pdf]').onclick = () => exportAccountingPdf(state.accountingReport);
  } catch (error) { showError(error); }
}

async function fetchCustomCategories(type) {
  return api(rest('categorias_personalizadas', `select=nome,tipo&order=nome.asc${type ? `&tipo=eq.${type}` : ''}`));
}
function openCategoryForm() {
  const modal = document.createElement('div'); modal.className = 'modal-backdrop';
  modal.innerHTML = `<section class="modal property-modal"><button class="modal-close" type="button" aria-label="Fechar">×</button><h2>Nova categoria</h2><form id="category-form" class="form-grid"><div class="field"><label for="category-type">Tipo *</label><select id="category-type" name="tipo" required><option value="expense">Gasto</option><option value="income">Receita</option></select></div><div class="field"><label for="category-name">Nome *</label><input id="category-name" name="nome" maxlength="80" required placeholder="Ex.: MATERIAL DE ESCRITÓRIO"></div><div class="modal-actions"><button type="button" class="button secondary modal-cancel">Cancelar</button><button type="submit" class="button">Salvar categoria</button></div></form></section>`;
  document.body.append(modal);
  modal.querySelectorAll('.modal-close,.modal-cancel').forEach(button => button.onclick = () => modal.remove());
  modal.querySelector('#category-name').focus();
  modal.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); const nome = normalizeCategory(data.nome);
    if (!nome || nome.length > 80) return notify('Informe um nome de até 80 caracteres.', true);
    const defaults = data.tipo === 'income' ? DEFAULT_INCOME_CATEGORIES : DEFAULT_EXPENSE_CATEGORIES;
    if (defaults.includes(nome)) return notify('Essa categoria básica já está disponível.', true);
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
    try {
      await api(rest('categorias_personalizadas'), jsonOptions('POST', { nome, tipo: data.tipo }, { Prefer: 'return=minimal' }));
      modal.remove(); notify('Categoria cadastrada.'); await renderCategories();
    } catch (error) {
      notify(/duplicate key|unique constraint/i.test(error.message) ? 'Você já cadastrou essa categoria para esse tipo.' : error.message, true);
    } finally { button.disabled = false; }
  };
}
function normalizeCategory(value) { return String(value || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR'); }
async function loadGastos() {
  await fetchHouses(); const gastos = await api(rest('gastos_casa', 'select=id,patrimonio_id,descricao,categoria,valor,pago,recorrente,data,data_pagamento&order=data.desc')); const assets = new Map(state.houses.map(asset => [asset.id, asset])); const categories = [...new Set([...DEFAULT_EXPENSE_CATEGORIES, ...(await fetchCustomCategories('expense')).map(row => row.nome), ...gastos.map(item => normalizeCategory(item.categoria)).filter(Boolean)])].sort();
  app.innerHTML = heading('Despesas', 'Gastos', 'Registre gastos atuais ou retroativos associados aos seus patrimônios.') + `<section class="card form-card"><h2 class="card-title">Novo gasto</h2><form id="expense-form" class="form-grid"><div class="field"><label>Patrimônio *</label><select name="patrimonio_id" required><option value="">Selecione</option>${assetOptions()}</select></div><div class="field"><label>Descrição *</label><input name="descricao" required></div><div class="field"><label>Categoria *</label><select name="categoria" id="expense-category" required><option value="">Selecione</option>${categories.map(category => `<option value="${esc(category)}">${esc(category)}</option>`).join('')}</select></div><div class="field"><label>Valor *</label><input name="valor" type="number" min="0.01" step="0.01" required></div><div class="field"><label>Data do gasto *</label><input name="data" type="date" required value="${new Date().toISOString().slice(0,10)}"></div><div class="form-actions"><button class="button">Salvar gasto</button></div></form></section><section class="card table-card"><div class="table-head"><h2>Gastos</h2><button id="reload" class="button secondary small">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>Patrimônio</th><th>Descrição</th><th>Valor</th><th>Data do gasto</th><th>Status</th><th>Pago em</th><th></th></tr></thead><tbody>${gastos.map(item => `<tr><td>${esc(assets.has(item.patrimonio_id) ? assetLabel(assets.get(item.patrimonio_id)) : 'Patrimônio removido')}</td><td>${esc(item.descricao)}<br><small>${esc(normalizeCategory(item.categoria))}</small></td><td>${money(item.valor)}</td><td><input class="table-date" type="date" data-expense-date="${item.id}" value="${esc(item.data)}"></td><td><span class="pill ${item.pago ? 'ok' : 'pending'}">${item.pago ? 'Pago' : 'Pendente'}</span></td><td>${item.data_pagamento ? dateTime(item.data_pagamento) : '—'}</td><td><div class="action-row"><button class="icon-button" title="Atualizar data" aria-label="Atualizar data" data-update-expense="${item.id}">↻</button><button class="icon-button" title="${item.pago ? 'Marcar pendente' : 'Marcar pago'}" aria-label="${item.pago ? 'Marcar pendente' : 'Marcar pago'}" data-toggle-expense="${item.id}" data-paid="${item.pago}">${item.pago ? '↩' : '✓'}</button><button class="icon-button delete" title="Excluir gasto" aria-label="Excluir gasto" data-delete-expense="${item.id}">⌫</button></div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhum gasto cadastrado.</td></tr>'}</tbody></table></div></section>`;
  app.querySelector('#expense-form').onsubmit = createExpense; app.querySelector('#reload').onclick = refresh;
  app.querySelectorAll('[data-update-expense]').forEach(button => button.onclick = async () => { const date = app.querySelector(`[data-expense-date="${button.dataset.updateExpense}"]`).value; if (!date) return notify('Informe a data do gasto.', true); try { await api(rest('gastos_casa', `id=eq.${button.dataset.updateExpense}`), jsonOptions('PATCH', { data: date }, { Prefer: 'return=minimal' })); notify('Data atualizada.'); await loadGastos(); } catch (error) { notify(error.message, true); } });
  app.querySelectorAll('[data-toggle-expense]').forEach(button => button.onclick = () => patchExpense(button.dataset.toggleExpense, button.dataset.paid !== 'true'));
  app.querySelectorAll('[data-delete-expense]').forEach(button => button.onclick = () => removeFinancialRecord('gastos_casa', button.dataset.deleteExpense, loadGastos));
}
async function createExpense(event) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); const category = normalizeCategory(data.categoria); if (!category) return notify('Informe uma categoria.', true);
  try { await api(rest('gastos_casa'), jsonOptions('POST', { patrimonio_id: Number(data.patrimonio_id), descricao: data.descricao.trim(), categoria: normalizeCategory(data.categoria), valor: Number(data.valor), pago: false, recorrente: false, data: data.data, data_vencimento: data.data_vencimento || null }, { Prefer: 'return=minimal' })); notify('Gasto cadastrado.'); await refresh(); } catch (error) { notify(error.message, true); }
}

const DEFAULT_EXPENSE_CATEGORIES = ['IMPOSTOS', 'SEGUROS', 'ÁGUA', 'ENERGIA', 'OUTROS GASTOS'];
const DEFAULT_INCOME_CATEGORIES = ['ALUGUEL', 'VENDA', 'SERVIÇOS', 'REEMBOLSO', 'OUTRAS RECEITAS'];
async function openManualPaymentForm() {
  const assets = state.houses.length ? state.houses : await fetchHouses();
  const rows = await api(rest('pagamentos_casa', 'select=categoria&order=categoria.asc'));
  const categories = [...new Set([...DEFAULT_INCOME_CATEGORIES, ...(await fetchCustomCategories('income')).map(row => row.nome), ...rows.map(row => normalizeCategory(row.categoria)).filter(Boolean)])].sort();
  const modal = document.createElement('div'); modal.className = 'modal-backdrop'; modal.id = 'manual-payment-modal';
  modal.innerHTML = `<section class="modal property-modal payment-modal"><button class="modal-close" type="button">×</button><p class="eyebrow">Nova receita</p><h2>Adicionar pagamento</h2><form id="manual-payment-form" class="form-grid"><div class="field"><label>Patrimônio *</label><select name="patrimonio_id" required><option value="">Selecione</option>${assets.map(asset => `<option value="${asset.id}">${esc(assetLabel(asset))}</option>`).join('')}</select></div><div class="field"><label>Categoria *</label><select name="categoria" id="income-category" required>${categories.map(category => `<option value="${esc(category)}" ${category === 'OUTRAS RECEITAS' ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select></div><div class="field"><label>Tipo *</label><select name="tipo"><option value="recorrente">Recorrente</option><option value="avulso">Avulso</option></select></div><div class="field"><label>Valor *</label><input name="valor" type="number" min="0.01" step="0.01" required></div><div class="field"><label>Data do lançamento *</label><input name="data_lancamento" type="date" required value="${new Date().toISOString().slice(0,10)}"></div><div class="field"><label>Data de vencimento</label><input name="data_vencimento" type="date"></div><div class="modal-actions"><button type="button" class="button secondary modal-cancel">Cancelar</button><button class="button">Salvar</button></div></form></section>`;
  document.body.append(modal); modal.querySelector('#manual-payment-form').onsubmit = createManualPayment; modal.querySelectorAll('.modal-close,.modal-cancel').forEach(button => button.onclick = () => modal.remove());
}
async function createManualPayment(event) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); const category = normalizeCategory(data.categoria); if (!category) return notify('Informe uma categoria.', true); if (data.tipo === 'recorrente' && !data.data_vencimento) return notify('Informe a data de vencimento do pagamento recorrente.', true);
  try { await api(rest('pagamentos_casa'), jsonOptions('POST', { patrimonio_id: Number(data.patrimonio_id), categoria: normalizeCategory(data.categoria), tipo: data.tipo, valor: Number(data.valor), data_lancamento: data.data_lancamento, data_vencimento: data.data_vencimento || null, pago: false }, { Prefer: 'return=minimal' })); document.querySelector('#manual-payment-modal')?.remove(); notify('Pagamento cadastrado.'); await loadPagamentos(); } catch (error) { notify(error.message, true); }
}
async function loadPagamentos() {
  await fetchHouses(); const payments = await api(rest('pagamentos_casa', 'select=id,patrimonio_id,tipo,categoria,valor,data_lancamento,data_vencimento,pago,data_recebimento&order=data_lancamento.desc.nullslast')); const assets = new Map(state.houses.map(asset => [asset.id, asset]));
  const received = payments.filter(item => item.pago).reduce((sum, item) => sum + Number(item.valor), 0); const pending = payments.filter(item => !item.pago).reduce((sum, item) => sum + Number(item.valor), 0);
  app.innerHTML = heading('Receitas', 'Pagamentos', 'Cadastre receitas atuais ou retroativas.', '<button id="add-manual-payment" class="button">Adicionar receita</button>') + `<section class="summary"><div class="card metric"><span>Pagamentos cadastrados</span><strong>${payments.length}</strong></div><div class="card metric"><span>Recebido</span><strong>${money(received)}</strong></div><div class="card metric"><span>Pendente</span><strong>${money(pending)}</strong></div></section><section class="card table-card"><div class="table-head"><h2>Todos os pagamentos</h2><button id="reload" class="button secondary small">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>Patrimônio</th><th>Categoria</th><th>Tipo</th><th>Valor</th><th>Lançamento</th><th>Vencimento</th><th>Status</th><th>Recebido em</th><th></th></tr></thead><tbody>${payments.length ? payments.map(item => `<tr><td>${esc(assets.has(item.patrimonio_id) ? assetLabel(assets.get(item.patrimonio_id)) : 'Patrimônio removido')}</td><td>${esc(normalizeCategory(item.categoria || 'OUTRAS RECEITAS'))}</td><td>${item.tipo === 'recorrente' ? 'Recorrente' : 'Avulso'}</td><td>${money(item.valor)}</td><td>${item.data_lancamento ? dateTime(item.data_lancamento) : '—'}</td><td>${item.data_vencimento ? dateTime(item.data_vencimento) : '—'}</td><td><span class="pill ${item.pago ? 'ok' : 'pending'}">${item.pago ? 'Recebido' : 'Pendente'}</span></td><td><input class="table-date" type="date" data-received-date="${item.id}" value="${esc(item.data_recebimento || new Date().toISOString().slice(0,10))}"></td><td><div class="action-row"><button class="icon-button" title="Atualizar data" aria-label="Atualizar data" data-update-payment="${item.id}">↻</button><button class="icon-button" title="${item.pago ? 'Marcar pendente' : 'Marcar recebido'}" aria-label="${item.pago ? 'Marcar pendente' : 'Marcar recebido'}" data-toggle-payment="${item.id}" data-paid="${item.pago}">${item.pago ? '↩' : '✓'}</button><button class="icon-button delete" title="Excluir pagamento" aria-label="Excluir pagamento" data-delete-payment="${item.id}">⌫</button></div></td></tr>`).join('') : '<tr><td colspan="9" class="empty">Nenhum pagamento cadastrado.</td></tr>'}</tbody></table></div></section>`;
  app.querySelector('#reload').onclick = refresh; app.querySelector('#add-manual-payment').onclick = openManualPaymentForm;
  app.querySelectorAll('[data-update-payment]').forEach(button => button.onclick = async () => { const date = app.querySelector(`[data-received-date="${button.dataset.updatePayment}"]`).value; if (!date) return notify('Informe a data de recebimento.', true); try { await api(rest('pagamentos_casa', `id=eq.${button.dataset.updatePayment}`), jsonOptions('PATCH', { pago: true, data_recebimento: date }, { Prefer: 'return=minimal' })); notify('Pagamento atualizado.'); await loadPagamentos(); } catch (error) { notify(error.message, true); } });
  app.querySelectorAll('[data-toggle-payment]').forEach(button => button.onclick = async () => { const paid = button.dataset.paid !== 'true'; const date = paid ? app.querySelector(`[data-received-date="${button.dataset.togglePayment}"]`).value : null; if (paid && !date) return notify('Informe a data de recebimento.', true); try { await api(rest('pagamentos_casa', `id=eq.${button.dataset.togglePayment}`), jsonOptions('PATCH', { pago: paid, data_recebimento: date }, { Prefer: 'return=minimal' })); notify('Status atualizado.'); await loadPagamentos(); } catch (error) { notify(error.message, true); } });
  app.querySelectorAll('[data-delete-payment]').forEach(button => button.onclick = () => removeFinancialRecord('pagamentos_casa', button.dataset.deletePayment, loadPagamentos));
}
