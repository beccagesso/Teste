/* Testa a Etapa 3.1 (Becca OS): a fundação de domínio do módulo
   Comercial — Oportunidade, AtividadeComercial, OrigemLead,
   MotivoPerda — e o vínculo opcional `oportunidadeId` no Orçamento.

   Sem tela ainda: a maior parte destes testes chama o domínio
   diretamente por `import()` dinâmico dentro do navegador (o mesmo
   truque que testar-clientes.js já usa para `core/money.js` e
   `calculations/orcamento.js`), sem precisar de `window.__beccaTeste`.
   Só os pontos que realmente passam pela UI existente (criar cliente e
   orçamento, aprovar pelo seletor de situação, sincronizar) usam a
   tela e o `window.__beccaTeste` já expostos. */
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

/* carrega os módulos de domínio uma vez e guarda em window.__com, para
   não repetir o import() em cada chamada — só usado pelos testes, o
   app nunca lê window.__com */
async function carregarDominio(p) {
  await p.evaluate(async () => {
    window.__com = {
      opo: await import('./src/domain/oportunidades.js'),
      ativ: await import('./src/domain/atividadesComerciais.js'),
      org: await import('./src/domain/origens.js'),
      mot: await import('./src/domain/motivosPerda.js'),
      domain: await import('./src/domain/index.js'),
    };
  });
}

function lerClientesLS(p) {
  return p.evaluate(() => JSON.parse(localStorage.getItem('beccaGesso.clientes.v1') || '[]'));
}

(async () => {
  const srv = await servidor();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();

  // =========================================================
  console.log('\n[1] Criação de Oportunidade');
  // =========================================================
  const ctx1 = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx1.addInitScript(() => localStorage.setItem('beccaGesso.nuvemDesligada.v1', 'true'));
  const p1 = await ctx1.newPage();
  const erros1 = [];
  p1.on('pageerror', e => erros1.push(String(e)));
  await p1.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await carregarDominio(p1);

  // um cliente de verdade pela tela, para a oportunidade apontar para um clienteId real
  await irPara(p1, 'clientes');
  await p1.click('#cliNovoBtn');
  await p1.waitForTimeout(150);
  await p1.fill('#cliFormNome', 'João da Obra');
  await p1.fill('#cliFormTelefone', '14 99888-7766');
  await p1.click('#cliSalvar');
  await p1.waitForTimeout(250);
  const clienteJoao = (await lerClientesLS(p1))[0];

  const semTitulo = await p1.evaluate(clienteId =>
    window.__com.opo.criar({ clienteId, titulo: '' }), clienteJoao.id);
  checar(semTitulo === null, 'criar() sem título devolve null (não cria)');

  const semCliente = await p1.evaluate(() =>
    window.__com.opo.criar({ titulo: 'Forro sem cliente' }));
  checar(semCliente === null, 'criar() sem clienteId devolve null (não cria)');

  const antesCriar = Date.now();
  const oA = await p1.evaluate(clienteId =>
    window.__com.opo.criar({ clienteId, titulo: 'Forro residência' }), clienteJoao.id);
  checar(!!oA && !!oA.id, 'oportunidade criada recebe um id');
  checar(oA.criadoEm >= antesCriar && oA.atualizadoEm === oA.criadoEm, 'recebe timestamps coerentes');
  checar(oA.status === 'novo', 'começa com status "novo"');
  checar(oA.clienteId === clienteJoao.id, 'fica vinculada ao cliente certo');
  checar(oA.ativo === true, 'nasce ativa');
  checar(oA.motivoPerdaId === null && oA.valorEstimado === 0, 'campos opcionais começam neutros');

  // =========================================================
  console.log('\n[2] Atualização de campos');
  // =========================================================
  await p1.evaluate(id => window.__com.opo.atualizar(id, { titulo: 'Forro + sanca residência' }), oA.id);
  await p1.evaluate(id => window.__com.opo.atualizar(id, { valorEstimado: 4500 }), oA.id);
  await p1.evaluate(id => window.__com.opo.atualizar(id, { origemId: 'org_teste', origemDetalhe: 'indicou a vizinha' }), oA.id);
  await p1.evaluate(id => window.__com.opo.atualizar(id, { responsavel: 'Becca' }), oA.id);
  await p1.evaluate(id => window.__com.opo.atualizar(id, { proximoContatoEm: '2026-09-01' }), oA.id);
  const oAtualizada = await p1.evaluate(id => window.__com.opo.buscarPorId(id), oA.id);
  checar(oAtualizada.titulo === 'Forro + sanca residência', 'atualiza título');
  checar(oAtualizada.valorEstimado === 4500, 'atualiza valorEstimado');
  checar(oAtualizada.origemId === 'org_teste' && oAtualizada.origemDetalhe === 'indicou a vizinha', 'atualiza origem');
  checar(oAtualizada.responsavel === 'Becca', 'atualiza responsável');
  checar(oAtualizada.proximoContatoEm === '2026-09-01', 'atualiza próximo contato');

  const tituloVazio = await p1.evaluate(id => window.__com.opo.atualizar(id, { titulo: '  ' }), oA.id);
  checar(tituloVazio === null, 'atualizar() para título vazio também devolve null (não esvazia)');

  // =========================================================
  console.log('\n[3] Transições de status (as 6 do funil)');
  // =========================================================
  const transicoes = [
    ['novo', 'contato'], ['contato', 'visita'], ['visita', 'orcamento'],
    ['orcamento', 'negociacao'],
  ];
  for (const [de, para] of transicoes) {
    const atual = await p1.evaluate(id => window.__com.opo.buscarPorId(id), oA.id);
    checar(atual.status === de, `estava em "${de}" antes de mudar para "${para}"`);
    const depois = await p1.evaluate(([id, s]) => window.__com.opo.alterarStatus(id, s), [oA.id, para]);
    checar(depois && depois.status === para, `${de} -> ${para}`);
  }

  const statusInvalido = await p1.evaluate(id => window.__com.opo.alterarStatus(id, 'fechado'), oA.id);
  checar(statusInvalido === null, 'status inválido (fora da lista) é rejeitado');

  const oportunidadeInexistente = await p1.evaluate(() => window.__com.opo.alterarStatus('opo_nao_existe', 'contato'));
  checar(oportunidadeInexistente === null, 'oportunidade inexistente é rejeitada');

  const atividadesAntesMesmoStatus = await p1.evaluate(id => window.__com.ativ.listarPorOportunidade(id), oA.id);
  const mesmoStatus = await p1.evaluate(id => window.__com.opo.alterarStatus(id, 'negociacao'), oA.id);
  const atividadesDepoisMesmoStatus = await p1.evaluate(id => window.__com.ativ.listarPorOportunidade(id), oA.id);
  checar(!!mesmoStatus, 'alterar para o mesmo status atual continua ok (não rejeita)');
  checar(atividadesDepoisMesmoStatus.length === atividadesAntesMesmoStatus.length,
    'mas não cria um novo evento de mudança de status quando nada mudou');

  // =========================================================
  console.log('\n[4] Eventos automáticos e histórico');
  // =========================================================
  const eventosA = await p1.evaluate(id => window.__com.ativ.listarPorOportunidade(id), oA.id);
  checar(eventosA.some(e => e.tipo === 'oportunidade_criada'),
    'a criação gerou 1 evento "oportunidade_criada"');
  checar(eventosA.filter(e => e.tipo === 'oportunidade_criada').length === 1,
    'e só 1 (não duplica a cada leitura)');

  const mudancas = eventosA.filter(e => e.tipo === 'mudanca_status');
  checar(mudancas.length === 4, `4 mudanças de status geraram 4 eventos (tinha ${mudancas.length})`);
  const ultimaMudanca = mudancas[0]; // lista vem mais nova primeiro
  checar(ultimaMudanca.dados && ultimaMudanca.dados.de === 'orcamento' && ultimaMudanca.dados.para === 'negociacao',
    'o evento mais recente guarda {de,para} estruturado, não só texto');
  checar(typeof ultimaMudanca.texto === 'string' && ultimaMudanca.texto.length > 0,
    'e também um texto legível');
  checar(mudancas.every(e => e.automatica === true), 'eventos automáticos ficam marcados como automatica:true');

  // histórico anterior não é reescrito quando um evento novo entra
  const primeiraMudanca = mudancas[mudancas.length - 1];
  checar(primeiraMudanca.dados.de === 'novo' && primeiraMudanca.dados.para === 'contato',
    'o primeiro evento da sequência continua intacto (novo -> contato)');

  // =========================================================
  console.log('\n[5] Perda exige motivo');
  // =========================================================
  const semMotivo = await p1.evaluate(id => window.__com.opo.alterarStatus(id, 'perdida'), oA.id);
  checar(semMotivo === null, 'perdida sem motivoPerdaId é rejeitada (não muda nada)');
  const aindaNegociacao = await p1.evaluate(id => window.__com.opo.buscarPorId(id), oA.id);
  checar(aindaNegociacao.status === 'negociacao', 'e o status realmente não mudou');

  const comMotivo = await p1.evaluate(id => window.__com.opo.alterarStatus(id, 'perdida',
    { motivoPerdaId: 'mot_preco', motivoPerdaDetalhe: 'achou caro' }), oA.id);
  checar(comMotivo.status === 'perdida', 'perdida com motivo é aceita');
  checar(comMotivo.motivoPerdaId === 'mot_preco' && comMotivo.motivoPerdaDetalhe === 'achou caro',
    'motivo e detalhe ficam persistidos');

  // =========================================================
  console.log('\n[6] Desativação e reativação');
  // =========================================================
  const desativada = await p1.evaluate(id => window.__com.opo.desativar(id), oA.id);
  checar(desativada.ativo === false, 'desativar() marca ativo:false');
  checar((await p1.evaluate(id => window.__com.opo.listar().some(o => o.id === id)), oA.id) !== undefined,
    'listar() é só um checkpoint de sanidade (ver próxima linha)');
  const listaAtivos = await p1.evaluate(() => window.__com.opo.listar());
  checar(!listaAtivos.some(o => o.id === oA.id), 'oportunidade desativada some de listar()');
  checar(!!(await p1.evaluate(id => window.__com.opo.buscarPorId(id), oA.id)),
    'mas continua existindo (desativar não é excluir)');
  const clientesIntactos = await lerClientesLS(p1);
  checar(clientesIntactos.some(c => c.id === clienteJoao.id), 'o cliente continua intacto');

  const reativada = await p1.evaluate(id => window.__com.opo.reativar(id), oA.id);
  checar(reativada.ativo === true, 'reativar() volta ativo:true');

  checar(erros1.length === 0, `sem erros de JavaScript ${erros1.length ? '-> ' + erros1.join(' | ') : ''}`);
  await ctx1.close();

  // =========================================================
  console.log('\n[7] Origens e motivos de perda: seeds e idempotência');
  // =========================================================
  const ctx2 = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx2.addInitScript(() => localStorage.setItem('beccaGesso.nuvemDesligada.v1', 'true'));
  const p2 = await ctx2.newPage();
  const erros2 = [];
  p2.on('pageerror', e => erros2.push(String(e)));
  await p2.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await carregarDominio(p2);

  const origens1 = await p2.evaluate(() => window.__com.org.lerOrigens());
  checar(origens1.length === 9, `as 9 origens padrão foram semeadas (tinha ${origens1.length})`);
  checar(origens1.some(o => o.nome === 'Indicação') && origens1.some(o => o.nome === 'Outro'),
    'com os nomes certos (ex.: Indicação, Outro)');

  const motivos1 = await p2.evaluate(() => window.__com.mot.lerMotivosPerda());
  checar(motivos1.length === 8, `os 8 motivos de perda padrão foram semeados (tinha ${motivos1.length})`);
  checar(motivos1.some(m => m.nome === 'Preço') && motivos1.some(m => m.nome === 'Sem retorno'),
    'com os nomes certos (ex.: Preço, Sem retorno)');

  // rodar de novo (equivalente a abrir o app outra vez) não duplica nada
  await p2.evaluate(() => { window.__com.org.semearPadrao(); window.__com.mot.semearPadrao(); });
  const origens2 = await p2.evaluate(() => window.__com.org.lerOrigens());
  const motivos2 = await p2.evaluate(() => window.__com.mot.lerMotivosPerda());
  checar(origens2.length === 9, 'semearPadrao() de novo não duplica origens');
  checar(motivos2.length === 8, 'semearPadrao() de novo não duplica motivos de perda');

  checar(erros2.length === 0, `sem erros de JavaScript ${erros2.length ? '-> ' + erros2.join(' | ') : ''}`);
  await ctx2.close();

  // =========================================================
  console.log('\n[8] Limite de atividades: 300 por oportunidade, não global');
  // =========================================================
  const ctx3 = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx3.addInitScript(() => localStorage.setItem('beccaGesso.nuvemDesligada.v1', 'true'));
  const p3 = await ctx3.newPage();
  const erros3 = [];
  p3.on('pageerror', e => erros3.push(String(e)));
  await p3.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await carregarDominio(p3);

  const resultadoLimite = await p3.evaluate(() => {
    const opo = window.__com.opo, ativ = window.__com.ativ;
    const grande = opo.criar({ clienteId: 'cli_x', titulo: 'Oportunidade grande' });
    const pequena = opo.criar({ clienteId: 'cli_x', titulo: 'Oportunidade pequena' });
    for (let i = 0; i < 400; i++) {
      ativ.criar({ oportunidadeId: grande.id, tipo: 'observacao', texto: `nota ${i}`, automatica: false });
    }
    ativ.criar({ oportunidadeId: pequena.id, tipo: 'observacao', texto: 'única nota', automatica: false });
    return {
      grandeId: grande.id,
      pequenaId: pequena.id,
      totalGrande: ativ.listarPorOportunidade(grande.id).length,
      totalPequena: ativ.listarPorOportunidade(pequena.id).length,
      maisRecenteGuardada: ativ.listarPorOportunidade(grande.id).some(a => a.texto === 'nota 399'),
      maisAntigaSumiu: !ativ.listarPorOportunidade(grande.id).some(a => a.texto === 'nota 0'),
    };
  });
  checar(resultadoLimite.totalGrande === 300, `a oportunidade com 400+ eventos fica com só 300 (tinha ${resultadoLimite.totalGrande})`);
  checar(resultadoLimite.maisRecenteGuardada, 'a atividade mais recente é preservada');
  checar(resultadoLimite.maisAntigaSumiu, 'a mais antiga é a que sai quando estoura o limite');
  checar(resultadoLimite.totalPequena === 2,
    'a outra oportunidade continua com suas 2 atividades (oportunidade_criada + a nota) — ' +
    'o corte da primeira não a afetou');

  checar(erros3.length === 0, `sem erros de JavaScript ${erros3.length ? '-> ' + erros3.join(' | ') : ''}`);
  await ctx3.close();

  // =========================================================
  console.log('\n[9] Teste crítico: Cliente -> 2 Oportunidades -> 2 Orçamentos');
  // =========================================================
  const ctx4 = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx4.addInitScript(() => localStorage.setItem('beccaGesso.nuvemDesligada.v1', 'true'));
  const p4 = await ctx4.newPage();
  const erros4 = [];
  p4.on('pageerror', e => erros4.push(String(e)));
  await p4.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await carregarDominio(p4);

  await irPara(p4, 'clientes');
  await p4.click('#cliNovoBtn');
  await p4.waitForTimeout(150);
  await p4.fill('#cliFormNome', 'João Crítico');
  await p4.click('#cliSalvar');
  await p4.waitForTimeout(250);
  const joaoCritico = (await lerClientesLS(p4)).find(c => c.nome === 'João Crítico');

  // Orçamento 001, para a Oportunidade A
  await irPara(p4, 'orcamentos');
  await p4.click('#resetBtn');
  await p4.waitForTimeout(300);
  await p4.fill('#cliNome', 'João Crítico');
  await p4.waitForTimeout(250);
  await p4.click('.cli-busca-item[data-id]');
  await p4.waitForTimeout(200);
  await p4.fill('.s-desc', 'Forro');
  await p4.fill('.s-qtd', '1');
  await p4.fill('.s-valor', '1000,00');
  await p4.waitForTimeout(600);
  const numero001 = await p4.inputValue('#orcNumero');

  // Orçamento 002, para a Oportunidade B
  await p4.click('#resetBtn');
  await p4.waitForTimeout(300);
  await p4.fill('#cliNome', 'João Crítico');
  await p4.waitForTimeout(250);
  await p4.click('.cli-busca-item[data-id]');
  await p4.waitForTimeout(200);
  await p4.fill('.s-desc', 'Drywall');
  await p4.fill('.s-qtd', '1');
  await p4.fill('.s-valor', '2000,00');
  await p4.waitForTimeout(600);
  const numero002 = await p4.inputValue('#orcNumero');
  checar(numero001 !== numero002, 'os dois orçamentos têm números diferentes');

  // duas oportunidades reais para o mesmo cliente, cada uma com seu orçamento vinculado
  const critico = await p4.evaluate(async ({ clienteId, num1, num2 }) => {
    const opo = window.__com.opo;
    const oA = opo.criar({ clienteId, titulo: 'Forro residência' });
    const oB = opo.criar({ clienteId, titulo: 'Drywall comercial' });

    const orc = await import('./src/domain/orcamentos.js');
    const lista = orc.lerHistorico();
    const e1 = lista.find(x => x.orcNumero === num1);
    const e2 = lista.find(x => x.orcNumero === num2);
    e1.oportunidadeId = oA.id;
    e2.oportunidadeId = oB.id;
    orc.gravarHistorico(lista);

    return { oAId: oA.id, oBId: oB.id };
  }, { clienteId: joaoCritico.id, num1: numero001, num2: numero002 });

  const listaFinal = await p4.evaluate(() => window.__beccaTeste.lerHistorico());
  const e1Final = listaFinal.find(x => x.orcNumero === numero001);
  const e2Final = listaFinal.find(x => x.orcNumero === numero002);
  checar(e1Final.clienteId === joaoCritico.id && e2Final.clienteId === joaoCritico.id,
    'clienteId(001) === clienteId(002) === João');
  checar(e1Final.oportunidadeId !== e2Final.oportunidadeId,
    'oportunidadeId(001) !== oportunidadeId(002) — cada orçamento aponta para a oportunidade certa');
  checar(e1Final.oportunidadeId === critico.oAId && e2Final.oportunidadeId === critico.oBId,
    'e são exatamente as duas oportunidades certas, não trocadas');

  checar(erros4.length === 0, `sem erros de JavaScript ${erros4.length ? '-> ' + erros4.join(' | ') : ''}`);
  await ctx4.close();

  // =========================================================
  console.log('\n[10] Orçamento sem oportunidade continua funcionando como hoje');
  // =========================================================
  const ctx5 = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx5.addInitScript(() => localStorage.setItem('beccaGesso.nuvemDesligada.v1', 'true'));
  const p5 = await ctx5.newPage();
  const erros5 = [];
  p5.on('pageerror', e => erros5.push(String(e)));
  await p5.goto(`${base}/index.html`, { waitUntil: 'networkidle' });

  await irPara(p5, 'orcamentos');
  await p5.click('#resetBtn');
  await p5.waitForTimeout(300);
  await p5.fill('#cliNome', 'Cliente Solto');
  await p5.fill('.s-desc', 'Sanca');
  await p5.fill('.s-qtd', '5');
  await p5.fill('.s-valor', '50,00');
  await p5.waitForTimeout(600);
  const numeroSolto = await p5.inputValue('#orcNumero');

  const entradaSolta = await p5.evaluate(num =>
    window.__beccaTeste.lerHistorico().find(e => e.orcNumero === num), numeroSolto);
  checar(!entradaSolta.oportunidadeId, 'orçamento criado pelo fluxo atual tem oportunidadeId nulo/ausente');
  checar(entradaSolta.cliNome === 'Cliente Solto', 'o orçamento salvou normalmente (cliNome)');
  checar(entradaSolta.total === 250, `o cálculo continua correto (total ${entradaSolta.total})`);

  const dadosPdfSolto = await p5.evaluate(() => window.__beccaTeste.dadosParaPdf());
  checar(dadosPdfSolto.cliNome === 'Cliente Solto', 'o PDF usa os dados certos mesmo sem oportunidade');

  // reabre e confere que continua igual
  const p5R = await reabrir(ctx5, p5, base, erros5);
  await irPara(p5R, 'orcamentos');
  await p5R.click('#histBtn');
  await p5R.waitForTimeout(200);
  await p5R.locator('.hist-item').filter({ hasText: numeroSolto }).locator('.hist-abrir').click();
  await p5R.waitForTimeout(300);
  checar((await p5R.inputValue('#cliNome')) === 'Cliente Solto', 'reaberto: os dados continuam os mesmos');

  checar(erros5.length === 0, `sem erros de JavaScript ${erros5.length ? '-> ' + erros5.join(' | ') : ''}`);
  await ctx5.close();

  // =========================================================
  console.log('\n[11] Snapshot sobrevive à edição do cliente mesmo com oportunidade vinculada');
  // =========================================================
  const ctx6 = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx6.addInitScript(() => localStorage.setItem('beccaGesso.nuvemDesligada.v1', 'true'));
  const p6 = await ctx6.newPage();
  const erros6 = [];
  p6.on('pageerror', e => erros6.push(String(e)));
  await p6.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await carregarDominio(p6);

  await irPara(p6, 'clientes');
  await p6.click('#cliNovoBtn');
  await p6.waitForTimeout(150);
  await p6.fill('#cliFormNome', 'Maria Snapshot');
  await p6.fill('#cliFormTelefone', '7777');
  await p6.fill('#cliFormEndereco', 'Rua Antiga');
  await p6.click('#cliSalvar');
  await p6.waitForTimeout(250);
  const mariaId = (await lerClientesLS(p6)).find(c => c.nome === 'Maria Snapshot').id;

  await irPara(p6, 'orcamentos');
  await p6.click('#resetBtn');
  await p6.waitForTimeout(300);
  await p6.fill('#cliNome', 'Maria Snapshot');
  await p6.waitForTimeout(250);
  await p6.click('.cli-busca-item[data-id]');
  await p6.waitForTimeout(200);
  await p6.fill('.s-desc', 'Gesso');
  await p6.fill('.s-qtd', '1');
  await p6.fill('.s-valor', '900,00');
  await p6.waitForTimeout(600);
  const numeroMaria = await p6.inputValue('#orcNumero');

  // vincula a uma oportunidade real
  await p6.evaluate(({ clienteId, numero }) => {
    const oport = window.__com.opo.criar({ clienteId, titulo: 'Reforma Maria' });
    const lista = window.__beccaTeste.lerHistorico();
    lista.find(e => e.orcNumero === numero).oportunidadeId = oport.id;
    window.__beccaTeste.gravarHistorico(lista);
  }, { clienteId: mariaId, numero: numeroMaria });

  // edita o cadastro do cliente
  await irPara(p6, 'clientes');
  await p6.click('.cliente-item:has-text("Maria Snapshot") .cli-abrir');
  await p6.waitForTimeout(200);
  await p6.fill('#cliFormEndereco', 'Rua Nova');
  await p6.click('#cliSalvar');
  await p6.waitForTimeout(250);

  const entradaMaria = await p6.evaluate(num =>
    window.__beccaTeste.lerHistorico().find(e => e.orcNumero === num), numeroMaria);
  checar(entradaMaria.cliEndereco === 'Rua Antiga',
    'o snapshot do orçamento continua "Rua Antiga", mesmo tendo uma oportunidade vinculada');
  checar(!!entradaMaria.oportunidadeId, 'e o vínculo com a oportunidade continua lá');

  checar(erros6.length === 0, `sem erros de JavaScript ${erros6.length ? '-> ' + erros6.join(' | ') : ''}`);
  await ctx6.close();

  // =========================================================
  console.log('\n[12] Duas revisões (2 orçamentos) para a mesma oportunidade');
  // =========================================================
  const ctx7 = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx7.addInitScript(() => localStorage.setItem('beccaGesso.nuvemDesligada.v1', 'true'));
  const p7 = await ctx7.newPage();
  const erros7 = [];
  p7.on('pageerror', e => erros7.push(String(e)));
  await p7.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await carregarDominio(p7);

  await irPara(p7, 'clientes');
  await p7.click('#cliNovoBtn');
  await p7.waitForTimeout(150);
  await p7.fill('#cliFormNome', 'Cliente Revisões');
  await p7.click('#cliSalvar');
  await p7.waitForTimeout(250);
  const clienteRevId = (await lerClientesLS(p7)).find(c => c.nome === 'Cliente Revisões').id;

  await irPara(p7, 'orcamentos');
  await p7.click('#resetBtn');
  await p7.waitForTimeout(300);
  await p7.fill('#cliNome', 'Cliente Revisões');
  await p7.waitForTimeout(250);
  await p7.click('.cli-busca-item[data-id]');
  await p7.waitForTimeout(200);
  await p7.fill('.s-desc', 'Proposta inicial');
  await p7.fill('.s-qtd', '1');
  await p7.fill('.s-valor', '16800,00');
  await p7.waitForTimeout(600);
  const numeroRev1 = await p7.inputValue('#orcNumero');

  await p7.click('#resetBtn');
  await p7.waitForTimeout(300);
  await p7.fill('#cliNome', 'Cliente Revisões');
  await p7.waitForTimeout(250);
  await p7.click('.cli-busca-item[data-id]');
  await p7.waitForTimeout(200);
  await p7.fill('.s-desc', 'Proposta revisada');
  await p7.fill('.s-qtd', '1');
  await p7.fill('.s-valor', '15500,00');
  await p7.waitForTimeout(600);
  const numeroRev2 = await p7.inputValue('#orcNumero');

  const revisao = await p7.evaluate(async ({ clienteId, num1, num2 }) => {
    const oport = window.__com.opo.criar({ clienteId, titulo: 'Oportunidade com 2 revisões' });
    const orc = await import('./src/domain/orcamentos.js');
    const lista = orc.lerHistorico();
    lista.find(e => e.orcNumero === num1).oportunidadeId = oport.id;
    lista.find(e => e.orcNumero === num2).oportunidadeId = oport.id;
    orc.gravarHistorico(lista);
    return oport.id;
  }, { clienteId: clienteRevId, num1: numeroRev1, num2: numeroRev2 });

  const listaRev = await p7.evaluate(() => window.__beccaTeste.lerHistorico());
  const rev1 = listaRev.find(e => e.orcNumero === numeroRev1);
  const rev2 = listaRev.find(e => e.orcNumero === numeroRev2);
  checar(rev1.oportunidadeId === revisao && rev2.oportunidadeId === revisao,
    '1 oportunidade, 2 orçamentos — os dois apontam para ela');
  checar(rev1.total === 16800 && rev2.total === 15500,
    'os valores continuam diferentes e independentes (nenhum sobrescreveu o outro)');

  checar(erros7.length === 0, `sem erros de JavaScript ${erros7.length ? '-> ' + erros7.join(' | ') : ''}`);
  await ctx7.close();

  // =========================================================
  console.log('\n[13] Aprovar orçamento aprova a oportunidade vinculada (sem cascata)');
  // =========================================================
  const ctx8 = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx8.addInitScript(() => localStorage.setItem('beccaGesso.nuvemDesligada.v1', 'true'));
  const p8 = await ctx8.newPage();
  const erros8 = [];
  p8.on('pageerror', e => erros8.push(String(e)));
  p8.on('dialog', d => d.accept());
  await p8.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await carregarDominio(p8);

  await irPara(p8, 'clientes');
  await p8.click('#cliNovoBtn');
  await p8.waitForTimeout(150);
  await p8.fill('#cliFormNome', 'Cliente Aprovação');
  await p8.click('#cliSalvar');
  await p8.waitForTimeout(250);
  const clienteApId = (await lerClientesLS(p8)).find(c => c.nome === 'Cliente Aprovação').id;

  await irPara(p8, 'orcamentos');
  await p8.click('#resetBtn');
  await p8.waitForTimeout(300);
  await p8.fill('#cliNome', 'Cliente Aprovação');
  await p8.waitForTimeout(250);
  await p8.click('.cli-busca-item[data-id]');
  await p8.waitForTimeout(200);
  await p8.fill('.s-desc', 'Orçamento A (será aprovado)');
  await p8.fill('.s-qtd', '1');
  await p8.fill('.s-valor', '1000,00');
  await p8.waitForTimeout(600);
  const numeroAp1 = await p8.inputValue('#orcNumero');

  await p8.click('#resetBtn');
  await p8.waitForTimeout(300);
  await p8.fill('#cliNome', 'Cliente Aprovação');
  await p8.waitForTimeout(250);
  await p8.click('.cli-busca-item[data-id]');
  await p8.waitForTimeout(200);
  await p8.fill('.s-desc', 'Orçamento B (irmão, não deve mudar)');
  await p8.fill('.s-qtd', '1');
  await p8.fill('.s-valor', '1200,00');
  await p8.waitForTimeout(600);
  const numeroAp2 = await p8.inputValue('#orcNumero');

  const setupAp = await p8.evaluate(async ({ clienteId, num1, num2 }) => {
    const opo = window.__com.opo;
    const oport = opo.criar({ clienteId, titulo: 'Oportunidade em negociação' });
    opo.alterarStatus(oport.id, 'contato');
    opo.alterarStatus(oport.id, 'visita');
    opo.alterarStatus(oport.id, 'orcamento');
    opo.alterarStatus(oport.id, 'negociacao');

    const orc = await import('./src/domain/orcamentos.js');
    const lista = orc.lerHistorico();
    const e1 = lista.find(x => x.orcNumero === num1);
    const e2 = lista.find(x => x.orcNumero === num2);
    e1.oportunidadeId = oport.id;
    e1.situacao = 'enviado';
    e2.situacao = 'enviado'; // irmão, propositalmente SEM oportunidadeId
    orc.gravarHistorico(lista);
    return oport.id;
  }, { clienteId: clienteApId, num1: numeroAp1, num2: numeroAp2 });

  // aprova o Orçamento A pela tela real (histórico -> seletor de situação)
  await irPara(p8, 'orcamentos');
  await p8.click('#histBtn');
  await p8.waitForTimeout(200);
  await p8.locator('.hist-item').filter({ hasText: numeroAp1 }).locator('.hist-sit').selectOption('aprovado');
  await p8.waitForTimeout(300);

  const oportApos = await p8.evaluate(id => window.__com.opo.buscarPorId(id), setupAp);
  checar(oportApos.status === 'aprovada', 'a oportunidade vinculada virou "aprovada"');
  const eventosAp = await p8.evaluate(id => window.__com.ativ.listarPorOportunidade(id), setupAp);
  checar(eventosAp[0].tipo === 'mudanca_status' && eventosAp[0].dados.para === 'aprovada',
    'e ganhou um evento de mudança de status registrando isso');

  const listaAp = await p8.evaluate(() => window.__beccaTeste.lerHistorico());
  const orcAApos = listaAp.find(e => e.orcNumero === numeroAp1);
  const orcBApos = listaAp.find(e => e.orcNumero === numeroAp2);
  checar(orcAApos.situacao === 'aprovado', 'o orçamento A realmente ficou aprovado');
  checar(orcBApos.situacao === 'enviado',
    'o orçamento B (irmão, sem oportunidade) continua "enviado" — nenhuma cascata automática');

  checar(erros8.length === 0, `sem erros de JavaScript ${erros8.length ? '-> ' + erros8.join(' | ') : ''}`);
  await ctx8.close();

  // =========================================================
  console.log('\n[14] Retrocompatibilidade: orçamento legado sem oportunidadeId');
  // =========================================================
  const ctxMig = await browser.newContext({ ...devices['iPhone 13'] });
  await ctxMig.addInitScript(() => localStorage.setItem('beccaGesso.nuvemDesligada.v1', 'true'));
  let pm = await ctxMig.newPage();
  const errosMig = [];
  pm.on('pageerror', e => errosMig.push(String(e)));
  await pm.goto(`${base}/index.html`, { waitUntil: 'networkidle' });

  // um orçamento "de antes desta etapa": sem o campo oportunidadeId
  const legado = {
    historico: [{
      orcNumero: '0001/2026', id: 'orc_legado1', clienteId: 'cli_legado1',
      cliNome: 'Cliente Legado', cliTelefone: '(14) 98888-0000', cliEndereco: 'Rua Legada, 1',
      orcData: '2026-01-05', servicos: [{ desc: 'Gesso', qtd: 1, valor: 500, unidade: 'm²' }],
      condicoes: {}, situacao: 'aprovado', atualizadoEm: Date.now(),
    }],
  };
  await pm.evaluate(l => {
    localStorage.setItem('beccaGesso.historico.v1', JSON.stringify(l.historico));
  }, legado);

  const estadoAntes = await pm.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.historico.v1')));

  // "reabre" o app: é exatamente o que dispara migrarDadosLegados() de novo
  const pmReaberto = await reabrir(ctxMig, pm, base, errosMig);
  await pmReaberto.waitForTimeout(300);

  const estadoDepois = await pmReaberto.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.historico.v1')));

  checar(JSON.stringify(estadoAntes) === JSON.stringify(estadoDepois),
    'reabrir o app (rodar a inicialização/migração de novo) não reescreveu nenhum byte do orçamento legado');
  const entradaLegada = estadoDepois.find(e => e.orcNumero === '0001/2026');
  checar(!entradaLegada.oportunidadeId,
    'oportunidadeId continua ausente — tratado como null, sem precisar reescrever o histórico (item 35)');
  checar(entradaLegada.situacao === 'aprovado' && entradaLegada.cliNome === 'Cliente Legado',
    'cálculo, situação e snapshot do orçamento legado continuam intactos');

  // e a migração idempotente das origens/motivos rodou (mesmo padrão de categorias)
  const origensDepoisMig = await pmReaberto.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.origensLead.v1') || '[]'));
  checar(origensDepoisMig.length === 9, 'origens padrão foram semeadas também neste aparelho "antigo"');

  // reabrir de novo (2ª migração) continua sem duplicar nem mudar nada
  const pmReaberto2 = await reabrir(ctxMig, pmReaberto, base, errosMig);
  await pmReaberto2.waitForTimeout(300);
  const origensDepoisMig2 = await pmReaberto2.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.origensLead.v1') || '[]'));
  const estadoTerceiro = await pmReaberto2.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.historico.v1')));
  checar(origensDepoisMig2.length === 9, 'rodar a migração uma 2ª vez não duplica as origens');
  checar(JSON.stringify(estadoDepois) === JSON.stringify(estadoTerceiro),
    'nem muda de novo o orçamento legado');

  checar(errosMig.length === 0, `sem erros de JavaScript ${errosMig.length ? '-> ' + errosMig.join(' | ') : ''}`);
  await ctxMig.close();

  // =========================================================
  console.log('\n[15] Sincronização das 4 entidades novas (e offline)');
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
  await carregarDominio(paLogado);

  // cria offline primeiro (sem internet), depois sincroniza
  await paLogado.context().setOffline(true);
  const criadaOffline = await paLogado.evaluate(() =>
    window.__com.opo.criar({ clienteId: 'cli_offline', titulo: 'Oportunidade criada offline' }));
  checar(!!criadaOffline, 'dá para criar oportunidade sem internet');
  await paLogado.context().setOffline(false);
  await paLogado.evaluate(() => window.__beccaTeste.sincronizar({}));
  await paLogado.waitForTimeout(400);

  checar(nuvem.estado.linhas.oportunidades.length === 1, 'a oportunidade criada offline subiu para a nuvem ao voltar');
  checar(nuvem.estado.linhas.oportunidades[0].dados.titulo === 'Oportunidade criada offline', 'com o título certo');

  const eventosSubidos = nuvem.estado.linhas.atividades_comerciais.length;
  checar(eventosSubidos >= 1, `o evento "oportunidade_criada" também subiu (${eventosSubidos} atividade(s))`);
  checar(nuvem.estado.linhas.origens_lead.length === 9, 'as 9 origens subiram');
  checar(nuvem.estado.linhas.motivos_perda.length === 8, 'os 8 motivos de perda subiram');

  /* um segundo aparelho, na mesma conta, recebe tudo */
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

  const oportunidadesRecebidasB = await pbLogado.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.oportunidades.v1') || '[]'));
  checar(oportunidadesRecebidasB.some(o => o.titulo === 'Oportunidade criada offline'),
    'o segundo aparelho recebeu a oportunidade pela sincronização');
  /* Nota: um aparelho novo semeia suas PRÓPRIAS origens padrão (com ids
     locais, gerados por ele) antes mesmo de entrar/sincronizar — assim
     como já acontecia com `categorias` desde a Etapa 2. Duas listas
     "padrão" semeadas de forma independente em dois aparelhos, cada uma
     com seus próprios ids, não se fundem pelo nome — a sincronização
     funciona por identidade (id), não por igualdade de conteúdo. Isto
     não é uma regressão desta etapa: é o mesmo comportamento que
     `categorias` sempre teve, só nunca tinha sido exercitado por um
     teste de 2 aparelhos. Por isso este teste confere que os dados
     chegaram (não que ficaram deduplicados). */
  const origensRecebidasB = await pbLogado.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.origensLead.v1') || '[]'));
  checar(origensRecebidasB.some(o => o.nome === 'Indicação'),
    'as origens (próprias + as sincronizadas de A) estão presentes no aparelho B');

  // edita no B, sincroniza, A recebe a atualização
  const oportB = oportunidadesRecebidasB.find(o => o.titulo === 'Oportunidade criada offline');
  await pbLogado.evaluate(async id => {
    const opo = await import('./src/domain/oportunidades.js');
    opo.atualizar(id, { responsavel: 'Editado no aparelho B' });
  }, oportB.id);
  await pbLogado.evaluate(() => window.__beccaTeste.sincronizar({}));
  await pbLogado.waitForTimeout(400);

  await paLogado.evaluate(() => window.__beccaTeste.sincronizar({}));
  await paLogado.waitForTimeout(400);
  const oportunidadesFinaisA = await paLogado.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.oportunidades.v1') || '[]'));
  checar(oportunidadesFinaisA.find(o => o.id === oportB.id).responsavel === 'Editado no aparelho B',
    'A recebeu de volta a edição feita em B');

  checar(errosA.length === 0 && errosB.length === 0, 'sem erros de JavaScript na sincronização');

  await ctxA.close();
  await ctxB.close();

  // =========================================================
  console.log('\n[16] Regressão: suíte existente continua intacta');
  // =========================================================
  console.log('  (não roda aqui — ver testar-clientes.js / testar-inicio.js na mesma bateria)');

  await browser.close();
  srv.close();
  nuvem.servidor.close();

  console.log(`\n${falhas.length ? 'FALHAS: ' + falhas.length : 'Todos os testes passaram'}`);
  process.exit(falhas.length ? 1 : 0);
})();
