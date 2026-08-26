/* Testa a Etapa 3.3 (Becca OS): a integração operacional entre
   Orçamento e Oportunidade — criar orçamento a partir do Comercial,
   abrir um orçamento vinculado, voltar, bloqueio de cliente, aprovação
   sem cascata, snapshot intacto e o evento único de orcamento_criado /
   orcamento_compartilhado. Tudo pela tela de verdade.

   Itens A-J da aprovação da Etapa 3.3, nesta ordem. */
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

async function irPara(p, secao) {
  await p.click(`.secao-btn[data-secao="${secao}"]`);
  await p.waitForTimeout(250);
}

function lerHistorico(p) {
  return p.evaluate(() => window.__beccaTeste.lerHistorico());
}

function lerClientesLS(p) {
  return p.evaluate(() => JSON.parse(localStorage.getItem('beccaGesso.clientes.v1') || '[]'));
}

async function criarCliente(p, nome, extras) {
  await irPara(p, 'clientes');
  await p.click('#cliNovoBtn');
  await p.waitForTimeout(150);
  await p.fill('#cliFormNome', nome);
  if (extras && extras.telefone) await p.fill('#cliFormTelefone', extras.telefone);
  if (extras && extras.endereco) await p.fill('#cliFormEndereco', extras.endereco);
  await p.click('#cliSalvar');
  await p.waitForTimeout(250);
  return (await lerClientesLS(p)).find(c => c.nome === nome);
}

async function criarOportunidade(p, clienteNome, titulo) {
  await irPara(p, 'comercial');
  await p.click('#opoNovoBtn');
  await p.waitForTimeout(150);
  await p.selectOption('#opoFormCliente', { label: clienteNome });
  await p.fill('#opoFormTitulo', titulo);
  await p.click('#opoSalvar');
  await p.waitForTimeout(300);
}

async function abrirOportunidadeNaLista(p, titulo) {
  await p.locator('.oportunidade-item').filter({ hasText: titulo }).locator('.opo-abrir').click();
  await p.waitForTimeout(200);
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
  // evita popup/download de verdade quando os testes de compartilhamento clicarem em "Enviar pelo WhatsApp"
  await p.evaluate(() => {
    window.__aberto = [];
    window.open = (url) => { window.__aberto.push(url); return null; };
  });

  // =========================================================
  console.log('\n[A] Novo orçamento a partir da oportunidade');
  // =========================================================
  await criarCliente(p, 'Joao Integracao', { telefone: '(14) 90001-0001', endereco: 'Rua A, 1' });
  await criarOportunidade(p, 'Joao Integracao', 'Forro A');
  await abrirOportunidadeNaLista(p, 'Forro A');

  checar(await p.locator('#opoNovoOrcamentoBtn').isVisible(), 'painel de detalhe tem "+ Novo orçamento"');
  await p.click('#opoNovoOrcamentoBtn');
  await p.waitForTimeout(300);

  checar(await p.locator('#secaoOrcamentos').isVisible(), '"+ Novo orçamento" leva para a seção Orçamentos');
  checar((await p.inputValue('#cliNome')) === 'Joao Integracao', 'cliente já vem pré-selecionado');
  checar(await p.locator('#opoContextoOrcamento').isVisible(), 'a faixa de contexto da oportunidade aparece');
  checar((await p.locator('#opoContextoTexto').textContent()).includes('Forro A'),
    'a faixa mostra o título certo da oportunidade');

  await p.fill('.s-desc', 'Forro de gesso');
  await p.fill('.s-qtd', '10');
  await p.fill('.s-valor', '100,00');
  await p.waitForTimeout(600);
  const numeroA = await p.inputValue('#orcNumero');

  const historicoA = await lerHistorico(p);
  const entradaA = historicoA.find(e => e.orcNumero === numeroA);
  const joao = (await lerClientesLS(p)).find(c => c.nome === 'Joao Integracao');
  checar(entradaA.clienteId === joao.id, 'clienteId gravado é o de João');
  const oportForroA = await p.evaluate(async () => {
    const opo = await import('./src/domain/oportunidades.js');
    return opo.lerOportunidades().find(o => o.titulo === 'Forro A');
  });
  checar(entradaA.oportunidadeId === oportForroA.id, 'oportunidadeId gravado é o da oportunidade "Forro A"');

  // =========================================================
  console.log('\n[B] Orçamento normal (fluxo tradicional) continua sem oportunidade');
  // =========================================================
  await irPara(p, 'orcamentos');
  await p.click('#resetBtn');
  await p.waitForTimeout(300);
  checar(await p.locator('#opoContextoOrcamento').isHidden(), 'sem faixa de contexto no fluxo direto');
  checar(!(await p.isDisabled('#cliNome')), 'campo de cliente não está travado no fluxo direto');

  await p.fill('#cliNome', 'Cliente Direto Integracao');
  await p.fill('.s-desc', 'Sanca');
  await p.fill('.s-qtd', '2');
  await p.fill('.s-valor', '80,00');
  await p.waitForTimeout(600);
  const numeroB = await p.inputValue('#orcNumero');
  const entradaB = (await lerHistorico(p)).find(e => e.orcNumero === numeroB);
  checar(!entradaB.oportunidadeId, 'orçamento direto continua com oportunidadeId nulo/ausente');

  // =========================================================
  console.log('\n[C] Duas revisões (dois orçamentos) na mesma oportunidade');
  // =========================================================
  await irPara(p, 'comercial');
  await abrirOportunidadeNaLista(p, 'Forro A');
  await p.click('#opoNovoOrcamentoBtn');
  await p.waitForTimeout(300);
  await p.fill('.s-desc', 'Revisão 2');
  await p.fill('.s-qtd', '1');
  await p.fill('.s-valor', '2.000,00');
  await p.waitForTimeout(600);
  const numeroC = await p.inputValue('#orcNumero');

  checar(numeroC !== numeroA, 'a segunda revisão tem um número diferente da primeira');
  const historicoC = await lerHistorico(p);
  const entradaC = historicoC.find(e => e.orcNumero === numeroC);
  const entradaA2 = historicoC.find(e => e.orcNumero === numeroA);
  checar(entradaC.oportunidadeId === entradaA2.oportunidadeId, 'as duas revisões apontam para a mesma oportunidade');
  checar(entradaC.total !== entradaA2.total, 'os totais continuam diferentes e independentes');

  // =========================================================
  console.log('\n[D] Abrir orçamento vinculado a partir da oportunidade');
  // =========================================================
  await p.click('#voltarOportunidadeBtn');
  await p.waitForTimeout(250);
  checar(await p.locator('#secaoComercial').isVisible(), '"Voltar" leva de volta para o Comercial');
  checar((await p.locator('#opoDetTitulo').textContent()) === 'Forro A', 'reabre a mesma oportunidade (Forro A)');

  await p.locator('.opo-orc-item').filter({ hasText: numeroA }).click();
  await p.waitForTimeout(300);
  checar(await p.locator('#secaoOrcamentos').isVisible(), 'clicar no vínculo abre a seção Orçamentos');
  checar((await p.inputValue('#orcNumero')) === numeroA, `abriu exatamente o orçamento ${numeroA}`);
  checar((await p.inputValue('#cliNome')) === 'Joao Integracao', 'com os dados certos do cliente');

  // =========================================================
  console.log('\n[E] Voltar para a oportunidade');
  // =========================================================
  await p.click('#voltarOportunidadeBtn');
  await p.waitForTimeout(250);
  checar(await p.locator('#painelOportunidadeDetalhe').isVisible(), 'o painel de detalhe reabre');
  checar((await p.locator('#opoDetTitulo').textContent()) === 'Forro A', 'com a mesma oportunidade de antes (Forro A)');
  const vinculoTexto = await p.locator('#opoDetVinculo').textContent();
  checar(vinculoTexto.includes(numeroA) && vinculoTexto.includes(numeroC),
    'e a lista de orçamentos vinculados mostra as duas revisões');

  // =========================================================
  console.log('\n[F] Cliente do orçamento vinculado fica bloqueado');
  // =========================================================
  await p.locator('.opo-orc-item').filter({ hasText: numeroA }).click();
  await p.waitForTimeout(300);
  checar(await p.isDisabled('#cliNome'), 'campo de cliente desabilitado quando o orçamento tem oportunidadeId');
  checar(await p.locator('#cliBloqueioAviso').isVisible(), 'aviso explicando o bloqueio aparece');
  // telefone/endereço (snapshot) continuam editáveis normalmente
  await p.fill('#cliTelefone', '(14) 90009-9999');
  await p.waitForTimeout(600);
  const entradaFDepois = (await lerHistorico(p)).find(e => e.orcNumero === numeroA);
  checar(entradaFDepois.clienteId === joao.id, 'o clienteId não mudou (campo travado)');
  checar(entradaFDepois.cliTelefone === '(14) 90009-9999', 'mas o telefone (snapshot) continua editável');

  // =========================================================
  console.log('\n[G] Aprovação sem cascata (mesma ponte da Etapa 3.1)');
  // =========================================================
  await p.click('#histBtn');
  await p.waitForTimeout(200);
  await p.locator('.hist-item').filter({ hasText: numeroA }).locator('.hist-sit').selectOption('aprovado');
  await p.waitForTimeout(300);
  await p.click('#histFechar');
  await p.waitForTimeout(150);

  const oportForroADepois = await p.evaluate(async id => {
    const opo = await import('./src/domain/oportunidades.js');
    return opo.buscarPorId(id);
  }, oportForroA.id);
  checar(oportForroADepois.status === 'aprovada', 'a oportunidade "Forro A" foi aprovada');
  const listaAprovacao = await lerHistorico(p);
  checar(listaAprovacao.find(e => e.orcNumero === numeroA).situacao === 'aprovado', 'o orçamento A ficou aprovado');
  checar(listaAprovacao.find(e => e.orcNumero === numeroC).situacao !== 'aprovado',
    'a segunda revisão (irmã) não foi alterada automaticamente — nenhuma cascata');

  // =========================================================
  console.log('\n[H] Snapshot continua intacto ao editar o cliente');
  // =========================================================
  const entradaAntesEdicao = listaAprovacao.find(e => e.orcNumero === numeroA);
  await irPara(p, 'clientes');
  await p.click('.cliente-item:has-text("Joao Integracao") .cli-abrir');
  await p.waitForTimeout(200);
  await p.fill('#cliFormEndereco', 'Rua Nova Depois Da Edicao, 999');
  await p.click('#cliSalvar');
  await p.waitForTimeout(250);

  const entradaDepoisEdicao = (await lerHistorico(p)).find(e => e.orcNumero === numeroA);
  checar(entradaDepoisEdicao.cliEndereco === entradaAntesEdicao.cliEndereco,
    'o snapshot do orçamento (endereço) não mudou com a edição do cliente');
  const oportForroAAposEdicao = await p.evaluate(async id => {
    const opo = await import('./src/domain/oportunidades.js');
    return opo.buscarPorId(id);
  }, oportForroA.id);
  checar(oportForroAAposEdicao.clienteId === joao.id, 'a oportunidade continua apontando para o mesmo clienteId');

  // =========================================================
  console.log('\n[I] Evento orcamento_criado exatamente uma vez');
  // =========================================================
  const eventosForroA = await p.evaluate(async id => {
    const ativ = await import('./src/domain/atividadesComerciais.js');
    return ativ.listarPorOportunidade(id);
  }, oportForroA.id);
  const criadosA = eventosForroA.filter(ev => ev.tipo === 'orcamento_criado' && ev.dados && ev.dados.numero === numeroA);
  checar(criadosA.length === 1, `exatamente 1 evento orcamento_criado para o orçamento ${numeroA} (tinha ${criadosA.length})`);
  checar(criadosA[0].dados.valor === entradaA.total, 'o evento guarda o valor certo');

  const criadosC = eventosForroA.filter(ev => ev.tipo === 'orcamento_criado' && ev.dados && ev.dados.numero === numeroC);
  checar(criadosC.length === 1, 'a segunda revisão também gerou exatamente 1 evento orcamento_criado (não 0, não 2)');

  // orcamento_compartilhado: aciona o fluxo real de "Enviar pelo WhatsApp"
  await irPara(p, 'orcamentos');
  await p.click('#histBtn');
  await p.waitForTimeout(200);
  await p.locator('.hist-item').filter({ hasText: numeroC }).locator('.hist-abrir').click();
  await p.waitForTimeout(300);
  await p.evaluate(() => { navigator.canShare = undefined; }); // força o "plano B" (mesmo comportamento fora do iPhone)
  await p.click('#zapBtn');
  await p.waitForTimeout(500);

  const eventosAposCompartilhar = await p.evaluate(async id => {
    const ativ = await import('./src/domain/atividadesComerciais.js');
    return ativ.listarPorOportunidade(id);
  }, oportForroA.id);
  const compartilhados = eventosAposCompartilhar.filter(ev =>
    ev.tipo === 'orcamento_compartilhado' && ev.dados && ev.dados.numero === numeroC);
  checar(compartilhados.length === 1, 'exatamente 1 evento orcamento_compartilhado para a revisão compartilhada');
  checar(compartilhados[0].texto.includes('compartilhado') && !compartilhados[0].texto.toLowerCase().includes('recebeu'),
    'o texto diz "compartilhado", nunca "cliente recebeu"');

  // compartilhar nao gera um segundo orcamento_criado
  const criadosCDepoisDeCompartilhar = eventosAposCompartilhar.filter(ev =>
    ev.tipo === 'orcamento_criado' && ev.dados && ev.dados.numero === numeroC);
  checar(criadosCDepoisDeCompartilhar.length === 1, 'compartilhar não duplica o evento orcamento_criado');

  checar(erros.length === 0, `sem erros de JavaScript ${erros.length ? '-> ' + erros.join(' | ') : ''}`);

  // =========================================================
  console.log('\n[J] Regressão geral desta suíte');
  // =========================================================
  console.log('  (as demais suítes rodam à parte, na mesma bateria)');

  await ctx.close();
  await browser.close();
  srv.close();

  console.log(`\n${falhas.length ? 'FALHAS: ' + falhas.length : 'Todos os testes passaram'}`);
  process.exit(falhas.length ? 1 : 0);
})();
