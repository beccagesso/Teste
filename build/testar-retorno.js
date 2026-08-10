/* Testa o retorno ao cliente: quem entra na lista de cobrança, quando,
   o número que abre no WhatsApp e o texto de cada etapa. */
const { chromium, devices } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const RAIZ = '/home/user/Teste';
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

async function criarOrcamento(p, { cliente, telefone, valor }) {
  if (await p.locator('#painelHist').isVisible()) {
    await p.click('#histFechar');
    await p.waitForTimeout(200);
  }
  await p.click('#resetBtn');
  await p.waitForTimeout(350);
  await p.fill('#cliNome', cliente);
  await p.fill('#cliEndereco', 'Rua das Palmeiras, 480 — Bauru/SP');
  if (telefone) await p.fill('#cliTelefone', telefone);
  await p.fill('.s-desc', 'Forro de gesso liso');
  await p.fill('.s-qtd', '10');
  await p.fill('.s-valor', valor);
  await p.waitForTimeout(600);
  return p.inputValue('#orcNumero');
}

/* finge que o orçamento foi enviado há N dias */
const envelhecer = (p, numero, dias) => p.evaluate(({ numero, dias }) => {
  const chave = 'beccaGesso.historico.v1';
  const lista = JSON.parse(localStorage.getItem(chave) || '[]');
  const e = lista.find(x => x.orcNumero === numero);
  e.situacao = 'enviado';
  e.enviadoEm = Date.now() - dias * 24 * 60 * 60 * 1000;
  localStorage.setItem(chave, JSON.stringify(lista));
}, { numero, dias });

(async () => {
  const srv = await servidor();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));
  await p.goto(`${base}/index.html`, { waitUntil: 'networkidle' });

  /* guarda o que seria aberto no WhatsApp, sem abrir de verdade */
  await p.addInitScript(() => { window.__aberto = []; });
  await p.evaluate(() => {
    window.__aberto = [];
    window.open = (url) => { window.__aberto.push(url); return null; };
  });
  const ultimoAberto = () => p.evaluate(() =>
    window.__aberto[window.__aberto.length - 1] || null);

  // ---------- 1. número de telefone ----------
  console.log('\n[1] Número do cliente');
  const formatos = await p.evaluate(() => ({
    comMascara: telefoneParaWhats('(14) 99757-7371'),
    soDigitos: telefoneParaWhats('14997577371'),
    fixo: telefoneParaWhats('1433334444'),
    comPais: telefoneParaWhats('5514997577371'),
    curto: telefoneParaWhats('99757'),
    vazio: telefoneParaWhats(''),
  }));
  checar(formatos.comMascara === '5514997577371',
    `número com máscara vira ${formatos.comMascara}`);
  checar(formatos.soDigitos === '5514997577371', 'número sem máscara funciona');
  checar(formatos.fixo === '551433334444', 'telefone fixo funciona');
  checar(formatos.comPais === '5514997577371', 'número que já tem o 55 não duplica');
  checar(formatos.curto === '', 'número incompleto é recusado');
  checar(formatos.vazio === '', 'campo vazio é recusado');

  // ---------- 2. quem entra na lista ----------
  console.log('\n[2] Quem entra na lista de retorno');
  const numA = await criarOrcamento(p,
    { cliente: 'Marcos Ribeiro', telefone: '(14) 99757-7371', valor: '310,00' });
  const numSemFone = await criarOrcamento(p,
    { cliente: 'Cliente Sem Telefone', telefone: '', valor: '500,00' });

  await p.click('#histBtn');
  await p.waitForTimeout(250);
  checar(await p.locator('#histRetornos').isHidden(),
    'orçamento recém-criado ainda não pede retorno');

  await envelhecer(p, numA, 0);
  await p.evaluate(() => renderHistorico());
  await p.waitForTimeout(150);
  checar(await p.locator('#histRetornos').isHidden(),
    'enviado hoje ainda não pede retorno');

  await envelhecer(p, numA, 1);
  await p.evaluate(() => renderHistorico());
  await p.waitForTimeout(150);
  checar(await p.locator('#histRetornos').isVisible(),
    'depois de 1 dia, aparece na lista');
  checar((await p.locator('.retorno-item').count()) === 1,
    `um orçamento pedindo retorno (${await p.locator('.retorno-item').count()})`);
  checar((await p.locator('.retorno-quem').first().textContent()).includes('Marcos'),
    'é o orçamento certo');

  await envelhecer(p, numSemFone, 10);
  await p.evaluate(() => renderHistorico());
  await p.waitForTimeout(150);
  checar((await p.locator('.retorno-item').count()) === 1,
    'orçamento sem telefone não entra na lista');

  // aprovado ou recusado sai da cobrança
  await p.evaluate((n) => marcarSituacao(n, 'aprovado'), numA);
  await p.evaluate(() => renderHistorico());
  await p.waitForTimeout(150);
  checar(await p.locator('#histRetornos').isHidden(),
    'orçamento aprovado sai da lista de cobrança');
  await p.evaluate((n) => marcarSituacao(n, 'enviado'), numA);
  await envelhecer(p, numA, 1);
  await p.evaluate(() => renderHistorico());
  await p.waitForTimeout(150);

  // ---------- 3. abrir a conversa ----------
  console.log('\n[3] Abrir a conversa');
  await p.locator('.retorno-btn').first().click();
  await p.waitForTimeout(250);
  const url1 = await ultimoAberto();
  checar(url1 && url1.startsWith('https://wa.me/5514997577371?text='),
    `abre a conversa do cliente: ${url1 ? url1.slice(0, 46) : 'nada'}`);
  const texto1 = decodeURIComponent((url1 || '').split('text=')[1] || '');
  checar(texto1.includes('Marcos'), 'a mensagem chama o cliente pelo nome');
  checar(texto1.includes(numA), 'a mensagem cita o número do orçamento');
  checar(/R\$/.test(texto1), 'a mensagem traz o valor');

  checar(await p.locator('#histRetornos').isHidden(),
    'depois de mandar, sai da lista');

  // ---------- 4. as etapas seguintes ----------
  console.log('\n[4] Etapas de 5 e 10 dias');
  await envelhecer(p, numA, 5);
  await p.evaluate(() => renderHistorico());
  await p.waitForTimeout(150);
  checar(await p.locator('#histRetornos').isVisible(),
    'aos 5 dias volta a pedir retorno');
  await p.locator('.retorno-btn').first().click();
  await p.waitForTimeout(250);
  const texto5 = decodeURIComponent(
    ((await ultimoAberto()) || '').split('text=')[1] || '');
  checar(texto5 !== texto1, 'a mensagem de 5 dias é diferente da de 1 dia');
  checar(/dúvida/i.test(texto5), `mensagem de 5 dias: "${texto5.slice(0, 60)}…"`);

  await envelhecer(p, numA, 10);
  await p.evaluate(() => renderHistorico());
  await p.waitForTimeout(150);
  await p.locator('.retorno-btn').first().click();
  await p.waitForTimeout(250);
  const texto10 = decodeURIComponent(
    ((await ultimoAberto()) || '').split('text=')[1] || '');
  checar(texto10 !== texto5, 'a mensagem de 10 dias é diferente da de 5');
  checar(/venc|vale até/i.test(texto10),
    `mensagem de 10 dias fala da validade: "${texto10.slice(0, 60)}…"`);

  await envelhecer(p, numA, 30);
  await p.evaluate(() => renderHistorico());
  await p.waitForTimeout(150);
  checar(await p.locator('#histRetornos').isHidden(),
    'depois das três etapas, para de cobrar');

  /* pular direto para 10 dias não pode fazer as etapas antigas voltarem */
  const numB = await criarOrcamento(p,
    { cliente: 'Ana Paula', telefone: '14 98888-7777', valor: '900,00' });
  await envelhecer(p, numB, 12);
  await p.click('#histBtn');
  await p.waitForTimeout(250);
  const itemAna = p.locator('.retorno-item').filter({ hasText: 'Ana Paula' });
  checar((await itemAna.count()) === 1, 'orçamento de 12 dias pede retorno');
  await itemAna.locator('.retorno-btn').click();
  await p.waitForTimeout(250);
  await p.evaluate(() => renderHistorico());
  await p.waitForTimeout(150);
  checar((await p.locator('.retorno-item').filter({ hasText: 'Ana Paula' }).count()) === 0,
    'atender a etapa de 10 dias encerra também as anteriores');

  // ---------- 5. telefone sugerido junto com o cliente ----------
  console.log('\n[5] Telefone sugerido');
  if (await p.locator('#painelHist').isVisible()) {
    await p.click('#histFechar');
    await p.waitForTimeout(200);
  }
  await p.click('#resetBtn');
  await p.waitForTimeout(350);
  await p.fill('#cliNome', 'Ana Paula');
  await p.waitForTimeout(300);
  checar((await p.inputValue('#cliTelefone')).replace(/\D/g, '') === '14988887777',
    `telefone veio junto com o cliente: "${await p.inputValue('#cliTelefone')}"`);

  checar(erros.length === 0,
    `sem erros de JavaScript ${erros.length ? '-> ' + erros.join(' | ') : ''}`);

  await browser.close();
  srv.close();
  console.log(falhas.length ? `\nFALHAS: ${falhas.length}` : '\nRetorno ao cliente OK');
  process.exit(falhas.length ? 1 : 0);
})();
