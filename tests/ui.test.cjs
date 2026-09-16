const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

test('planos, tema, mobile, checkout e limites na interface com serviços simulados', async () => {
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
    const requests = [];
    const assets = [{ id:1,nome:'Casa Jardim',tipo_patrimonio:'casa',rua:'Rua Jardim',numero:10,valor_patrimonio:100000 }];
    const user = { id:'00000000-0000-4000-8000-000000000001',email:'test@example.test',user_metadata:{ nome:'Lucas Silva',telefone:'11999990000' } };
    const session = { access_token:'mock-access',refresh_token:'mock-refresh',user };
    await page.addInitScript(value => localStorage.setItem('sistema-patrimonial-session',JSON.stringify(value)), session);
    await page.route('**/*.supabase.co/**', async route => {
      const request = route.request(); const url = new URL(request.url());
      requests.push({ path:url.pathname,method:request.method(),body:request.postData(),headers:request.headers() });
      let body = [];
      if (url.pathname === '/auth/v1/token') body = session;
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
    await page.getByRole('button',{name:'Abrir meu perfil'}).click();
    await page.getByRole('heading',{name:'Meu perfil'}).waitFor();
    assert.equal(await page.locator('#profile-name').inputValue(),'Lucas Silva');
    assert.equal(await page.locator('#profile-phone').inputValue(),'11999990000');
    assert.equal(await page.locator('#profile-email').inputValue(),'test@example.test');
    assert.equal(await page.locator('#profile-password').inputValue(),'');
    await page.locator('#profile-name').fill('Lucas Pereira');
    await page.locator('#profile-phone').fill('(11) 98888-7777');
    await page.locator('#profile-email').fill('lucas@example.test');
    await page.locator('#profile-password').fill('senha-forte-123');
    await page.locator('#profile-confirmation').fill('senha-forte-123');
    await page.getByRole('button',{name:'Salvar alterações'}).click();
    await page.getByText(/Confirme a alteração de e-mail/).waitFor();
    const profileUpdate = requests.find(item => item.path === '/auth/v1/user' && item.method === 'PUT');
    assert.deepEqual(JSON.parse(profileUpdate.body), { email:'lucas@example.test',password:'senha-forte-123',data:{nome:'Lucas Pereira',telefone:'(11) 98888-7777'} });
    assert.equal(profileUpdate.headers?.authorization, 'Bearer mock-access');
    assert.equal(await page.locator('#profile-nav-name').innerText(),'Lucas Pereira');
    await page.getByRole('button', {name:'Configurações',exact:false}).click();
    await page.getByRole('button', {name:'Assinar Básico',exact:true}).waitFor();
    assert.equal(await page.locator('.plan-card').count(),3);
    assert.match(await page.locator('.plans-grid').innerText(),/19,99/);
    assert.match(await page.locator('.plans-grid').innerText(),/29,99/);
    const configRect = await page.locator('.settings-nav').boundingBox();
    const logoutRect = await page.locator('#sign-out-sidebar').boundingBox();
    assert.equal(Math.round(logoutRect.y - configRect.y - configRect.height),10);
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
    await page.screenshot({path:path.join(root,'test-results/plans-light.png'),fullPage:true});
    await page.getByRole('switch',{name:'Modo escuro'}).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    await page.screenshot({path:path.join(root,'test-results/plans-dark.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),true);
    await page.screenshot({path:path.join(root,'test-results/plans-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1100});
    await page.getByRole('button',{name:'Casas',exact:false}).click();
    await page.getByRole('button',{name:'Adicionar patrimônio',exact:true}).click();
    await page.locator('#add-property-form [name=nome]').fill('Segundo imóvel');
    await page.locator('#add-property-form').getByRole('button',{name:'Cadastrar',exact:true}).click();
    await page.getByText(/Limite de patrimônios atingido/).waitFor();
    assert.equal(requests.filter(item=>item.path==='/rest/v1/patrimonio'&&item.method==='POST').length,0);
    await page.locator('#add-property-modal .modal-cancel').click();
    info = {...info,plan:'basico',asset_limit:3,documents:4,documents_by_asset:{1:4}};
    await page.getByRole('button',{name:'Documentos',exact:false}).click();
    await page.locator('#document-form [name=patrimonio_id]').selectOption('1');
    await page.locator('#document-form [name=file]').setInputFiles({name:'teste.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 test')});
    const from = requests.length;
    await page.getByRole('button',{name:'Enviar arquivo',exact:true}).click();
    await page.getByText('Falha simulada de upload',{exact:true}).waitFor();
    const upload = requests.slice(from);
    assert.equal(upload[0].path,'/rest/v1/rpc/my_plan');
    assert.equal(upload[1].path,'/rest/v1/documentos_casa');
    assert.equal(upload[1].method,'POST');
    assert.equal(upload[2].method,'POST');
    assert.equal(upload[3].path,'/storage/v1/object/documentos');
    assert.equal(upload[3].method,'DELETE');
    assert.equal(upload[4].path,'/rest/v1/documentos_casa');
    assert.equal(upload[4].method,'DELETE');
    assert.equal(await page.getByRole('button',{name:'Enviar arquivo',exact:true}).isEnabled(),true);
    await page.getByRole('button',{name:'Configurações',exact:false}).click();
    await page.getByRole('button',{name:'Assinar Pro',exact:true}).click();
    await page.getByRole('heading',{name:'Checkout simulado'}).waitFor();
    const checkout = requests.find(item=>item.path==='/functions/v1/billing' && JSON.parse(item.body).action==='checkout');
    assert.deepEqual(JSON.parse(checkout.body),{action:'checkout',plan:'pro'});
    info = {...info,plan:'pro',asset_limit:null,document_limit:null,subscription:{plan:'pro',status:'authorized'},valid_until:'2026-10-16T12:00:00Z'};
    await page.goto(url+'/?billing=return#configuracoes');
    await page.getByRole('button',{name:'Cancelar assinatura'}).waitFor();
    assert.equal(await page.locator('.current-plan h3').innerText(),'Pro');
    assert.equal(new URL(page.url()).searchParams.has('billing'),false);
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    assert.deepEqual(errors,[]);
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
});
