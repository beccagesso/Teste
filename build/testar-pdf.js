/* Testa o gerador de PDF: estrutura do arquivo, cobertura das fontes,
   quebra de páginas e o caminho de envio pelo WhatsApp. */
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

/* gera um PDF na página e devolve os bytes como Buffer */
async function gerar(p, qtdServicos) {
  const b64 = await p.evaluate((qtd) => {
    const lista = [];
    for (let i = 0; i < qtd; i++) lista.push({
      desc: 'Serviço de gesso número ' + (i + 1) + ' com descrição de tamanho médio',
      qtd: 12.5, valor: 340.75,
      unidade: i % 3 === 0 ? 'm²' : (i % 3 === 1 ? 'm.l.' : 'un.'),
    });
    const d = dadosParaPdf();
    d.servicos = lista;
    d.subtotal = d.total = lista.reduce((a, x) => a + x.qtd * x.valor, 0);
    d.parcela = d.total / 5;
    d.avista = d.total * 0.94;
    const bytes = gerarPdfDoOrcamento(d);
    let bin = ''; const c = 8192;
    for (let i = 0; i < bytes.length; i += c)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + c));
    return btoa(bin);
  }, qtdServicos);
  return Buffer.from(b64, 'base64');
}

(async () => {
  const srv = await servidor();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));
  await p.goto(`${base}/index.html`, { waitUntil: 'networkidle' });

  await p.fill('#cliNome', 'Construtora Alvorada Ltda');
  await p.fill('#cliEndereco', 'Rua das Palmeiras, 480 — Centro, Bauru/SP');
  await p.fill('#orcData', '2026-08-10');
  await p.fill('.s-desc', 'Forro de gesso liso com moldura');
  await p.fill('.s-qtd', '38,5');
  await p.fill('.s-valor', '92,50');
  await p.waitForTimeout(400);

  // ---------- 1. cobertura das fontes ----------
  console.log('\n[1] Cobertura das fontes do PDF');
  const semGlifo = await p.evaluate(() => {
    /* tudo que um orçamento pode imprimir, incluindo o ² de m² */
    const amostra = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' +
      '0123456789 .,;:!?()/-–—·×%$ºª²³ÁÂÃÉÊÍÓÔÕÚÇáâãéêíóôõúç' +
      'R$ m² m.l. un. Nº ORÇAMENTO';
    const faltando = {};
    for (const [apelido, dados] of Object.entries(PDF_ATIVOS.fontes)) {
      const ausentes = [...new Set(amostra)]
        .filter(ch => dados.cmap[ch.codePointAt(0)] === undefined);
      if (ausentes.length) faltando[apelido] = ausentes.join('');
    }
    return faltando;
  });
  checar(Object.keys(semGlifo).length === 0,
    `todas as fontes cobrem os caracteres do orçamento ${JSON.stringify(semGlifo)}`);

  // ---------- 2. estrutura do arquivo ----------
  console.log('\n[2] Estrutura do PDF');
  const pdf = await gerar(p, 3);
  const texto = pdf.toString('latin1');
  checar(texto.startsWith('%PDF-1.'), 'começa com a assinatura de PDF');
  checar(texto.trimEnd().endsWith('%%EOF'), 'termina com %%EOF');
  checar(texto.includes('/Type /Catalog'), 'tem catálogo');
  checar(/startxref\s+\d+/.test(texto), 'tem tabela de referências');
  checar(pdf.length > 40000, `tamanho plausível (${(pdf.length / 1024).toFixed(0)} KB)`);

  const qtdFontes = (texto.match(/\/Subtype \/CIDFontType2/g) || []).length;
  checar(qtdFontes === 5, `as 5 fontes foram embutidas (${qtdFontes})`);
  const qtdUnicode = (texto.match(/\/ToUnicode /g) || []).length;
  checar(qtdUnicode === 5,
    `todas as fontes têm mapa Unicode, para o texto poder ser copiado (${qtdUnicode})`);
  checar(texto.includes('/RunLengthDecode'), 'logo embutido');

  // a tabela de referências precisa apontar para o número certo de objetos
  const declarado = Number((texto.match(/\/Size (\d+)/) || [])[1]);
  const objetos = (texto.match(/^\d+ 0 obj$/gm) || []).length;
  checar(declarado === objetos + 1,
    `tabela de referências bate com os objetos (${declarado} = ${objetos} + 1)`);

  // ---------- 3. quebra de páginas ----------
  console.log('\n[3] Quebra de páginas');
  const contarPaginas = b => (b.toString('latin1').match(/\/Type \/Page[^s]/g) || []).length;
  const p3 = contarPaginas(await gerar(p, 3));
  const p30 = contarPaginas(await gerar(p, 30));
  checar(p3 === 1, `3 serviços cabem em 1 página (${p3})`);
  checar(p30 >= 2 && p30 <= 5, `30 serviços quebram em várias páginas (${p30})`);

  /* o cabeçalho da empresa tem de aparecer em toda página: uma folha
     solta nunca pode virar um papel sem identificação */
  const longo = await gerar(p, 30);
  const marcasLogo = (longo.toString('latin1').match(/\/Logo Do/g) || []).length;
  checar(marcasLogo === contarPaginas(longo),
    `logo em todas as páginas (${marcasLogo} de ${contarPaginas(longo)})`);

  // nenhum tamanho pode gerar erro
  let quebrou = null;
  for (const n of [0, 1, 7, 8, 12, 16, 22]) {
    try { await gerar(p, n); } catch (e) { quebrou = `${n} serviços: ${e.message}`; break; }
  }
  checar(quebrou === null, `gera sem erro de 0 a 22 serviços ${quebrou || ''}`);

  // ---------- 4. envio ----------
  console.log('\n[4] Envio pelo WhatsApp');
  const nome = await p.evaluate(() => nomeDoArquivo());
  checar(/^Orcamento - \d{4}-\d{4} - Construtora Alvorada Ltda\.pdf$/.test(nome),
    `nome do arquivo: ${nome}`);

  const resumo = await p.evaluate(() => resumoParaTexto(dadosParaPdf()));
  checar(resumo.includes('Construtora Alvorada Ltda'), 'resumo em texto traz o cliente');
  checar(/R\$/.test(resumo), 'resumo em texto traz os valores');

  /* o botão precisa produzir um arquivo de verdade para o compartilhamento */
  const arquivo = await p.evaluate(async () => {
    const blob = pdfDoOrcamento();
    const f = new File([blob], nomeDoArquivo(), {type: 'application/pdf'});
    return {tipo: f.type, tamanho: f.size, podeCompartilhar:
      !!(navigator.canShare && navigator.canShare({files: [f]}))};
  });
  checar(arquivo.tipo === 'application/pdf', 'gera um arquivo PDF');
  checar(arquivo.tamanho > 40000, `arquivo com conteúdo (${(arquivo.tamanho / 1024).toFixed(0)} KB)`);
  console.log(`  nota  compartilhamento com arquivo disponível neste navegador: ` +
    `${arquivo.podeCompartilhar} (no iPhone é o que abre a folha do WhatsApp)`);

  checar(erros.length === 0,
    `sem erros de JavaScript ${erros.length ? '-> ' + erros.join(' | ') : ''}`);

  await browser.close();
  srv.close();
  console.log(falhas.length ? `\nFALHAS: ${falhas.length}` : '\nGerador de PDF OK');
  process.exit(falhas.length ? 1 : 0);
})();
