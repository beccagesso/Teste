/* Testa a seção de contas a pagar: navegação entre as seções, cadastro,
   classificação por vencimento, marcar paga, repetir no mês seguinte,
   editar, excluir, filtros, busca e a ida das contas no backup. */
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

/* data relativa a hoje no formato que o campo de vencimento usa */
function emDias(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const contasGravadas = p => p.evaluate(() =>
  JSON.parse(localStorage.getItem('beccaGesso.contas.v1') || '[]'));

async function lancar(p, { descricao, valor, vencimento, fornecedor, categoria, obs }) {
  await p.fill('#ctDescricao', descricao);
  await p.fill('#ctValor', valor);
  await p.fill('#ctVencimento', vencimento);
  if (fornecedor !== undefined) await p.fill('#ctFornecedor', fornecedor);
  if (categoria !== undefined) await p.selectOption('#ctCategoria', categoria);
  if (obs !== undefined) await p.fill('#ctObs', obs);
  await p.click('#ctSalvar');
  await p.waitForTimeout(250);
}

/* texto e classe de um item da lista, pela descrição */
async function item(p, descricao) {
  return p.evaluate(desc => {
    for (const n of document.querySelectorAll('#contasLista .conta-item')) {
      if (n.querySelector('.conta-desc').textContent.trim() === desc) {
        return { classe: n.className, marca: n.querySelector('.conta-marca').textContent.trim(),
                 texto: n.textContent };
      }
    }
    return null;
  }, descricao);
}

/* Intl usa espaço fixo (U+00A0) depois do "R$" — comparar sem normalizar
   dá falha por um caractere invisível */
const semNbsp = t => String(t).replace(/\u00a0/g, ' ');

const descricoesVisiveis = p => p.evaluate(() =>
  [...document.querySelectorAll('#contasLista .conta-desc')].map(n => n.textContent.trim()));

(async () => {
  const srv = await servidor();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  const erros = [];
  const avisos = [];
  p.on('pageerror', e => erros.push(String(e)));
  p.on('dialog', d => { avisos.push(d.message()); d.accept(); });
  await p.goto(`${base}/index.html`, { waitUntil: 'networkidle' });

  // ---------- 1. navegação entre as seções ----------
  console.log('\n[1] Navegação entre as seções');
  checar(await p.locator('#secaoOrcamentos').isVisible(), 'abre nos orçamentos');
  checar(await p.locator('#secaoContas').isHidden(), 'as contas começam escondidas');

  await p.click('.secao-btn[data-secao="contas"]');
  await p.waitForTimeout(250);
  checar(await p.locator('#secaoContas').isVisible(), 'o botão abre as contas');
  checar(await p.locator('#secaoOrcamentos').isHidden(),
    'os orçamentos somem quando as contas aparecem');
  checar((await p.textContent('#tituloSecao')).includes('pagar'),
    'o subtítulo acompanha a seção');
  checar(await p.locator('.secao-btn[data-secao="contas"]').getAttribute('aria-current') === 'page',
    'o botão da seção aberta fica marcado para leitores de tela');

  await p.click('.secao-btn[data-secao="orcamentos"]');
  await p.waitForTimeout(200);
  checar(await p.locator('#secaoOrcamentos').isVisible(), 'dá para voltar aos orçamentos');

  /* a seção escolhida tem de sobreviver a fechar e abrir o app */
  await p.click('.secao-btn[data-secao="contas"]');
  await p.waitForTimeout(200);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  checar(await p.locator('#secaoContas').isVisible(),
    'o app reabre na última seção usada');

  // ---------- 2. cadastro ----------
  console.log('\n[2] Lançar uma conta');
  checar((await p.textContent('#contasLista')).includes('Nenhuma conta cadastrada'),
    'avisa quando ainda não há contas');

  await lancar(p, { descricao: 'Placas de gesso — NF 1234', valor: '1.480,50',
    vencimento: emDias(7), fornecedor: 'Gessos Bauru', categoria: 'Material' });
  let contas = await contasGravadas(p);
  checar(contas.length === 1, 'a conta foi guardada');
  checar(contas[0].valor === 1480.5,
    `o valor com vírgula foi lido certo (${contas[0].valor})`);
  checar(contas[0].pago === false, 'a conta nasce em aberto');
  checar(semNbsp((await item(p, 'Placas de gesso — NF 1234')).texto).includes('R$ 1.480,50'),
    'a lista mostra o valor formatado');
  checar((await p.inputValue('#ctDescricao')) === '',
    'o formulário limpa depois de salvar');

  // campos obrigatórios
  console.log('\n[3] Campos obrigatórios');
  avisos.length = 0;
  await p.click('#ctSalvar');
  await p.waitForTimeout(200);
  checar(avisos.some(a => /descrição/i.test(a)), 'exige a descrição');
  await p.fill('#ctDescricao', 'Sem valor');
  avisos.length = 0;
  await p.click('#ctSalvar');
  await p.waitForTimeout(200);
  checar(avisos.some(a => /valor/i.test(a)), 'exige o valor');
  await p.fill('#ctValor', '100');
  await p.fill('#ctVencimento', '');
  avisos.length = 0;
  await p.click('#ctSalvar');
  await p.waitForTimeout(200);
  checar(avisos.some(a => /vencimento/i.test(a)), 'exige o vencimento');
  checar((await contasGravadas(p)).length === 1, 'nada incompleto foi guardado');
  await p.click('#ctCancelar').catch(() => {});
  await p.evaluate(() => limparFormConta());
  await p.waitForTimeout(150);

  // ---------- 4. situação pelo vencimento ----------
  console.log('\n[4] Situação pelo vencimento');
  await lancar(p, { descricao: 'Aluguel do galpão', valor: '2.200,00',
    vencimento: emDias(-3), categoria: 'Aluguel' });
  await lancar(p, { descricao: 'Conta de luz', valor: '340,00',
    vencimento: emDias(0), categoria: 'Outros' });

  checar((await item(p, 'Aluguel do galpão')).classe.includes('vencida'),
    'conta com vencimento passado fica vencida');
  checar((await item(p, 'Aluguel do galpão')).texto.includes('há 3 dias'),
    'mostra há quantos dias venceu');
  /* o erro clássico: comparar com a hora atual faz a conta de hoje
     aparecer como vencida depois do meio-dia */
  checar((await item(p, 'Conta de luz')).classe.includes('hoje'),
    'conta que vence hoje não conta como vencida');
  checar((await item(p, 'Conta de luz')).marca === 'Vence hoje',
    'o selo diz que vence hoje');
  checar((await item(p, 'Placas de gesso — NF 1234')).texto.includes('em 7 dias'),
    'mostra quantos dias faltam');

  // ---------- 5. ordem da lista ----------
  console.log('\n[5] Ordem da lista');
  let ordem = await descricoesVisiveis(p);
  checar(ordem[0] === 'Aluguel do galpão' && ordem[1] === 'Conta de luz',
    `o vencimento mais próximo vem primeiro (${ordem.join(' | ')})`);

  // ---------- 6. marcar paga ----------
  console.log('\n[6] Marcar como paga');
  await p.click('#contasLista .conta-item:has-text("Conta de luz") .ct-pagar');
  await p.waitForTimeout(250);
  const luz = (await contasGravadas(p)).find(c => c.descricao === 'Conta de luz');
  checar(luz.pago === true, 'a conta ficou marcada como paga');
  checar(!!luz.pagoEm, `guardou a data do pagamento (${luz.pagoEm})`);
  checar((await item(p, 'Conta de luz')).classe.includes('paga'), 'o item mostra que está paga');
  checar((await item(p, 'Conta de luz')).texto.includes('Paga em'),
    'a lista mostra quando foi paga');
  ordem = await descricoesVisiveis(p);
  checar(ordem[ordem.length - 1] === 'Conta de luz',
    'as pagas descem para o fim da lista');

  await p.click('#contasLista .conta-item:has-text("Conta de luz") .ct-pagar');
  await p.waitForTimeout(250);
  checar((await contasGravadas(p)).find(c => c.descricao === 'Conta de luz').pago === false,
    'dá para desfazer o pagamento');
  await p.click('#contasLista .conta-item:has-text("Conta de luz") .ct-pagar');
  await p.waitForTimeout(250);

  // ---------- 7. resumo ----------
  console.log('\n[7] Resumo do topo');
  const resumo = await p.evaluate(() =>
    [...document.querySelectorAll('#contasResumo .conta-chip')].map(b => ({
      filtro: b.dataset.filtro,
      valor: b.querySelector('.chip-val').textContent,
      qtd: b.querySelector('.chip-qtd').textContent,
    })));
  const chip = f => { const c = resumo.find(x => x.filtro === f);
    return {valor: semNbsp(c.valor), qtd: c.qtd}; };
  checar(chip('vencidas').valor === 'R$ 2.200,00',
    `soma das vencidas (${chip('vencidas').valor})`);
  checar(chip('avencer').valor === 'R$ 1.480,50',
    `soma do que ainda vai vencer (${chip('avencer').valor})`);
  checar(chip('pagas').valor === 'R$ 340,00',
    `soma do que já foi pago no mês (${chip('pagas').valor})`);

  // ---------- 8. filtros e busca ----------
  console.log('\n[8] Filtros e busca');
  await p.click('#contasResumo .conta-chip[data-filtro="vencidas"]');
  await p.waitForTimeout(250);
  checar((await descricoesVisiveis(p)).join() === 'Aluguel do galpão',
    'o filtro de vencidas mostra só as vencidas');
  await p.click('#contasResumo .conta-chip[data-filtro="vencidas"]');
  await p.waitForTimeout(250);
  checar((await descricoesVisiveis(p)).length === 3,
    'tocar de novo no mesmo filtro mostra tudo outra vez');

  await p.fill('#contasBusca', 'gessos bauru');
  await p.waitForTimeout(300);
  checar((await descricoesVisiveis(p)).join() === 'Placas de gesso — NF 1234',
    'a busca acha pelo fornecedor');
  await p.fill('#contasBusca', 'aluguel');
  await p.waitForTimeout(300);
  checar((await descricoesVisiveis(p)).join() === 'Aluguel do galpão',
    'a busca acha pela descrição');
  await p.fill('#contasBusca', 'zzzz');
  await p.waitForTimeout(300);
  checar((await p.textContent('#contasLista')).includes('Nenhuma conta nesse filtro'),
    'avisa quando a busca não acha nada');
  await p.fill('#contasBusca', '');
  await p.waitForTimeout(300);

  // ---------- 9. editar ----------
  console.log('\n[9] Editar');
  await p.click('#contasLista .conta-item:has-text("Aluguel do galpão") .ct-editar');
  await p.waitForTimeout(300);
  checar((await p.inputValue('#ctDescricao')) === 'Aluguel do galpão',
    'o formulário abre com os dados da conta');
  checar((await p.inputValue('#ctValor')) === '2.200,00',
    `o valor volta formatado (${await p.inputValue('#ctValor')})`);
  checar(await p.locator('#ctSecundarios').isVisible(), 'aparece o botão de cancelar');
  await p.fill('#ctValor', '2.350,00');
  await p.click('#ctSalvar');
  await p.waitForTimeout(300);
  checar((await contasGravadas(p)).length === 3, 'editar não criou uma conta a mais');
  checar((await contasGravadas(p)).find(c => c.descricao === 'Aluguel do galpão').valor === 2350,
    'o novo valor foi gravado');
  checar(await p.locator('#ctSecundarios').isHidden(), 'o formulário volta ao normal');

  await p.click('#contasLista .conta-item:has-text("Aluguel do galpão") .ct-editar');
  await p.waitForTimeout(300);
  await p.click('#ctCancelar');
  await p.waitForTimeout(250);
  checar((await p.inputValue('#ctDescricao')) === '', 'cancelar limpa o formulário');

  // ---------- 10. repetir no próximo mês ----------
  console.log('\n[10] Repetir no próximo mês');
  const antes = (await contasGravadas(p)).length;
  await p.click('#contasLista .conta-item:has-text("Aluguel do galpão") .ct-repetir');
  await p.waitForTimeout(350);
  contas = await contasGravadas(p);
  checar(contas.length === antes + 1, 'criou a conta do mês seguinte');
  const copias = contas.filter(c => c.descricao === 'Aluguel do galpão');
  const original = copias.find(c => c.vencimento === emDias(-3));
  const copia = copias.find(c => c !== original);
  const mesDe = v => Number(v.slice(5, 7));
  checar(mesDe(copia.vencimento) === (mesDe(original.vencimento) % 12) + 1,
    `caiu no mês seguinte (${original.vencimento} -> ${copia.vencimento})`);
  checar(copia.valor === original.valor && copia.categoria === original.categoria,
    'a cópia veio com valor e categoria iguais');
  checar(copia.pago === false, 'a cópia nasce em aberto');

  avisos.length = 0;
  await p.click('#contasLista .conta-item:has-text("Aluguel do galpão") .ct-repetir');
  await p.waitForTimeout(350);
  checar((await contasGravadas(p)).length === antes + 1,
    'não duplica quando a conta do mês seguinte já existe');
  checar(avisos.some(a => /já existe/i.test(a)), 'avisa que já existe');

  /* 31 de janeiro não pode virar 31 de fevereiro (o JavaScript joga
     para março sozinho se ninguém segurar) */
  const virada = await p.evaluate(() => {
    const casos = [['2026-01-31', '2026-02-28'], ['2028-01-31', '2028-02-29'],
                   ['2026-03-31', '2026-04-30'], ['2026-12-15', '2027-01-15']];
    const antesDeTudo = lerContas();
    const saida = [];
    for (const [de, esperado] of casos) {
      gravarContas([{ id: 'teste', descricao: 'Virada de mês', valor: 10,
                      vencimento: de, pago: false }]);
      repetirNoProximoMes('teste');
      const nova = lerContas().find(c => c.id !== 'teste');
      saida.push({ de, esperado, deu: nova ? nova.vencimento : null });
    }
    gravarContas(antesDeTudo);
    renderContas();
    return saida;
  });
  for (const v of virada) {
    checar(v.deu === v.esperado, `${v.de} repete em ${v.esperado} (deu ${v.deu})`);
  }

  // ---------- 11. backup ----------
  console.log('\n[11] As contas vão no backup');
  const backup = await p.evaluate(() => conteudoDoBackup());
  const lido = JSON.parse(backup);
  checar(Array.isArray(lido.contas) && lido.contas.length === antes + 1,
    `o backup leva as contas (${lido.contas && lido.contas.length})`);

  const voltou = await p.evaluate(texto => {
    const guardadas = lerContas();
    localStorage.removeItem('beccaGesso.contas.v1');
    restaurarDoTexto(texto);
    const depois = lerContas();
    return { quantas: depois.length, iguais:
      JSON.stringify(depois.map(c => c.id).sort()) ===
      JSON.stringify(guardadas.map(c => c.id).sort()) };
  }, backup);
  checar(voltou.quantas === antes + 1 && voltou.iguais,
    'restaurar o backup traz as contas de volta');

  /* restaurar duas vezes não pode duplicar nada */
  await p.evaluate(texto => restaurarDoTexto(texto), backup);
  checar((await contasGravadas(p)).length === antes + 1,
    'restaurar o mesmo backup de novo não duplica');

  /* um backup antigo não pode desfazer o que foi mexido depois */
  const preservou = await p.evaluate(texto => {
    const lista = lerContas();
    lista[0].valor = 9999;
    lista[0].atualizadoEm = Date.now() + 1000;
    gravarContas(lista);
    const id = lista[0].id;
    restaurarDoTexto(texto);
    return lerContas().find(c => c.id === id).valor;
  }, backup);
  checar(preservou === 9999, 'backup antigo não sobrescreve a versão mais nova');

  // ---------- 12. excluir ----------
  console.log('\n[12] Excluir');
  const quantasAntes = (await contasGravadas(p)).length;
  await p.evaluate(() => { window.__confirma = false; });
  p.removeAllListeners('dialog');
  p.on('dialog', d => { avisos.push(d.message()); d.dismiss(); });
  await p.click('#contasLista .conta-item:has-text("Placas de gesso") .ct-excluir');
  await p.waitForTimeout(300);
  checar((await contasGravadas(p)).length === quantasAntes,
    'não exclui se a confirmação for recusada');

  p.removeAllListeners('dialog');
  p.on('dialog', d => { avisos.push(d.message()); d.accept(); });
  await p.click('#contasLista .conta-item:has-text("Placas de gesso") .ct-excluir');
  await p.waitForTimeout(300);
  checar((await contasGravadas(p)).length === quantasAntes - 1, 'exclui quando confirmado');
  checar(!(await descricoesVisiveis(p)).some(d => d.includes('Placas de gesso')),
    'a conta some da lista');

  // ---------- 13. as contas atravessam o fechar e abrir ----------
  console.log('\n[13] As contas continuam depois de fechar o app');
  const fotoAntes = await contasGravadas(p);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  checar(JSON.stringify(await contasGravadas(p)) === JSON.stringify(fotoAntes),
    'as contas continuam iguais depois de reabrir');
  checar((await descricoesVisiveis(p)).length === fotoAntes.length,
    'a lista aparece sozinha ao abrir a seção');

  // ---------- 14. o orçamento não foi afetado ----------
  console.log('\n[14] A seção de orçamentos continua inteira');
  await p.click('.secao-btn[data-secao="orcamentos"]');
  await p.waitForTimeout(250);
  await p.fill('#cliNome', 'Construtora Alvorada Ltda');
  await p.fill('.s-desc', 'Forro de gesso liso');
  await p.fill('.s-qtd', '38,5');
  await p.fill('.s-valor', '92,50');
  await p.waitForTimeout(600);
  checar(semNbsp(await p.textContent('#totTotal')).includes('3.561,25'),
    `o orçamento continua calculando (${await p.textContent('#totTotal')})`);
  const pdf = await p.evaluate(() => pdfDoOrcamento().size);
  checar(pdf > 40000, `o PDF continua sendo gerado (${(pdf / 1024).toFixed(0)} KB)`);

  checar(erros.length === 0,
    `sem erros de JavaScript ${erros.length ? '-> ' + erros.join(' | ') : ''}`);

  await browser.close();
  srv.close();
  console.log(falhas.length ? `\nFALHAS: ${falhas.length}` : '\nContas a pagar OK');
  process.exit(falhas.length ? 1 : 0);
})();
