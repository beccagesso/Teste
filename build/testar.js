/* Testa o index.html gerado: erros, dependências externas, cálculos,
   salvamento automático e o layout de impressão. */
const { chromium, devices } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const RAIZ = '/home/user/Teste';
const SAIDA = '/tmp/claude-0/-home-user-Teste/d374970d-82df-5a1b-97ec-d3fd704ae9dc/scratchpad/tiros';
fs.mkdirSync(SAIDA, { recursive: true });

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/manifest+json',
  '.png': 'image/png',
};

function servidor() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const arq = path.join(RAIZ, p);
      if (!arq.startsWith(RAIZ) || !fs.existsSync(arq)) {
        res.writeHead(404); return res.end('nao encontrado');
      }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream' });
      res.end(fs.readFileSync(arq));
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

const falhas = [];
function checar(cond, msg) {
  console.log(`  ${cond ? 'ok  ' : 'FALHA'}  ${msg}`);
  if (!cond) falhas.push(msg);
}

(async () => {
  const srv = await servidor();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();

  // ---------- 1. carga limpa e sem dependências externas ----------
  console.log('\n[1] Carga da página');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const erros = [], externos = [];
  page.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', e => erros.push(String(e)));
  page.on('request', r => {
    const u = r.url();
    if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) externos.push(u);
  });

  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  checar(erros.length === 0, `sem erros de JavaScript ${erros.length ? '-> ' + erros.join(' | ') : ''}`);
  checar(externos.length === 0, `sem requisições externas ${externos.length ? '-> ' + externos.join(' | ') : ''}`);

  // fontes embutidas realmente carregaram?
  const fontesOk = await page.evaluate(async () => {
    await document.fonts.ready;
    const nomes = new Set();
    document.fonts.forEach(f => { if (f.status === 'loaded') nomes.add(f.family.replace(/['"]/g, '')); });
    return [...nomes];
  });
  checar(fontesOk.includes('Inter') && fontesOk.includes('Space Grotesk') && fontesOk.includes('IBM Plex Mono'),
    `fontes embutidas carregaram -> ${fontesOk.join(', ')}`);

  // ---------- 2. preenchimento e cálculo ----------
  console.log('\n[2] Preenchimento e cálculo');
  await page.fill('#cliNome', 'Construtora Alvorada Ltda');
  await page.fill('#cliEndereco', 'Rua das Palmeiras, 480 — Centro, Bauru/SP');
  await page.fill('#orcData', '2026-08-08');

  // vírgula decimal: era exatamente o que quebrava no iPhone
  await page.fill('.s-desc', 'Forro de gesso liso com moldura');
  await page.fill('.s-qtd', '38,5');
  await page.fill('.s-valor', '92,50');

  await page.click('#addServico');
  const linhas = page.locator('.service-row');
  await linhas.nth(1).locator('.s-desc').fill('Parede drywall acústica');
  await linhas.nth(1).locator('.s-qtd').fill('12');
  await linhas.nth(1).locator('.s-valor').fill('1.480,00');

  const total = 38.5 * 92.5 + 12 * 1480;   // 3561,25 + 17760 = 21321,25
  const lidoTotal = await page.textContent('#totTotal');
  const lidoParcela = await page.textContent('#payParcela');
  const lidoAvista = await page.textContent('#payAvista');
  const moeda = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  checar(lidoTotal.replace(/\s/g, ' ') === moeda(total).replace(/\s/g, ' '),
    `total com vírgula decimal: ${lidoTotal} (esperado ${moeda(total)})`);
  checar(lidoParcela.replace(/\s/g, ' ') === moeda(total / 5).replace(/\s/g, ' '),
    `parcela 5x: ${lidoParcela}`);
  checar(lidoAvista.replace(/\s/g, ' ') === moeda(total * 0.94).replace(/\s/g, ' '),
    `à vista -6%: ${lidoAvista}`);

  checar((await page.textContent('#docValidade')) === '23/08/2026',
    `validade 15 dias: ${await page.textContent('#docValidade')}`);
  checar(/^\d{4}\/2026$/.test(await page.inputValue('#orcNumero')),
    `número sequencial: ${await page.inputValue('#orcNumero')}`);
  checar((await page.textContent('#assinaCliente')) === 'Construtora Alvorada Ltda',
    'nome do cliente aparece na assinatura');
  checar((await page.textContent('#assinaDataEmpresa')).includes('08/08/2026'),
    `data da assinatura da empresa: ${await page.textContent('#assinaDataEmpresa')}`);

  // a assinatura fixa precisa estar visível e desenhada com a letra manuscrita
  const rubrica = await page.evaluate(async () => {
    await document.fonts.ready;
    const e = document.querySelector('.rubrica-becca');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return {
      texto: e.textContent.trim(),
      largura: +r.width.toFixed(1),
      familia: cs.fontFamily,
      manuscritaCarregou: document.fonts.check(`${cs.fontSize} Assinatura`),
    };
  });
  checar(rubrica && rubrica.texto === 'Becca Gesso', 'assinatura fixa presente no documento');
  checar(rubrica && rubrica.familia.includes('Assinatura'),
    `assinatura usa a letra manuscrita (${rubrica ? rubrica.familia : '—'})`);
  checar(rubrica && rubrica.manuscritaCarregou, 'fonte manuscrita carregou');
  checar(rubrica && rubrica.largura > 80,
    `assinatura tem largura visível (${rubrica ? rubrica.largura : 0}px)`);

  // o cliente assina à mão: o lado dele fica em branco, mas alinhado
  const alinhado = await page.evaluate(() => {
    const r = [...document.querySelectorAll('.assinaturas .rubrica')];
    if (r.length !== 2) return null;
    const [a, b] = r.map(e => +e.getBoundingClientRect().bottom.toFixed(1));
    return { a, b, iguais: Math.abs(a - b) < 1 };
  });
  checar(alinhado && alinhado.iguais,
    'as duas linhas de assinatura ficam alinhadas');
  checar((await page.locator('#cliDoc').count()) === 0,
    'campo de CPF/CNPJ do cliente foi removido');

  await page.screenshot({ path: `${SAIDA}/01-desktop.png`, fullPage: true });

  // ---------- 3. salvamento automático ----------
  console.log('\n[3] Salvamento automático');
  await page.waitForTimeout(700);
  const numeroAntes = await page.inputValue('#orcNumero');
  await page.reload({ waitUntil: 'networkidle' });
  checar((await page.inputValue('#cliNome')) === 'Construtora Alvorada Ltda',
    'cliente sobrevive ao recarregar');
  checar((await page.inputValue('#orcNumero')) === numeroAntes,
    `número não muda ao recarregar (${numeroAntes})`);
  checar((await page.locator('.service-row').count()) === 2,
    'os 2 serviços foram restaurados');
  checar((await page.textContent('#totTotal')).replace(/\s/g, ' ') === moeda(total).replace(/\s/g, ' '),
    'total recalculado após recarregar');

  // número avança ao clicar em "novo número"
  page.once('dialog', d => d.accept());
  await page.click('#regenNumero');
  const seqA = parseInt(numeroAntes.split('/')[0], 10);
  const seqB = parseInt((await page.inputValue('#orcNumero')).split('/')[0], 10);
  checar(seqB === seqA + 1, `numeração avança: ${seqA} -> ${seqB}`);

  // ---------- 4. layout de impressão ----------
  console.log('\n[4] Layout de impressão (A4)');
  await page.emulateMedia({ media: 'print' });
  const impressao = await page.evaluate(() => {
    const vis = s => {
      const e = document.querySelector(s);
      if (!e) return null;
      const c = getComputedStyle(e);
      return c.display !== 'none' && c.visibility !== 'hidden';
    };
    const cols = s => getComputedStyle(document.querySelector(s)).gridTemplateColumns.split(' ').length;
    return {
      carimbo: vis('.carimbo'),
      editor: vis('.editor'),
      cabecalho: vis('header.top'),
      assinaturas: vis('.assinaturas'),
      colunasPagamento: cols('.payment-box'),
      colunasAssinatura: cols('.assinaturas .linhas'),
      direcaoCabecalhoDoc: getComputedStyle(document.querySelector('.doc-head')).flexDirection,
    };
  });
  checar(impressao.editor === false, 'editor escondido na impressão');
  checar(impressao.cabecalho === false, 'cabeçalho da tela escondido na impressão');
  checar(impressao.assinaturas === true, 'assinaturas aparecem na impressão');
  checar(impressao.carimbo === true, 'carimbo aparece na impressão (era escondido antes)');
  checar(impressao.colunasPagamento === 2, `cartões de pagamento lado a lado (${impressao.colunasPagamento} colunas)`);
  checar(impressao.colunasAssinatura === 2, `assinaturas lado a lado (${impressao.colunasAssinatura} colunas)`);
  checar(impressao.direcaoCabecalhoDoc === 'row', `cabeçalho do documento em linha (${impressao.direcaoCabecalhoDoc})`);

  await page.pdf({ path: `${SAIDA}/orcamento.pdf`, format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });

  // ---------- 5. iPhone ----------
  console.log('\n[5] iPhone (Safari)');
  const ctxIphone = await browser.newContext({ ...devices['iPhone 13'] });
  const iphone = await ctxIphone.newPage();
  await iphone.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await iphone.fill('#cliNome', 'Construtora Alvorada Ltda');
  await iphone.fill('#cliEndereco', 'Rua das Palmeiras, 480 — Bauru/SP');
  await iphone.fill('.s-desc', 'Forro de gesso liso com moldura');
  await iphone.fill('.s-qtd', '38,5');
  await iphone.fill('.s-valor', '92,50');

  const tamanhoCampo = await iphone.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('#cliNome')).fontSize));
  checar(tamanhoCampo >= 16, `campos com 16px+ (evita zoom do Safari): ${tamanhoCampo}px`);

  const rolagem = await iphone.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  checar(rolagem, 'sem rolagem horizontal no iPhone');

  const alvo = await iphone.evaluate(() => {
    const b = document.querySelector('#regenNumero').getBoundingClientRect();
    return Math.min(b.width, b.height);
  });
  checar(alvo >= 44, `botões com alvo de toque >= 44px: ${alvo}px`);

  await iphone.screenshot({ path: `${SAIDA}/02-iphone.png`, fullPage: true });

  // ---------- 6. offline ----------
  console.log('\n[6] Funcionamento offline');
  await iphone.waitForTimeout(1200);          // deixa o service worker instalar
  const swAtivo = await iphone.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return !!(r && (r.active || r.waiting || r.installing));
  });
  checar(swAtivo, 'service worker registrado');

  await ctxIphone.setOffline(true);
  const resp = await iphone.reload({ waitUntil: 'domcontentloaded' }).catch(e => String(e));
  const carregouOffline = await iphone.evaluate(() =>
    !!document.querySelector('#totTotal')).catch(() => false);
  checar(carregouOffline, 'app abre sem internet');
  const clienteOffline = await iphone.inputValue('#cliNome').catch(() => '');
  checar(clienteOffline === 'Construtora Alvorada Ltda', 'dados preservados offline');
  await ctxIphone.setOffline(false);

  await browser.close();
  srv.close();

  console.log(`\n${falhas.length ? 'FALHAS: ' + falhas.length : 'Todos os testes passaram'}`);
  process.exit(falhas.length ? 1 : 0);
})();
