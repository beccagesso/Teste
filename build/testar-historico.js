/* Testa o histórico de orçamentos: arquivamento automático, busca,
   abrir, duplicar, excluir e sobrevivência ao recarregar. */
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

/* preenche um orçamento inteiro na tela */
async function preencher(p, { cliente, obra, desc, qtd, unidade, valor }) {
  await p.fill('#cliNome', cliente);
  await p.fill('#cliEndereco', obra);
  await p.fill('.s-desc', desc);
  await p.fill('.s-qtd', qtd);
  if (unidade) await p.locator('.s-unidade').first().selectOption(unidade);
  await p.fill('.s-valor', valor);
  await p.waitForTimeout(600);          // deixa o salvamento automático rodar
}

const guardados = p => p.evaluate(() =>
  JSON.parse(localStorage.getItem('beccaGesso.historico.v1') || '[]'));

(async () => {
  const srv = await servidor();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));
  await p.goto(`${base}/index.html`, { waitUntil: 'networkidle' });

  // ---------- 1. arquivamento automático ----------
  console.log('\n[1] Arquivamento automático');
  checar((await guardados(p)).length === 0, 'histórico começa vazio');

  await p.waitForTimeout(600);
  checar((await guardados(p)).length === 0,
    'orçamento em branco não entra no histórico');

  await preencher(p, {
    cliente: 'Construtora Alvorada Ltda', obra: 'Rua das Palmeiras, 480 — Bauru/SP',
    desc: 'Forro de gesso liso', qtd: '38,5', unidade: 'm²', valor: '92,50',
  });
  const num1 = await p.inputValue('#orcNumero');
  let hist = await guardados(p);
  checar(hist.length === 1, `orçamento preenchido foi guardado (${hist.length})`);
  checar(hist[0].orcNumero === num1, `guardado sob o próprio número (${num1})`);
  checar(Math.abs(hist[0].total - 38.5 * 92.5) < 0.01,
    `total guardado: ${hist[0].total} (esperado ${38.5 * 92.5})`);
  checar(hist[0].servicos[0].unidade === 'm²', 'unidade guardada junto');

  // editar não deve criar uma segunda entrada
  await p.fill('#cliNome', 'Construtora Alvorada Ltda ME');
  await p.waitForTimeout(600);
  hist = await guardados(p);
  checar(hist.length === 1, `editar atualiza a mesma entrada (${hist.length})`);
  checar(hist[0].cliNome === 'Construtora Alvorada Ltda ME', 'edição foi gravada');

  // ---------- 2. "Novo" não perde o anterior ----------
  console.log('\n[2] Botão "Novo"');
  await p.click('#resetBtn');
  await p.waitForTimeout(400);
  const num2 = await p.inputValue('#orcNumero');
  checar(num2 !== num1, `novo orçamento pegou outro número (${num1} -> ${num2})`);
  checar((await p.inputValue('#cliNome')) === '', 'formulário foi limpo');
  hist = await guardados(p);
  checar(hist.length === 1, 'o orçamento anterior continua guardado');

  await preencher(p, {
    cliente: 'Marcos Ribeiro', obra: 'Av. Nações Unidas, 92 — Marília/SP',
    desc: 'Parede drywall', qtd: '14', unidade: 'm.l.', valor: '310,00',
  });
  hist = await guardados(p);
  checar(hist.length === 2, `agora são dois orçamentos (${hist.length})`);
  checar(hist[0].cliNome === 'Marcos Ribeiro', 'o mais recente vem primeiro');

  // ---------- 3. painel e busca ----------
  console.log('\n[3] Painel e busca');
  await p.click('#histBtn');
  await p.waitForTimeout(200);
  checar(await p.locator('#painelHist').isVisible(), 'painel abre');
  checar((await p.locator('.hist-item').count()) === 2,
    `dois itens na lista (${await p.locator('.hist-item').count()})`);
  checar((await p.locator('.hist-item.atual').count()) === 1,
    'o orçamento aberto está destacado');

  await p.fill('#histBusca', 'alvorada');
  await p.waitForTimeout(150);
  checar((await p.locator('.hist-item').count()) === 1, 'busca por cliente filtra');
  await p.fill('#histBusca', num1);
  await p.waitForTimeout(150);
  checar((await p.locator('.hist-item').count()) === 1, 'busca por número filtra');
  await p.fill('#histBusca', 'zzzz');
  await p.waitForTimeout(150);
  checar((await p.locator('.hist-vazio').count()) === 1, 'busca sem resultado avisa');
  await p.fill('#histBusca', '');
  await p.waitForTimeout(150);

  // ---------- 4. abrir ----------
  console.log('\n[4] Abrir um orçamento antigo');
  const itemAlvorada = p.locator('.hist-item').filter({ hasText: 'Alvorada' });
  await itemAlvorada.locator('.hist-abrir').click();
  await p.waitForTimeout(300);
  checar(await p.locator('#painelHist').isHidden(), 'painel fecha ao abrir');
  checar((await p.inputValue('#cliNome')) === 'Construtora Alvorada Ltda ME',
    'cliente do orçamento antigo foi carregado');
  checar((await p.inputValue('#orcNumero')) === num1,
    `número do orçamento antigo foi mantido (${num1})`);
  checar((await p.locator('.s-unidade').first().inputValue()) === 'm²',
    'unidade voltou junto');
  hist = await guardados(p);
  checar(hist.length === 2, 'abrir não duplicou nada no histórico');

  // ---------- 5. duplicar ----------
  console.log('\n[5] Duplicar');
  await p.click('#histBtn');
  await p.waitForTimeout(200);
  await p.locator('.hist-item').filter({ hasText: 'Marcos' })
    .locator('.hist-duplicar').click();
  await p.waitForTimeout(400);
  const num3 = await p.inputValue('#orcNumero');
  checar(num3 !== num1 && num3 !== num2, `a cópia ganhou número novo (${num3})`);
  checar((await p.inputValue('#cliNome')) === 'Marcos Ribeiro',
    'a cópia trouxe os mesmos dados');
  checar((await p.locator('.s-unidade').first().inputValue()) === 'm.l.',
    'a cópia trouxe a unidade');
  hist = await guardados(p);
  checar(hist.length === 3, `agora são três orçamentos (${hist.length})`);

  // ---------- 6. sobreviver ao recarregar ----------
  console.log('\n[6] Recarregar o app');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  hist = await guardados(p);
  checar(hist.length === 3, `os três continuam guardados (${hist.length})`);
  await p.click('#histBtn');
  await p.waitForTimeout(200);
  checar((await p.locator('.hist-item').count()) === 3, 'a lista aparece igual');

  // ---------- 7. excluir ----------
  console.log('\n[7] Excluir');
  p.once('dialog', d => d.accept());
  await p.locator('.hist-item').filter({ hasText: 'Alvorada' })
    .locator('.hist-excluir').click();
  await p.waitForTimeout(300);
  hist = await guardados(p);
  checar(hist.length === 2, `sobraram dois (${hist.length})`);
  checar(!hist.some(e => e.orcNumero === num1), 'o excluído sumiu mesmo');
  checar((await p.locator('.hist-item').count()) === 2, 'a lista foi atualizada');

  // excluir o que está aberto começa um novo, para não voltar sozinho
  await p.fill('#histBusca', '');
  await p.waitForTimeout(150);
  const abertoAgora = await p.inputValue('#orcNumero');
  p.once('dialog', d => d.accept());
  await p.locator('.hist-item.atual').locator('.hist-excluir').click();
  await p.waitForTimeout(500);
  hist = await guardados(p);
  checar(!hist.some(e => e.orcNumero === abertoAgora),
    'excluir o orçamento aberto não o traz de volta ao digitar');

  // ---------- 8. situação de cada orçamento ----------
  console.log('\n[8] Situação');
  /* o painel continua aberto desde a seção anterior */
  await p.waitForTimeout(250);
  checar((await p.locator('.hist-chip').count()) === 4,
    'as quatro situações aparecem no resumo');
  const todos = await guardados(p);
  checar(todos.every(e => e.situacao === 'rascunho'),
    'todo orçamento começa como rascunho');

  const primeiro = await p.locator('.hist-item').first();
  await primeiro.locator('.hist-sit').selectOption('aprovado');
  await p.waitForTimeout(250);
  const numAprovado = (await guardados(p)).find(e => e.situacao === 'aprovado');
  checar(!!numAprovado, 'a situação foi gravada');

  const chipAprovado = p.locator('.hist-chip.sit-aprovado');
  checar((await chipAprovado.locator('.chip-qtd').textContent()) === '1',
    'o resumo conta o aprovado');
  checar((await chipAprovado.locator('.chip-val').textContent())
    .replace(/\s/g, ' ').includes('R$'),
    'o resumo soma o valor aprovado');

  // o quadrinho também filtra
  const totalGuardado = (await guardados(p)).length;
  await chipAprovado.click();
  await p.waitForTimeout(200);
  checar((await p.locator('.hist-item').count()) === 1,
    'clicar no resumo filtra por aquela situação');
  await p.locator('.hist-chip.sit-rascunho').click();
  await p.waitForTimeout(200);
  checar((await p.locator('.hist-item').count()) ===
      totalGuardado - 1 || (await p.locator('.hist-vazio').count()) === 1,
    'trocar de filtro mostra a outra situação');
  await p.locator('.hist-chip.sit-rascunho').click();
  await p.waitForTimeout(200);
  checar((await p.locator('.hist-item').count()) === totalGuardado,
    `clicar de novo tira o filtro (${totalGuardado} no total)`);

  /* editar o orçamento não pode rebaixar um aprovado para rascunho */
  await p.locator('.hist-item').filter({ hasText: numAprovado.cliNome })
    .first().locator('.hist-abrir').click();
  await p.waitForTimeout(300);
  await p.fill('#cliNome', numAprovado.cliNome + ' — obra 2');
  await p.waitForTimeout(700);
  const depoisDeEditar = (await guardados(p))
    .find(e => e.orcNumero === numAprovado.orcNumero);
  checar(depoisDeEditar && depoisDeEditar.situacao === 'aprovado',
    `editar mantém a situação (${depoisDeEditar ? depoisDeEditar.situacao : '—'})`);

  // ---------- 9. cliente sugerido ----------
  console.log('\n[9] Cliente já atendido');
  /* abrir um orçamento já fecha o painel; garante que está fechado */
  if(await p.locator('#painelHist').isVisible()){
    await p.click('#histFechar');
    await p.waitForTimeout(200);
  }

  /* cria um cliente conhecido só para esta seção, para não depender do
     que as seções anteriores deixaram no histórico */
  await p.click('#resetBtn');
  await p.waitForTimeout(400);
  await preencher(p, {
    cliente: 'Edificadora Santa Rita', obra: 'Rua Rio Branco, 77 — Jaú/SP',
    desc: 'Forro de gesso', qtd: '20', unidade: 'm²', valor: '95,00',
  });

  await p.click('#resetBtn');
  await p.waitForTimeout(400);
  await p.locator('#cliNome').focus();
  await p.waitForTimeout(150);
  const sugestoes = await p.evaluate(() =>
    [...document.querySelectorAll('#clientesConhecidos option')].map(o => o.value));
  checar(sugestoes.length > 0, `clientes sugeridos: ${sugestoes.length}`);
  checar(sugestoes.includes('Edificadora Santa Rita'),
    `o cliente já atendido está entre as sugestões (${sugestoes.join(' | ')})`);
  checar(new Set(sugestoes).size === sugestoes.length,
    'nenhum cliente repetido na lista');

  await p.fill('#cliNome', 'Edificadora Santa Rita');
  await p.waitForTimeout(300);
  checar((await p.inputValue('#cliEndereco')).includes('Rio Branco'),
    `endereço da obra veio junto: "${await p.inputValue('#cliEndereco')}"`);

  /* endereço já digitado não pode ser sobrescrito */
  await p.click('#resetBtn');
  await p.waitForTimeout(400);
  await p.fill('#cliEndereco', 'Endereço novo, 500');
  await p.fill('#cliNome', 'Edificadora Santa Rita');
  await p.waitForTimeout(300);
  checar((await p.inputValue('#cliEndereco')) === 'Endereço novo, 500',
    'endereço já preenchido não é substituído');

  checar(erros.length === 0,
    `sem erros de JavaScript ${erros.length ? '-> ' + erros.join(' | ') : ''}`);

  await browser.close();
  srv.close();
  console.log(falhas.length ? `\nFALHAS: ${falhas.length}` : '\nHistórico OK');
  process.exit(falhas.length ? 1 : 0);
})();
