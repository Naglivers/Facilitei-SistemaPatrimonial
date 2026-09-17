/* Shared responsive behavior for dynamically rendered screens. */
(() => {
  const sidebar = document.querySelector('.sidebar');
  const toggle = document.querySelector('.menu-toggle');
  const content = document.querySelector('.content');
  const mobile = window.matchMedia('(max-width: 800px)');
  sidebar.id = 'main-navigation';
  toggle.setAttribute('aria-controls', sidebar.id);
  const backdrop = document.createElement('button');
  backdrop.className = 'navigation-backdrop';
  backdrop.type = 'button';
  backdrop.tabIndex = -1;
  backdrop.setAttribute('aria-label', 'Fechar menu');
  backdrop.hidden = true;
  sidebar.before(backdrop);
  const close = document.createElement('button');
  close.className = 'navigation-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Fechar menu');
  close.textContent = '×';
  sidebar.prepend(close);

  let wasOpen = false;
  function syncNavigation() {
    const open = mobile.matches && sidebar.classList.contains('open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    sidebar.inert = mobile.matches && !open;
    content.inert = open;
    backdrop.hidden = !open;
    document.body.classList.toggle('navigation-open', open);
    if (open && !wasOpen) close.focus();
    if (!open && wasOpen && mobile.matches) toggle.focus();
    wasOpen = open;
  }
  function closeNavigation() { sidebar.classList.remove('open'); syncNavigation(); }
  close.addEventListener('click', closeNavigation);
  backdrop.addEventListener('click', closeNavigation);
  document.querySelector('#sign-out-sidebar').addEventListener('click', closeNavigation);
  sidebar.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'instant' })));
  new MutationObserver(syncNavigation).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  mobile.addEventListener('change', () => { closeNavigation(); });
  document.addEventListener('keydown', event => {
    if (!wasOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); closeNavigation(); }
    if (event.key === 'Tab') {
      const items = [...sidebar.querySelectorAll('button, a[href]')].filter(item => !item.disabled && item.getClientRects().length);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  syncNavigation();

  function prepareTables() {
    document.querySelectorAll('#app table').forEach(table => {
      const headers = [...table.querySelectorAll('thead th')];
      if (!headers.length) return;
      table.classList.add('responsive-table');
      table.querySelectorAll('tbody tr').forEach(row => {
        [...row.cells].forEach((cell, index) => {
          if (cell.colSpan > 1) { cell.classList.add('table-empty-cell'); return; }
          cell.dataset.label = headers[index]?.textContent.trim() || 'Ações';
        });
      });
    });
  }
  // Observe content only: labels do not trigger another render or replace controls.
  new MutationObserver(prepareTables).observe(document.querySelector('#app'), { childList: true, subtree: true });
  prepareTables();
})();
