const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

test('telas responsivas, navegação acessível e controles das listagens', async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const relative = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    if (!/^(index\.html|[\w.-]+\.(js|css)|assets\/[\w.-]+\.png)$/.test(relative)) return res.writeHead(404).end();
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)]);
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'mobile@example.test', user_metadata: { nome: 'Maria Silva' } };
    const session = { access_token: 'mock', refresh_token: 'mock', user };
    const today = new Date().toISOString().slice(0, 10);
    const asset = { id: 1, nome: 'Casa Jardim das Palmeiras', tipo_patrimonio: 'casa', rua: 'Rua das Palmeiras', numero: 123, valor_patrimonio: 1234567.89 };
    const payment = { id: 1, patrimonio_id: 1, categoria: 'ALUGUEL', tipo: 'recorrente', valor: 2500, pago: false, data_lancamento: today, data_vencimento: today, data_recebimento: today };
    const expense = { id: 1, patrimonio_id: 1, descricao: 'Manutenção e reparos na propriedade', categoria: 'MANUTENÇÃO', valor: 150, pago: false, data: today };
    const patches = [];
    await page.addInitScript(value => localStorage.setItem('sistema-patrimonial-session', JSON.stringify(value)), session);
    await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.route('**/*.supabase.co/**', async route => {
      const request = route.request(), url = new URL(request.url());
      let body = [];
      if (url.pathname === '/auth/v1/token') body = session;
      else if (url.pathname === '/auth/v1/user') body = user;
      else if (url.pathname === '/rest/v1/rpc/my_plan') body = { plan: 'pro', assets: 1, documents: 1, asset_limit: null, document_limit: null, documents_by_asset: { 1: 1 } };
      else if (url.pathname === '/rest/v1/patrimonio') body = [asset];
      else if (url.pathname === '/rest/v1/pagamentos_casa') {
        if (request.method() === 'PATCH') { patches.push(request.postDataJSON()); Object.assign(payment, request.postDataJSON()); }
        body = [payment];
      }
      else if (url.pathname === '/rest/v1/gastos_casa') body = [expense];
      else if (url.pathname === '/rest/v1/documentos_casa') body = [{ id: 1, patrimonio_id: 1, nome_arquivo: 'contrato.pdf', descricao: 'Contrato do imóvel', data_upload: today }];
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('.calendar-day.today').waitFor();
    async function navigate(target) {
      if (await page.locator('.menu-toggle').isVisible()) await page.locator('.menu-toggle').click();
      await page.locator(`.sidebar [data-page="${target}"]`).click();
      await page.locator('#app h1').waitFor();
      await page.waitForFunction(() => !document.querySelector('#app').textContent.includes('Carregando'));
      if (await page.locator('.menu-toggle').isVisible()) await page.waitForFunction(() => getComputedStyle(document.querySelector('.sidebar')).visibility === 'hidden');
    }
    async function fits(label) {
      const overflow = await page.evaluate(() => [...document.querySelectorAll('#app *, .topbar')].filter(el => {
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        if (innerWidth <= 800 && el.closest('thead')) return false;
        if (innerWidth > 800 && el.closest('.table-wrap')) return false;
        return r.width > 0 && s.position !== 'absolute' && s.visibility !== 'hidden' && (r.right > innerWidth + 1 || r.left < -1);
      }).map(el => `${el.tagName}.${el.className}`));
      assert.deepEqual(overflow, [], label);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, label);
    }
    await page.locator('.menu-toggle').click();
    assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.menu-toggle').evaluate(el => el === document.activeElement), true);
    await page.locator('.menu-toggle').click();
    await page.locator('.navigation-backdrop').click({ position: { x: 380, y: 100 } });
    assert.equal(await page.locator('.sidebar').evaluate(el => el.inert), true);
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      for (const screen of ['casas', 'pagamentos', 'gastos', 'categorias', 'documentos', 'assinaturas', 'contabilidade', 'relatorios', 'perfil', 'configuracoes', 'suporte']) {
        await navigate(screen);
        await fits(`${screen} at ${width}px`);
        if (width === 390 && ['casas', 'pagamentos', 'gastos'].includes(screen)) await page.screenshot({ path: path.join(root, `test-results/mobile-${screen}.png`), fullPage: true });
        if (screen === 'casas') {
          await page.locator('[data-property="1"]').click();
          await page.locator('#property-edit-form').waitFor();
          await fits(`selected property at ${width}px`);
          await page.locator('#add-property').click();
          await page.locator('#add-property-form').waitFor();
          const bounds = await page.locator('.modal').boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
          assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844);
          await page.locator('.modal-cancel').click();
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 667 });
    await navigate('pagamentos');
    await page.locator('[data-received-date]').fill('2026-09-16');
    await page.locator('[data-update-payment]').click();
    await page.waitForFunction(() => document.querySelector('[data-received-date]')?.value === '2026-09-16');
    assert.ok(patches.some(patch => patch.data_recebimento === '2026-09-16'));
    await page.locator('#add-manual-payment').click();
    await page.locator('.modal').waitFor();
    const modalBounds = await page.locator('.modal').boundingBox();
    assert.ok(modalBounds.y >= 0 && modalBounds.y + modalBounds.height <= 667);
    await page.locator('.modal button[type=submit], .modal .modal-actions .button:not(.secondary)').last().scrollIntoViewIfNeeded();
    await page.locator('.modal-cancel').click();
    await navigate('configuracoes');
    await page.getByRole('switch', { name: 'Modo escuro' }).click();
    await navigate('pagamentos');
    await fits('dark mobile');
    await page.screenshot({ path: path.join(root, 'test-results/mobile-dark.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
