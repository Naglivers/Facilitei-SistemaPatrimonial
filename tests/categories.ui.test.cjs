const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

test('cadastro de categorias personalizadas e seleção em receitas e gastos', async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = name === '/' ? 'index.html' : name.slice(1);
    if (!/^(index\.html|[\w.-]+\.(js|css)|assets\/[\w.-]+\.png)$/.test(relative)) { res.writeHead(404).end(); return; }
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png' })[path.extname(file)]);
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let info = { plan:'free',valid_until:null,assets:1,documents:5,asset_limit:1,document_limit:5,documents_by_asset:{1:5},subscription:null };
    const requests = []; const categories = [];
    const assets = [{ id:1,nome:'Casa Jardim',tipo_patrimonio:'casa',rua:'Rua Jardim',numero:10,valor_patrimonio:100000 }];
    const user = { id:'00000000-0000-4000-8000-000000000001',email:'test@example.test',user_metadata:{ nome:'Lucas Silva',telefone:'11999990000' } };
    const session = { access_token:'mock-access',refresh_token:'mock-refresh',user };
    await page.addInitScript(value => localStorage.setItem('sistema-patrimonial-session',JSON.stringify(value)), session);
    await page.route('**/*.supabase.co/**', async route => {
      const request = route.request(); const url = new URL(request.url());
      requests.push({ path:url.pathname,method:request.method(),body:request.postData(),headers:request.headers() });
      let body = [];
      if (url.pathname === '/rest/v1/categorias_personalizadas') {
        if (request.method() === 'POST') categories.push(request.postDataJSON());
        body = categories.filter(row => !url.searchParams.get('tipo') || url.searchParams.get('tipo') === 'eq.' + row.tipo);
      }
      else if (url.pathname === '/auth/v1/token') body = session;
      else if (url.pathname === '/auth/v1/user') {
        if (request.method() === 'PUT') {
          const update = request.postDataJSON();
          Object.assign(user, update.email ? { email:update.email } : {}, { user_metadata:update.data });
        }
        body = user;
      }
      else if (url.pathname === '/rest/v1/rpc/my_plan') body = info;
      else if (url.pathname === '/rest/v1/patrimonio') body = assets;
      else if (url.pathname === '/rest/v1/documentos_casa' && request.method() === 'POST') body = [{id:99,...request.postDataJSON()}];
      else if (url.pathname.startsWith('/storage/v1/object/documentos/') && request.method() === 'POST') {
        await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Falha simulada de upload'})}); return;
      }
      else if (url.pathname === '/functions/v1/billing') {
        const action = request.postDataJSON();
        body = action.action === 'checkout' ? {checkout_url:'https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=test'} : {ok:true};
      }
      await route.fulfill({ contentType:'application/json',body:JSON.stringify(body) });
    });
    await page.route('https://www.mercadopago.com.br/**', route => route.fulfill({contentType:'text/html',body:'<h1>Checkout simulado</h1>'}));
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);

    await page.locator('[data-page="categorias"]').click();
    await page.locator('#add-category').click();
    await page.locator('#category-name').fill('  material   escolar  ');
    await page.getByRole('button', {name:'Salvar categoria', exact:true}).click();
    await page.locator('#category-form').waitFor({state:'detached'});
    assert.deepEqual(categories, [{nome:'MATERIAL ESCOLAR',tipo:'expense'}]);
    await page.locator('#add-category').click();
    await page.locator('#category-type').selectOption('income');
    await page.locator('#category-name').fill('Consultoria');
    await page.getByRole('button', {name:'Salvar categoria', exact:true}).click();
    await page.locator('#category-form').waitFor({state:'detached'});
    await page.locator('[data-page="gastos"]').click();
    await page.locator('#add-expense').click();
    await page.locator('select#expense-category').selectOption('MATERIAL ESCOLAR');
    assert.equal(await page.locator('#expense-category option[value="CONSULTORIA"]').count(),0);
    assert.equal(await page.locator('#expense-category option[value="IMPOSTOS"]').count(),1);
    await page.locator('.modal-close').click();
    await page.locator('[data-page="pagamentos"]').click();
    await page.locator('#add-manual-payment').click();
    await page.locator('select#income-category').selectOption('CONSULTORIA');
    assert.equal(await page.locator('#income-category option[value="MATERIAL ESCOLAR"]').count(),0);
    assert.equal(await page.locator('#income-category option[value="ALUGUEL"]').count(),1);
    assert.deepEqual(errors,[]);
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
