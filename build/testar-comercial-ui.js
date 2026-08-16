/* Testa a Etapa 3.2 (Becca OS): a interface Comercial mínima — lista,
   criação, detalhe, funil/mudança de status, motivo de perda e a
   exibição (só-leitura) do orçamento vinculado. Tudo pela tela de
   verdade (cliques, preenchimento de formulário), não por chamada
   direta ao domínio — isso já está coberto por testar-comercial.js. */
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
  console.log('\n[1] Lista vazia e navegação até a seção');
  // =========================================================
  await irPara(p, 'comercial');
  checar(await p.locator('.contas-vazio').isVisible(), 'lista começa vazia');
  checar(await p.locator('#opoNovoBtn').isVisible(), 'botão de nova oportunidade visível');

  // um cliente de verdade, para o select da criação ter o que mostrar
  await irPara(p, 'clientes');
  await p.click('#cliNovoBtn');
  await p.waitForTimeout(150);
  await p.fill('#cliFormNome', 'Construtora Horizonte');
  await p.click('#cliSalvar');
  await p.waitForTimeout(250);

  // =========================================================
  console.log('\n[2] Validação: sem cliente/título não cria');
  // =========================================================
  await irPara(p, 'comercial');
  await p.click('#opoNovoBtn');
  await p.waitForTimeout(150);
  checar(await p.locator('#painelOportunidade').isVisible(), 'painel de criação abre');
  await p.click('#opoSalvar');
  await p.waitForTimeout(150);
  checar(await p.locator('#opoAviso').isVisible(), 'sem cliente escolhido, mostra aviso');
  checar(await p.locator('#painelOportunidade').isVisible(), 'e o painel continua aberto (não criou)');

  await p.selectOption('#opoFormCliente', { label: 'Construtora Horizonte' });
  await p.click('#opoSalvar');
  await p.waitForTimeout(150);
  checar(await p.locator('#opoAviso').isVisible(), 'cliente ok mas sem título, ainda mostra aviso');

  // =========================================================
  console.log('\n[3] Criação completa');
  // =========================================================
  await p.fill('#opoFormTitulo', 'Forro + drywall — sede nova');
  const origens = await p.locator('#opoFormOrigem option').allTextContents();
  checar(origens.some(o => o.includes('Indicação')), 'select de origem vem com as origens padrão (ex.: Indicação)');
  await p.selectOption('#opoFormOrigem', { label: 'Indicação' });
  await p.fill('#opoFormValor', '12.500,00');
  await p.fill('#opoFormResponsavel', 'Becca');
  await p.click('#opoSalvar');
  await p.waitForTimeout(300);

  checar(await p.locator('#painelOportunidade').isHidden(), 'painel fecha depois de criar');
  checar(await p.locator('.oportunidade-item').count() === 1, 'a oportunidade aparece na lista');
  const textoItem = await p.locator('.oportunidade-item').textContent();
  checar(textoItem.includes('Forro + drywall — sede nova'), 'com o título certo');
  checar(textoItem.includes('Construtora Horizonte'), 'com o cliente certo');
  checar(textoItem.includes('Novo'), 'começa com o rótulo de status "Novo"');
  checar(textoItem.includes('R$'), 'mostra a estimativa de valor');

  // =========================================================
  console.log('\n[4] Abrir e ver o detalhe (cabeçalho, funil, timeline)');
  // =========================================================
  await p.click('.opo-abrir');
  await p.waitForTimeout(200);
  checar(await p.locator('#painelOportunidadeDetalhe').isVisible(), 'painel de detalhe abre');
  checar((await p.locator('#opoDetTitulo').textContent()) === 'Forro + drywall — sede nova', 'título certo no detalhe');
  const cabecalho = await p.locator('#opoDetCabecalho').textContent();
  checar(cabecalho.includes('Construtora Horizonte'), 'cliente aparece no cabeçalho');
  checar(cabecalho.includes('Estimativa'), 'valor é rotulado "Estimativa", nunca como valor fechado');
  checar(cabecalho.includes('Becca'), 'responsável aparece no cabeçalho');

  const funil = await p.locator('#opoDetFunil').textContent();
  checar(funil.includes('Novo') && funil.includes('Aprovada'), 'funil mostra a sequência completa até Aprovada');

  const timelineInicial = await p.locator('#opoDetTimeline').textContent();
  checar(timelineInicial.toLowerCase().includes('oportunidade') && timelineInicial.includes('criada'),
    'a timeline já mostra o evento automático de criação');

  // =========================================================
  console.log('\n[5] Mudar status pelo select (funil)');
  // =========================================================
  await p.selectOption('#opoStatusSelect', 'contato');
  await p.waitForTimeout(200);
  let timeline = await p.locator('#opoDetTimeline').textContent();
  checar(timeline.includes('Novo') && timeline.includes('Contato'),
    'a mudança novo -> contato aparece na timeline com os dois lados (de/para)');

  await p.selectOption('#opoStatusSelect', 'visita');
  await p.waitForTimeout(200);
  timeline = await p.locator('#opoDetTimeline').textContent();
  checar(timeline.includes('Visita'), 'contato -> visita também registrado');

  const itensTimelineAntes = await p.locator('.opo-timeline-item').count();
  await p.selectOption('#opoStatusSelect', 'visita'); // mesmo status: não deve criar evento novo
  await p.waitForTimeout(200);
  const itensTimelineDepois = await p.locator('.opo-timeline-item').count();
  checar(itensTimelineDepois === itensTimelineAntes, 'selecionar o mesmo status não cria um evento novo');

  // reflete na lista também, sem precisar reabrir o painel
  await p.click('#opoDetFechar');
  await p.waitForTimeout(200);
  checar((await p.locator('.oportunidade-item').textContent()).includes('Visita'),
    'a lista já mostra o novo status depois de fechar o detalhe');

  // =========================================================
  console.log('\n[6] Marcar como perdida exige motivo');
  // =========================================================
  await p.click('.opo-abrir');
  await p.waitForTimeout(200);
  await p.selectOption('#opoStatusSelect', 'orcamento');
  await p.waitForTimeout(150);
  await p.selectOption('#opoStatusSelect', 'negociacao');
  await p.waitForTimeout(150);

  await p.click('#opoMarcarPerdida');
  await p.waitForTimeout(150);
  checar(await p.locator('#opoMotivoPerda').isVisible(), 'clicar em "Oportunidade perdida" abre o miniformulário de motivo');
  const motivos = await p.locator('#opoMotivoSelect option').allTextContents();
  checar(motivos.some(m => m.includes('Preço')), 'select de motivo vem com os motivos padrão (ex.: Preço)');

  await p.click('#opoMotivoCancelar');
  await p.waitForTimeout(150);
  checar(await p.locator('#opoMotivoPerda').isHidden(), 'cancelar fecha o miniformulário sem mudar nada');
  checar((await p.locator('#opoDetFunil').textContent()).includes('Negociação') ||
    !!(await p.locator('#opoStatusSelect').count()), 'e a oportunidade continua em negociação (não perdida)');

  await p.click('#opoMarcarPerdida');
  await p.waitForTimeout(150);
  await p.selectOption('#opoMotivoSelect', { label: 'Preço' });
  await p.fill('#opoMotivoDetalhe', 'Achou caro comparado ao concorrente');
  await p.click('#opoMotivoConfirmar');
  await p.waitForTimeout(250);

  checar(await p.locator('#opoDetControle').textContent() === '', 'depois de perdida, não há mais controle de status (é terminal)');
  const textoPerdida = await p.locator('#opoDetFunil').textContent();
  checar(textoPerdida.includes('perdida') || textoPerdida.toLowerCase().includes('perdida'), 'o funil mostra a marca de perdida');
  checar(textoPerdida.includes('Preço'), 'com o motivo certo');
  const timelinePerdida = await p.locator('#opoDetTimeline').textContent();
  checar(timelinePerdida.includes('Negociação') && timelinePerdida.includes('Perdida'),
    'a timeline registrou negociação -> perdida');

  await p.click('#opoDetFechar');
  await p.waitForTimeout(200);
  checar((await p.locator('.oportunidade-item').textContent()).includes('Perdida'),
    'a lista reflete "Perdida" também');

  // =========================================================
  console.log('\n[7] Orçamento vinculado (só leitura)');
  // =========================================================
  await p.click('#opoNovoBtn');
  await p.waitForTimeout(150);
  await p.selectOption('#opoFormCliente', { label: 'Construtora Horizonte' });
  await p.fill('#opoFormTitulo', 'Segunda oportunidade');
  await p.click('#opoSalvar');
  await p.waitForTimeout(300);

  await p.locator('.oportunidade-item').filter({ hasText: 'Segunda oportunidade' }).locator('.opo-abrir').click();
  await p.waitForTimeout(200);
  checar((await p.locator('#opoDetVinculo').textContent()).includes('Nenhum orçamento vinculado'),
    'sem orçamento vinculado, mostra a mensagem certa');

  const idOportunidade = await p.evaluate(async () => {
    const opo = await import('./src/domain/oportunidades.js');
    return opo.lerOportunidades().find(o => o.titulo === 'Segunda oportunidade').id;
  });

  // cria um orçamento pelo fluxo normal e vincula por baixo (a tela do
  // orçamento ainda não tem o seletor de oportunidade — isso é a 3.3)
  await p.click('#opoDetFechar');
  await irPara(p, 'orcamentos');
  await p.click('#resetBtn');
  await p.waitForTimeout(300);
  await p.fill('#cliNome', 'Construtora Horizonte');
  await p.waitForTimeout(250);
  await p.click('.cli-busca-item[data-id]');
  await p.waitForTimeout(200);
  await p.fill('.s-desc', 'Forro');
  await p.fill('.s-qtd', '1');
  await p.fill('.s-valor', '15000,00');
  await p.waitForTimeout(600);
  const numeroVinculo = await p.inputValue('#orcNumero');

  await p.evaluate(async ({ id, numero }) => {
    const orc = await import('./src/domain/orcamentos.js');
    const lista = orc.lerHistorico();
    const e = lista.find(x => x.orcNumero === numero);
    e.oportunidadeId = id;
    e.situacao = 'enviado';
    orc.gravarHistorico(lista);
  }, { id: idOportunidade, numero: numeroVinculo });

  await irPara(p, 'comercial');
  await p.locator('.oportunidade-item').filter({ hasText: 'Segunda oportunidade' }).locator('.opo-abrir').click();
  await p.waitForTimeout(200);
  const vinculo = await p.locator('#opoDetVinculo').textContent();
  checar(vinculo.includes(numeroVinculo), 'agora mostra o número do orçamento vinculado');
  checar(vinculo.includes('15.000'), 'com o valor certo');
  checar(vinculo.includes('Enviado'), 'e a situação certa (mesmo rótulo usado em Clientes)');

  // =========================================================
  console.log('\n[8] Responsividade (iPhone)');
  // =========================================================
  await p.click('#opoDetFechar');
  await p.waitForTimeout(150);
  await p.click('#opoNovoBtn');
  await p.waitForTimeout(150);
  const larguraCampo = await p.evaluate(() =>
    parseFloat(getComputedStyle(document.getElementById('opoFormTitulo')).fontSize));
  checar(larguraCampo >= 16, `campo de título com fonte >= 16px (evita zoom do Safari): ${larguraCampo}px`);
  const semRolagemHorizontal = await p.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  checar(semRolagemHorizontal, 'sem rolagem horizontal no painel de criação, no iPhone');
  await p.click('#opoFechar');

  // =========================================================
  console.log('\n[9] Editar oportunidade (Etapa 3.2.1)');
  // =========================================================
  await irPara(p, 'clientes');
  await p.click('#cliNovoBtn');
  await p.waitForTimeout(150);
  await p.fill('#cliFormNome', 'Cliente Edicao');
  await p.click('#cliSalvar');
  await p.waitForTimeout(250);

  await irPara(p, 'comercial');
  await p.click('#opoNovoBtn');
  await p.waitForTimeout(150);
  await p.selectOption('#opoFormCliente', { label: 'Cliente Edicao' });
  await p.fill('#opoFormTitulo', 'Editar depois de criar');
  await p.click('#opoSalvar');
  await p.waitForTimeout(300);

  await p.locator('.oportunidade-item').filter({ hasText: 'Editar depois de criar' }).locator('.opo-abrir').click();
  await p.waitForTimeout(200);
  checar(await p.locator('#opoEditarBtn').isVisible(), 'painel de detalhe tem o botão "Editar"');
  await p.click('#opoEditarBtn');
  await p.waitForTimeout(150);
  checar(await p.locator('#opoEditTitulo').isVisible(), 'clicar em Editar mostra o formulário de edição');
  checar((await p.inputValue('#opoEditTitulo')) === 'Editar depois de criar', 'título atual vem preenchido');

  // 3a. cancelar não salva nada
  await p.fill('#opoEditTitulo', 'Isto não deveria ficar salvo');
  await p.click('#opoEditCancelar');
  await p.waitForTimeout(150);
  checar(await p.locator('#opoEditTitulo').isHidden(), 'Cancelar sai do modo de edição');
  checar((await p.locator('#opoDetTitulo').textContent()) === 'Editar depois de criar',
    'e o título não mudou (Cancelar não grava)');

  // 3b. validação: título vazio não salva
  await p.click('#opoEditarBtn');
  await p.waitForTimeout(150);
  await p.fill('#opoEditTitulo', '   ');
  await p.click('#opoEditSalvar');
  await p.waitForTimeout(150);
  checar(await p.locator('#opoEditAviso').isVisible(), 'título vazio: mostra aviso e não sai do modo de edição');
  checar(await p.locator('#opoEditTitulo').isVisible(), 'painel continua em edição');

  // 3c. edição completa dos campos cadastrais
  await p.fill('#opoEditTitulo', 'Reforma completa — sede nova');
  await p.fill('#opoEditOrigemDetalhe', 'Indicou um amigo');
  await p.selectOption('#opoEditOrigem', { label: 'Google' });
  await p.fill('#opoEditValor', '18.000,00');
  await p.fill('#opoEditResponsavel', 'Becca Gesso');
  await p.fill('#opoEditVisitaAgendada', '2026-09-10');
  await p.fill('#opoEditVisitaRealizada', '2026-09-12');
  await p.fill('#opoEditProximoContato', '2026-09-20');
  await p.click('#opoEditSalvar');
  await p.waitForTimeout(250);

  checar(await p.locator('#opoEditTitulo').isHidden(), 'depois de salvar, volta para o modo de leitura');
  const cabecalhoEditado = await p.locator('#opoDetCabecalho').textContent();
  checar((await p.locator('#opoDetTitulo').textContent()) === 'Reforma completa — sede nova', 'título foi salvo');
  checar(cabecalhoEditado.includes('Google'), 'origem foi salva');
  checar(cabecalhoEditado.includes('Indicou um amigo'), 'detalhe da origem foi salvo');
  checar(cabecalhoEditado.includes('18.000'), 'valor estimado foi salvo');
  checar(cabecalhoEditado.includes('Becca Gesso'), 'responsável foi salvo');
  checar(cabecalhoEditado.includes('10/09/2026'), 'visita agendada foi salva');
  checar(cabecalhoEditado.includes('12/09/2026'), 'visita realizada foi salva');
  checar(cabecalhoEditado.includes('20/09/2026'), 'próximo contato foi salvo');

  // reflete na lista também
  await p.click('#opoDetFechar');
  await p.waitForTimeout(200);
  checar((await p.locator('.oportunidade-item').filter({ hasText: 'Reforma completa' }).count()) === 1,
    'a lista já mostra o novo título');

  // 3d. reabrir e confirmar que persistiu de verdade (não só na memória da tela)
  const pReaberta = await reabrir(ctx, p, base, erros);
  await irPara(pReaberta, 'comercial');
  await pReaberta.locator('.oportunidade-item').filter({ hasText: 'Reforma completa' })
    .locator('.opo-abrir').click();
  await pReaberta.waitForTimeout(200);
  const cabecalhoReaberto = await pReaberta.locator('#opoDetCabecalho').textContent();
  checar(cabecalhoReaberto.includes('Google') && cabecalhoReaberto.includes('18.000') &&
    cabecalhoReaberto.includes('Becca Gesso'), 'depois de reabrir o app, os dados editados continuam salvos');
  await pReaberta.click('#opoDetFechar');

  // =========================================================
  console.log('\n[10] Teste crítico: editar oportunidade não toca cliente nem orçamento');
  // =========================================================
  await irPara(pReaberta, 'clientes');
  await pReaberta.click('#cliNovoBtn');
  await pReaberta.waitForTimeout(150);
  await pReaberta.fill('#cliFormNome', 'Joao Critico Edicao');
  await pReaberta.fill('#cliFormTelefone', '(14) 90000-1111');
  await pReaberta.fill('#cliFormEndereco', 'Rua Original, 100');
  await pReaberta.click('#cliSalvar');
  await pReaberta.waitForTimeout(250);

  await pReaberta.click('#cliNovoBtn');
  await pReaberta.waitForTimeout(150);
  await pReaberta.fill('#cliFormNome', 'Pedro Novo Cliente');
  await pReaberta.click('#cliSalvar');
  await pReaberta.waitForTimeout(250);

  await irPara(pReaberta, 'orcamentos');
  await pReaberta.click('#resetBtn');
  await pReaberta.waitForTimeout(300);
  await pReaberta.fill('#cliNome', 'Joao Critico Edicao');
  await pReaberta.waitForTimeout(250);
  await pReaberta.click('.cli-busca-item[data-id]');
  await pReaberta.waitForTimeout(200);
  await pReaberta.fill('.s-desc', 'Forro');
  await pReaberta.fill('.s-qtd', '1');
  await pReaberta.fill('.s-valor', '7.000,00');
  await pReaberta.waitForTimeout(600);
  const numeroCritico = await pReaberta.inputValue('#orcNumero');

  const setup = await pReaberta.evaluate(async ({ numero }) => {
    const opo = await import('./src/domain/oportunidades.js');
    const cli = await import('./src/domain/clientes.js');
    const orc = await import('./src/domain/orcamentos.js');

    const joao = cli.lerClientes().find(c => c.nome === 'Joao Critico Edicao');
    const pedro = cli.lerClientes().find(c => c.nome === 'Pedro Novo Cliente');
    const oportunidade = opo.criar({ clienteId: joao.id, titulo: 'Reforma João' });

    const lista = orc.lerHistorico();
    const entrada = lista.find(x => x.orcNumero === numero);
    entrada.oportunidadeId = oportunidade.id;
    orc.gravarHistorico(lista);

    return {
      joaoId: joao.id, pedroId: pedro.id, oportunidadeId: oportunidade.id,
      joaoAntes: JSON.parse(JSON.stringify(joao)),
      orcamentoAntes: JSON.parse(JSON.stringify(orc.lerHistorico().find(x => x.orcNumero === numero))),
    };
  }, { numero: numeroCritico });

  await irPara(pReaberta, 'comercial');
  await pReaberta.locator('.oportunidade-item').filter({ hasText: 'Reforma João' }).locator('.opo-abrir').click();
  await pReaberta.waitForTimeout(200);
  await pReaberta.click('#opoEditarBtn');
  await pReaberta.waitForTimeout(150);
  await pReaberta.selectOption('#opoEditCliente', { label: 'Pedro Novo Cliente' });
  await pReaberta.fill('#opoEditTitulo', 'Reforma — cliente trocado');
  await pReaberta.fill('#opoEditValor', '9.500,00');
  await pReaberta.click('#opoEditSalvar');
  await pReaberta.waitForTimeout(250);

  const depois = await pReaberta.evaluate(async ({ joaoId, oportunidadeId, numero }) => {
    const opo = await import('./src/domain/oportunidades.js');
    const cli = await import('./src/domain/clientes.js');
    const orc = await import('./src/domain/orcamentos.js');
    return {
      oportunidade: opo.buscarPorId(oportunidadeId),
      joao: cli.buscarPorId(joaoId),
      orcamento: orc.lerHistorico().find(x => x.orcNumero === numero),
    };
  }, { joaoId: setup.joaoId, oportunidadeId: setup.oportunidadeId, numero: numeroCritico });

  checar(depois.oportunidade.clienteId === setup.pedroId, 'Oportunidade: clienteId mudou para Pedro');
  checar(depois.oportunidade.titulo === 'Reforma — cliente trocado', 'Oportunidade: título mudou');
  checar(depois.oportunidade.valorEstimado === 9500, 'Oportunidade: valorEstimado mudou');

  checar(JSON.stringify(depois.joao) === JSON.stringify(setup.joaoAntes),
    'Cliente João: nenhum byte mudou (edição da oportunidade não tocou o cadastro)');

  checar(depois.orcamento.clienteId === setup.joaoId,
    'Orçamento: clienteId continua sendo João (não seguiu a troca de cliente da oportunidade)');
  checar(JSON.stringify(depois.orcamento) === JSON.stringify(setup.orcamentoAntes),
    'Orçamento: nenhum byte mudou — cálculo, situação e snapshot (cliNome/cliTelefone/cliEndereco) intactos');

  checar(erros.length === 0, `sem erros de JavaScript ${erros.length ? '-> ' + erros.join(' | ') : ''}`);

  await ctx.close();
  await browser.close();
  srv.close();

  console.log(`\n${falhas.length ? 'FALHAS: ' + falhas.length : 'Todos os testes passaram'}`);
  process.exit(falhas.length ? 1 : 0);
})();
