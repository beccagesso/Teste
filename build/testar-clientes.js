/* Testa a Etapa 2 (Becca OS): a entidade Cliente, a migração automática
   dos orçamentos antigos, o vínculo de fornecedor/categoria nas contas
   a pagar, e a soma de dinheiro sem perder centavo. */
const { chromium, devices } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const falso = require('./falso-supabase.js');

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

async function irPara(p, secao) {
  await p.click(`.secao-btn[data-secao="${secao}"]`);
  await p.waitForTimeout(250);
}

(async () => {
  const srv = await servidor();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(() => localStorage.setItem('beccaGesso.nuvemDesligada.v1', 'true'));
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));
  p.on('dialog', d => d.accept());
  await p.goto(`${base}/index.html`, { waitUntil: 'networkidle' });

  // =========================================================
  console.log('\n[1] Cadastro de cliente');
  // =========================================================
  await irPara(p, 'clientes');
  checar(await p.locator('.contas-vazio').isVisible(), 'lista começa vazia');

  await p.click('#cliNovoBtn');
  await p.waitForTimeout(150);
  await p.fill('#cliFormNome', 'Construtora Beta Ltda');
  await p.fill('#cliFormTelefone', '(14) 3223-4455');
  await p.fill('#cliFormEmail', 'contato@beta.com');
  await p.fill('#cliFormDocumento', '12.345.678/0001-90');
  await p.fill('#cliFormEndereco', 'Av. Getúlio Vargas, 900');
  await p.fill('#cliFormCidade', 'Bauru');
  await p.click('#cliSalvar');
  await p.waitForTimeout(250);
  checar(await p.locator('.cliente-item').count() === 1, 'o cliente aparece na lista');
  checar((await p.locator('.cliente-item .conta-desc').textContent()) === 'Construtora Beta Ltda',
    'com o nome certo');
  checar((await p.locator('.cliente-item').textContent()).includes('0 orçamentos'),
    'começa sem orçamentos');

  // =========================================================
  console.log('\n[2] Buscar por nome, telefone e documento');
  // =========================================================
  await p.click('#cliNovoBtn');
  await p.waitForTimeout(150);
  await p.fill('#cliFormNome', 'Marcenaria Ipê');
  await p.fill('#cliFormTelefone', '(14) 99111-2233');
  await p.click('#cliSalvar');
  await p.waitForTimeout(250);
  checar(await p.locator('.cliente-item').count() === 2, 'dois clientes cadastrados');

  await p.fill('#cliBusca', 'beta');
  await p.waitForTimeout(200);
  checar(await p.locator('.cliente-item').count() === 1, 'busca por parte do nome filtra');

  await p.fill('#cliBusca', '99111');
  await p.waitForTimeout(200);
  checar((await p.locator('.cliente-item .conta-desc').textContent()) === 'Marcenaria Ipê',
    'busca por telefone encontra');

  await p.fill('#cliBusca', '12.345.678');
  await p.waitForTimeout(200);
  checar((await p.locator('.cliente-item .conta-desc').textContent()) === 'Construtora Beta Ltda',
    'busca por documento encontra');

  await p.fill('#cliBusca', '');
  await p.waitForTimeout(200);

  // =========================================================
  console.log('\n[3] Editar cliente');
  // =========================================================
  await p.click('.cliente-item:has-text("Marcenaria Ipê") .cli-abrir');
  await p.waitForTimeout(200);
  checar(await p.inputValue('#cliFormNome') === 'Marcenaria Ipê', 'abre com os dados certos');
  await p.fill('#cliFormCidade', 'Jaú');
  await p.click('#cliSalvar');
  await p.waitForTimeout(250);
  await p.click('.cliente-item:has-text("Marcenaria Ipê") .cli-abrir');
  await p.waitForTimeout(200);
  checar(await p.inputValue('#cliFormCidade') === 'Jaú', 'a edição foi gravada');
  await p.click('#cliFechar');
  await p.waitForTimeout(150);

  // =========================================================
  console.log('\n[4] Desativar cliente');
  // =========================================================
  await p.click('.cliente-item:has-text("Marcenaria Ipê") .cli-abrir');
  await p.waitForTimeout(200);
  await p.click('#cliDesativar');
  await p.waitForTimeout(250);
  checar(await p.locator('.cliente-item').count() === 1,
    'cliente desativado some da lista');
  const clientesGravados = await p.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.clientes.v1') || '[]'));
  checar(Array.isArray(clientesGravados) && clientesGravados.length === 2,
    'mas continua gravado (desativar não é excluir)');

  // =========================================================
  console.log('\n[5] Cliente selecionado no orçamento');
  // =========================================================
  await irPara(p, 'orcamentos');
  await p.click('#resetBtn');
  await p.waitForTimeout(300);
  await p.fill('#cliNome', 'Construtora Beta');
  await p.waitForTimeout(250);
  await p.click('.cli-busca-item[data-id]');
  await p.waitForTimeout(200);
  checar(await p.inputValue('#cliNome') === 'Construtora Beta Ltda', 'nome completo preenchido');
  checar((await p.inputValue('#cliTelefone')).includes('3223-4455'), 'telefone veio junto');
  checar((await p.inputValue('#cliEndereco')).includes('Getúlio Vargas'), 'endereço veio junto');

  await p.fill('.s-desc', 'Sanca de gesso');
  await p.fill('.s-qtd', '15');
  await p.fill('.s-valor', '80,00');
  await p.waitForTimeout(600);
  const numeroBeta = await p.inputValue('#orcNumero');

  await irPara(p, 'clientes');
  checar((await p.locator('.cliente-item:has-text("Construtora Beta") .cliente-qtd').textContent())
    .includes('1'), 'o orçamento aparece contado no cliente');
  await p.click('.cliente-item:has-text("Construtora Beta") .cli-abrir');
  await p.waitForTimeout(200);
  checar((await p.locator('#cliFicha').textContent()).includes(numeroBeta),
    'a ficha do cliente lista o orçamento');
  await p.click('#cliFechar');
  await p.waitForTimeout(150);

  // =========================================================
  console.log('\n[6] Novo cliente sem sair do orçamento');
  // =========================================================
  await irPara(p, 'orcamentos');
  await p.click('#resetBtn');
  await p.waitForTimeout(300);
  await p.fill('#cliNome', 'Gráfica Union');
  await p.waitForTimeout(250);
  checar(await p.locator('#cliBuscaNovo').isVisible(), 'oferece "+ Novo cliente"');
  await p.click('#cliBuscaNovo');
  await p.waitForTimeout(200);
  checar(await p.locator('#painelCliente').isVisible(), 'abre o cadastro sem sair do orçamento');
  checar(await p.inputValue('#cliFormNome') === 'Gráfica Union', 'já vem com o nome digitado');
  await p.fill('#cliFormTelefone', '14 99222-3344');
  await p.click('#cliSalvar');
  await p.waitForTimeout(250);
  checar(await p.locator('#painelCliente').isHidden(), 'fecha o cadastro ao salvar');
  checar(await p.inputValue('#cliNome') === 'Gráfica Union',
    'o orçamento continua com o cliente novo selecionado');
  checar((await p.inputValue('#cliTelefone')).includes('99222-3344'),
    'e já traz o telefone que acabou de cadastrar');

  await irPara(p, 'clientes');
  /* Marcenaria Ipê foi desativada no passo [4] — a lista mostra só os
     ativos: Construtora Beta Ltda e Gráfica Union */
  checar(await p.locator('.cliente-item').count() === 2,
    'o cliente novo entrou no cadastro (2 ativos, mais o desativado)');

  // =========================================================
  console.log('\n[7] Fornecedor e categoria nas contas a pagar');
  // =========================================================
  await irPara(p, 'contas');
  await p.fill('#ctDescricao', 'Compra de placas');
  await p.fill('#ctFornecedor', 'Depósito São José');
  await p.fill('#ctValor', '620,00');
  await p.fill('#ctVencimento', '2026-09-01');
  await p.selectOption('#ctCategoria', { label: 'Material' });
  await p.click('#ctSalvar');
  await p.waitForTimeout(250);

  const contaGravada = await p.evaluate(() =>
    window.__beccaTeste.lerContas().find(c => c.descricao === 'Compra de placas'));
  checar(!!contaGravada.fornecedorId, 'a conta ganhou um fornecedorId');
  checar(!!contaGravada.categoriaId, 'e um categoriaId');
  checar(contaGravada.fornecedor === 'Depósito São José',
    'o texto do fornecedor continua gravado (compatibilidade)');
  checar(contaGravada.categoria === 'Material',
    'o texto da categoria continua gravado (compatibilidade)');

  /* lançar outra conta para o mesmo fornecedor não duplica o cadastro */
  await p.fill('#ctDescricao', 'Compra de parafusos');
  await p.fill('#ctFornecedor', 'Depósito São José');
  await p.fill('#ctValor', '45,00');
  await p.fill('#ctVencimento', '2026-09-02');
  await p.click('#ctSalvar');
  await p.waitForTimeout(250);
  const fornecedoresGravados = await p.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.fornecedores.v1') || '[]'));
  checar(fornecedoresGravados.filter(f => f.nome === 'Depósito São José').length === 1,
    'o mesmo fornecedor não é recriado numa segunda conta');
  const duasContas = await p.evaluate(() => window.__beccaTeste.lerContas());
  checar(duasContas.find(c => c.descricao === 'Compra de parafusos').fornecedorId ===
    contaGravada.fornecedorId, 'as duas contas apontam para o mesmo fornecedor');

  const categoriasGravadas = await p.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.categorias.v1') || '[]'));
  checar(categoriasGravadas.length === 8, 'as 8 categorias padrão foram semeadas');
  checar(categoriasGravadas.every(c => c.tipo === 'DESPESA'),
    'todas nasceram como DESPESA (é o que a tela usa hoje)');

  checar(erros.length === 0,
    `sem erros de JavaScript ${erros.length ? '-> ' + erros.join(' | ') : ''}`);

  await ctx.close();

  // =========================================================
  console.log('\n[8] Migração dos dados antigos');
  // =========================================================
  /* um aparelho novo, com dados de ANTES desta etapa: orçamentos com
     cliNome/cliTelefone/cliEndereco soltos, sem clienteId nenhum — e
     uma conta com fornecedor/categoria só em texto */
  const ctxMig = await browser.newContext({ ...devices['iPhone 13'] });
  await ctxMig.addInitScript(() => localStorage.setItem('beccaGesso.nuvemDesligada.v1', 'true'));
  let pm = await ctxMig.newPage();
  const errosMig = [];
  pm.on('pageerror', e => errosMig.push(String(e)));
  await pm.goto(`${base}/index.html`, { waitUntil: 'networkidle' });

  const legado = {
    historico: [
      { orcNumero: '0001/2026', cliNome: 'João da Silva',
        cliTelefone: '(14) 99999-1111', cliEndereco: 'Rua A, 10',
        orcData: '2026-01-05', servicos: [{desc:'Gesso',qtd:1,valor:500,unidade:'m²'}],
        condicoes: {}, situacao: 'aprovado', atualizadoEm: Date.now() },
      { orcNumero: '0002/2026', cliNome: 'JOÃO DA SILVA',        // mesma pessoa, grafia diferente
        cliTelefone: '', cliEndereco: '',
        orcData: '2026-02-05', servicos: [{desc:'Gesso',qtd:1,valor:300,unidade:'m²'}],
        condicoes: {}, situacao: 'enviado', atualizadoEm: Date.now() },
      { orcNumero: '0003/2026', cliNome: 'Marcos Aurélio',
        cliTelefone: '14988885555', cliEndereco: 'Rua B, 20',
        orcData: '2026-03-05', servicos: [{desc:'Reboco',qtd:1,valor:700,unidade:'m²'}],
        condicoes: {}, situacao: 'rascunho', atualizadoEm: Date.now() },
    ],
    contas: [
      { id: 'legado1', descricao: 'Aluguel do galpão', fornecedor: 'Imobiliária Central',
        categoria: 'Aluguel', valor: 1500, vencimento: '2026-09-10',
        pago: false, criadoEm: Date.now(), atualizadoEm: Date.now() },
    ],
  };
  await pm.evaluate((d) => {
    localStorage.setItem('beccaGesso.historico.v1', JSON.stringify(d.historico));
    localStorage.setItem('beccaGesso.contas.v1', JSON.stringify(d.contas));
  }, legado);

  /* a migração roda ao carregar o app — recarrega para disparar */
  pm = await reabrir(ctxMig, pm, base, errosMig);

  const historicoDepois = await pm.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.historico.v1') || '[]'));
  checar(historicoDepois.every(e => !!e.id), 'todo orçamento ganhou um id técnico');
  checar(historicoDepois.every(e => !!e.clienteId), 'todo orçamento ganhou um clienteId');
  checar(historicoDepois.find(e => e.orcNumero === '0001/2026').cliNome === 'João da Silva',
    'o nome antigo continua exatamente como estava (snapshot preservado)');
  checar(historicoDepois.find(e => e.orcNumero === '0001/2026').situacao === 'aprovado',
    'a situação do orçamento antigo não foi mexida pela migração');
  checar(historicoDepois.find(e => e.orcNumero === '0002/2026').cliNome === 'JOÃO DA SILVA',
    'a segunda entrada manteve sua própria grafia (só o vínculo é compartilhado)');

  const clientesDepois = await pm.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.clientes.v1') || '[]'));
  checar(clientesDepois.length === 2,
    `dois clientes criados: João da Silva (grafias diferentes viraram um só) e Marcos Aurélio (${clientesDepois.length})`);

  const idJoao1 = historicoDepois.find(e => e.orcNumero === '0001/2026').clienteId;
  const idJoao2 = historicoDepois.find(e => e.orcNumero === '0002/2026').clienteId;
  checar(idJoao1 === idJoao2,
    '"João da Silva" e "JOÃO DA SILVA" viraram o mesmo cliente (telefone/nome bateram)');

  const contasDepois = await pm.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.contas.v1') || '[]'));
  checar(!!contasDepois[0].fornecedorId, 'a conta antiga ganhou fornecedorId');
  checar(!!contasDepois[0].categoriaId, 'a conta antiga ganhou categoriaId');
  checar(contasDepois[0].fornecedor === 'Imobiliária Central',
    'o texto do fornecedor da conta antiga não mudou');

  /* idempotência: reabrir de novo não deve recriar nem duplicar nada */
  pm = await reabrir(ctxMig, pm, base, errosMig);
  const clientesSegundaVez = await pm.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.clientes.v1') || '[]'));
  checar(clientesSegundaVez.length === 2,
    'reabrir de novo não duplica clientes (continuam 2)');
  const historicoSegundaVez = await pm.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.historico.v1') || '[]'));
  checar(historicoSegundaVez.length === 3, 'nenhum orçamento foi perdido nem duplicado');
  checar(historicoSegundaVez.find(e => e.orcNumero === '0003/2026').cliNome === 'Marcos Aurélio',
    'os dados do terceiro orçamento continuam intactos');

  const backupPre = await pm.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.backupPreMigracao.v1') || 'null'));
  checar(!!backupPre && backupPre.historico.length === 3,
    'a migração guardou um backup de antes de mexer em qualquer coisa');

  checar(errosMig.length === 0,
    `sem erros de JavaScript na migração ${errosMig.length ? '-> ' + errosMig.join(' | ') : ''}`);

  await ctxMig.close();

  // =========================================================
  console.log('\n[9] Dinheiro: soma sem perder centavo');
  // =========================================================
  const ctxDin = await browser.newContext({ ...devices['iPhone 13'] });
  await ctxDin.addInitScript(() => localStorage.setItem('beccaGesso.nuvemDesligada.v1', 'true'));
  const pd = await ctxDin.newPage();
  const errosDin = [];
  pd.on('pageerror', e => errosDin.push(String(e)));
  await pd.goto(`${base}/index.html`, { waitUntil: 'networkidle' });

  /* 0.1 + 0.2 (e primos de ponto flutuante parecidos) somados várias
     vezes em JavaScript puro derivam do valor certo; passando por
     centavos inteiros, não */
  const somaCentavos = await pd.evaluate(async () => {
    const { somar } = await import('./src/core/money.js');
    const valores = [];
    for (let i = 0; i < 37; i++) valores.push(10.1);   // 37 x R$10,10
    return somar(valores);
  });
  checar(Math.abs(somaCentavos - 373.70) < 1e-9,
    `37 parcelas de R$ 10,10 somam exatamente R$ 373,70 (deu ${somaCentavos})`);

  const semDesconto = await pd.evaluate(async () => {
    const { calcularOrcamento } = await import('./src/calculations/orcamento.js');
    return calcularOrcamento(
      [{desc:'A', qtd:3, valor:33.33}, {desc:'B', qtd:1, valor:0.34}],
      {parcelas:1, descontoPct:0, abatimento:0});
  });
  checar(Math.abs(semDesconto.subtotal - 100.33) < 1e-9,
    `3×33,33 + 0,34 = R$ 100,33 exato (deu ${semDesconto.subtotal})`);

  const comDescontoMaior = await pd.evaluate(async () => {
    const { calcularOrcamento } = await import('./src/calculations/orcamento.js');
    return calcularOrcamento(
      [{desc:'A', qtd:1, valor:50}], {abatimento: 999, parcelas:1, descontoPct:0});
  });
  checar(comDescontoMaior.total === 0, 'desconto maior que o subtotal nunca deixa o total negativo');
  checar(comDescontoMaior.abatimento === 50, 'o abatimento aplicado fica limitado ao subtotal');

  checar(errosDin.length === 0,
    `sem erros de JavaScript ${errosDin.length ? '-> ' + errosDin.join(' | ') : ''}`);
  await ctxDin.close();

  // =========================================================
  console.log('\n[10] Clientes sincronizam com a nuvem');
  // =========================================================
  const nuvem = falso.criar({ usuarios: { 'becca@exemplo.com': 'gesso2026' } });
  await new Promise(k => nuvem.servidor.listen(0, '127.0.0.1', k));
  const baseNuvem = `http://127.0.0.1:${nuvem.servidor.address().port}`;

  const ctxA = await browser.newContext({ ...devices['iPhone 13'] });
  const pa = await ctxA.newPage();
  const errosA = [];
  pa.on('pageerror', e => errosA.push(String(e)));
  pa.on('dialog', d => d.accept());
  await pa.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await pa.evaluate(([url, k]) => {
    localStorage.setItem('beccaGesso.nuvem.v1', JSON.stringify({ url, chave: k }));
  }, [baseNuvem, nuvem.chaveValida]);
  let paLogado = await reabrir(ctxA, pa, base, errosA);
  await paLogado.fill('#acUsuario', 'becca@exemplo.com');
  await paLogado.fill('#acSenha', 'gesso2026');
  await paLogado.click('#acEntrar');
  await paLogado.waitForTimeout(1400);

  await irPara(paLogado, 'clientes');
  await paLogado.click('#cliNovoBtn');
  await paLogado.waitForTimeout(150);
  await paLogado.fill('#cliFormNome', 'Cliente da Nuvem');
  await paLogado.fill('#cliFormTelefone', '14977776666');
  await paLogado.click('#cliSalvar');
  await paLogado.waitForTimeout(300);
  await paLogado.evaluate(() => window.__beccaTeste.sincronizar({}));
  await paLogado.waitForTimeout(300);

  checar(nuvem.estado.linhas.clientes.length === 1, 'o cliente subiu para a nuvem');
  checar(nuvem.estado.linhas.clientes[0].dados.nome === 'Cliente da Nuvem',
    'com o nome certo');

  /* um segundo aparelho, entrando na mesma conta, recebe o cliente */
  const ctxB = await browser.newContext({ ...devices['iPhone 13'] });
  const pb = await ctxB.newPage();
  const errosB = [];
  pb.on('pageerror', e => errosB.push(String(e)));
  pb.on('dialog', d => d.accept());
  await pb.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await pb.evaluate(([url, k]) => {
    localStorage.setItem('beccaGesso.nuvem.v1', JSON.stringify({ url, chave: k }));
  }, [baseNuvem, nuvem.chaveValida]);
  let pbLogado = await reabrir(ctxB, pb, base, errosB);
  await pbLogado.fill('#acUsuario', 'becca@exemplo.com');
  await pbLogado.fill('#acSenha', 'gesso2026');
  await pbLogado.click('#acEntrar');
  await pbLogado.waitForTimeout(1800);

  const clientesRecebidos = await pbLogado.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.clientes.v1') || '[]'));
  checar(clientesRecebidos.some(c => c.nome === 'Cliente da Nuvem'),
    'o segundo aparelho recebeu o cliente pela sincronização');

  checar(errosA.length === 0 && errosB.length === 0, 'sem erros de JavaScript na sincronização');

  await ctxA.close();
  await ctxB.close();
  await browser.close();
  srv.close();
  nuvem.servidor.close();

  console.log(`\n${falhas.length ? 'FALHAS: ' + falhas.length : 'Todos os testes passaram'}`);
  process.exit(falhas.length ? 1 : 0);
})();

/* recarrega mantendo o armazenamento — o "fechar e abrir o app" */
async function reabrir(ctx, p, baseApp, erros) {
  await p.close();
  const nova = await ctx.newPage();
  nova.on('pageerror', e => erros.push(String(e)));
  nova.on('dialog', d => d.accept());
  await nova.goto(`${baseApp}/index.html`, { waitUntil: 'networkidle' });
  await nova.waitForTimeout(400);
  return nova;
}
