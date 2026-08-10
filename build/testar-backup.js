/* Testa o backup: geração do arquivo, restauração juntando com o que já
   existe, ajuste da numeração e recusa de arquivo que não é backup. */
const { chromium, devices } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');

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

async function preencher(p, cliente, obra, valor) {
  await p.fill('#cliNome', cliente);
  await p.fill('#cliEndereco', obra);
  await p.fill('.s-desc', 'Forro de gesso liso');
  await p.fill('.s-qtd', '10');
  await p.fill('.s-valor', valor);
  await p.waitForTimeout(600);
}

const guardados = p => p.evaluate(() =>
  JSON.parse(localStorage.getItem('beccaGesso.historico.v1') || '[]'));

(async () => {
  const srv = await servidor();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));
  await p.goto(`${base}/index.html`, { waitUntil: 'networkidle' });

  // ---------- 1. gerar o backup ----------
  console.log('\n[1] Gerar o backup');
  await preencher(p, 'Construtora Alvorada Ltda', 'Rua das Palmeiras, 480', '92,50');
  await p.click('#resetBtn');
  await p.waitForTimeout(400);
  await preencher(p, 'Marcos Ribeiro', 'Av. Nações Unidas, 92', '310,00');
  checar((await guardados(p)).length === 2, 'dois orçamentos para guardar');

  await p.click('#histBtn');
  await p.waitForTimeout(200);
  const [baixado] = await Promise.all([
    p.waitForEvent('download', { timeout: 15000 }).catch(() => null),
    p.click('#backupBtn'),
  ]);
  checar(baixado !== null, 'o backup gerou um arquivo');
  checar(baixado && /^becca-gesso-backup-\d{4}-\d{2}-\d{2}\.json$/.test(baixado.suggestedFilename()),
    `nome do arquivo: ${baixado ? baixado.suggestedFilename() : '—'}`);

  const caminho = path.join(os.tmpdir(), 'backup-teste.json');
  await baixado.saveAs(caminho);
  const conteudo = JSON.parse(fs.readFileSync(caminho, 'utf-8'));
  checar(conteudo.app === 'becca-gesso-orcamentos', 'arquivo se identifica como backup');
  checar(Array.isArray(conteudo.historico) && conteudo.historico.length === 2,
    `traz os 2 orçamentos (${conteudo.historico ? conteudo.historico.length : 0})`);
  checar(!!conteudo.contador, 'traz a numeração');
  checar(conteudo.historico.every(e => e.orcNumero && e.servicos),
    'cada orçamento veio inteiro');

  // ---------- 2. restaurar num aparelho vazio ----------
  console.log('\n[2] Restaurar em um aparelho novo');
  const ctx2 = await browser.newContext({ ...devices['iPhone 13'] });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => erros.push('p2: ' + String(e)));
  await p2.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  checar((await guardados(p2)).length === 0, 'aparelho novo começa vazio');

  await p2.click('#histBtn');
  await p2.waitForTimeout(200);
  p2.once('dialog', d => d.accept());
  await p2.locator('#restaurarArquivo').setInputFiles(caminho);
  await p2.waitForTimeout(600);

  const restaurado = await guardados(p2);
  checar(restaurado.length === 2, `os 2 orçamentos voltaram (${restaurado.length})`);
  checar(restaurado.some(e => e.cliNome === 'Construtora Alvorada Ltda') &&
         restaurado.some(e => e.cliNome === 'Marcos Ribeiro'),
    'os dois clientes voltaram');

  /* a numeração precisa continuar de onde parou, senão o próximo
     orçamento repetiria um número já usado */
  const proximo = await p2.evaluate(() => proximoNumero());
  checar(proximo === '0003/' + new Date().getFullYear(),
    `numeração continua de onde parou: ${proximo}`);

  // ---------- 3. restaurar juntando, sem perder o que já existe ----------
  console.log('\n[3] Restaurar sem apagar o que já existe');
  const ctx3 = await browser.newContext({ ...devices['iPhone 13'] });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', e => erros.push('p3: ' + String(e)));
  await p3.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await preencher(p3, 'Cliente Só Deste Aparelho', 'Rua Nova, 1', '500,00');
  const antesDeRestaurar = (await guardados(p3)).length;

  await p3.click('#histBtn');
  await p3.waitForTimeout(200);
  p3.once('dialog', d => d.accept());
  await p3.locator('#restaurarArquivo').setInputFiles(caminho);
  await p3.waitForTimeout(600);

  const depois = await guardados(p3);
  checar(depois.some(e => e.cliNome === 'Cliente Só Deste Aparelho'),
    'o orçamento que só existia aqui continua');
  checar(depois.length >= antesDeRestaurar,
    `nada foi perdido (${antesDeRestaurar} -> ${depois.length})`);

  // ---------- 4. arquivo que não é backup ----------
  console.log('\n[4] Arquivo errado');
  const lixo = path.join(os.tmpdir(), 'nao-e-backup.json');
  fs.writeFileSync(lixo, JSON.stringify({qualquer: 'coisa'}));
  const antesDoLixo = (await guardados(p3)).length;
  let avisou = false;
  p3.once('dialog', d => { avisou = /não é um backup|não parece/.test(d.message()); d.accept(); });
  await p3.locator('#restaurarArquivo').setInputFiles(lixo);
  await p3.waitForTimeout(500);
  checar(avisou, 'avisa que o arquivo não é um backup');
  checar((await guardados(p3)).length === antesDoLixo,
    'o histórico não foi mexido pelo arquivo errado');

  checar(erros.length === 0,
    `sem erros de JavaScript ${erros.length ? '-> ' + erros.join(' | ') : ''}`);

  await browser.close();
  srv.close();
  console.log(falhas.length ? `\nFALHAS: ${falhas.length}` : '\nBackup OK');
  process.exit(falhas.length ? 1 : 0);
})();
