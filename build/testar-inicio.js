/* Testa a tela de início: os números dos cartões, as listas do que precisa
   de atenção, os atalhos para as outras seções e o que fica de fora. */
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

/* Intl usa espaço fixo depois do "R$" */
const semNbsp = t => String(t).replace(/ /g, ' ');

function emDias(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* Escreve histórico e contas direto no armazenamento: o que interessa
   aqui é o resumo, não o caminho de digitação (já coberto nas outras
   baterias). */
async function semear(p, { historico, contas }) {
  await p.evaluate(({ h, c }) => {
    gravarHistorico(h);
    gravarContas(c);
  }, { h: historico || [], c: contas || [] });
}

const cartoes = (p, id) => p.evaluate(alvo =>
  [...document.querySelectorAll('#' + alvo + ' .cartao')].map(b => ({
    rot: b.querySelector('.cartao-rot').textContent.trim(),
    valor: b.querySelector('.cartao-val').textContent.trim(),
    sub: b.querySelector('.cartao-sub').textContent.trim(),
    tom: b.className.replace('cartao', '').trim(),
  })), id);

const linhas = (p, id) => p.evaluate(alvo =>
  [...document.querySelectorAll('#' + alvo + ' .mini-item')].map(n => ({
    nome: n.querySelector('.mini-nome').textContent.trim(),
    valor: n.querySelector('.mini-valor').textContent.trim(),
    sub: n.querySelector('.mini-sub').textContent.trim(),
  })), id);

const orc = (numero, data, total, situacao, extra) => Object.assign({
  orcNumero: numero, orcData: data, cliNome: 'Cliente ' + numero,
  total: total, situacao: situacao, servicos: [], atualizadoEm: Date.now(),
}, extra || {});

const conta = (id, valor, vencimento, extra) => Object.assign({
  id: id, descricao: 'Conta ' + id, valor: valor, vencimento: vencimento,
  pago: false, pagoEm: null, atualizadoEm: Date.now(),
}, extra || {});

(async () => {
  const srv = await servidor();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));
  p.on('dialog', d => d.accept());
  await p.goto(`${base}/index.html`, { waitUntil: 'networkidle' });

  const mes = emDias(0).slice(0, 7);
  const ano = emDias(0).slice(0, 4);

  // ---------- 1. o app abre no início ----------
  console.log('\n[1] O app abre no início');
  checar(await p.locator('#secaoInicio').isVisible(), 'a tela de início é a primeira');
  checar(await p.locator('#secaoOrcamentos').isHidden(), 'os orçamentos ficam guardados');
  checar(await p.locator('.secao-btn[data-secao="inicio"]').getAttribute('aria-current') === 'page',
    'o botão de início vem marcado');

  // ---------- 2. sem nada guardado ----------
  console.log('\n[2] Sem nada guardado');
  checar(await p.locator('#blocoVazio').isVisible(), 'avisa que não há nada para resumir');
  checar(await p.locator('#blocoOrc').isHidden(), 'não mostra cartões vazios de orçamento');
  checar(await p.locator('#blocoContas').isHidden(), 'não mostra cartões vazios de conta');
  checar(await p.locator('#blocoVencendo').isHidden(), 'não mostra lista de vencimento');
  checar(await p.locator('#blocoUltimos').isHidden(), 'não mostra últimos orçamentos');
  /* backup, mensagens e senha moram no histórico: sem este atalho não
     haveria como chegar neles a partir do início */
  checar(await p.locator('.inicio-atalhos [data-acao="hist:"]').isVisible(),
    'o atalho do histórico aparece mesmo sem nada guardado');
  await p.click('.inicio-atalhos [data-acao="hist:"]');
  await p.waitForTimeout(350);
  checar(await p.locator('#painelHist').isVisible(), 'e abre o histórico');
  checar(await p.locator('#backupBtn').isVisible(), 'de onde se chega ao backup');
  checar(await p.locator('#acessoBtn').isVisible(), 'e à tela de senha');
  await p.click('#histFechar');
  await p.waitForTimeout(300);

  // ---------- 3. números dos orçamentos ----------
  console.log('\n[3] Números dos orçamentos');
  await semear(p, {
    historico: [
      orc('0004/' + ano, `${mes}-05`, 1000, 'rascunho'),
      orc('0003/' + ano, `${mes}-04`, 2000, 'aprovado'),
      orc('0002/' + ano, `${mes}-03`, 4000, 'enviado',
        { cliTelefone: '14997577371', enviadoEm: Date.now() - 6 * 86400000 }),
      orc('0001/' + ano, `${mes}-02`, 500, 'recusado'),
      /* de um mês que já passou: entra no ano, não no mês */
      orc('0009/' + ano, `${ano}-01-15`, 7000, 'aprovado'),
      /* de outro ano: fica de fora dos dois */
      orc('0008/2019', '2019-06-10', 90000, 'aprovado'),
    ],
    contas: [],
  });
  await p.evaluate(() => renderInicio());
  await p.waitForTimeout(200);

  checar(await p.locator('#blocoVazio').isHidden(), 'o aviso de vazio some quando há dados');
  const co = await cartoes(p, 'cartoesOrc');
  const acharC = (lista, texto) => lista.find(x => x.rot.toLowerCase().includes(texto));
  const feitos = acharC(co, 'feitos');
  checar(semNbsp(feitos.valor) === 'R$ 7.500,00',
    `feitos no mês soma só o mês corrente (${semNbsp(feitos.valor)})`);
  checar(feitos.sub === '4 orçamentos', `conta os do mês (${feitos.sub})`);

  const aprov = acharC(co, 'aprovados');
  checar(semNbsp(aprov.valor) === 'R$ 2.000,00',
    `aprovados no mês (${semNbsp(aprov.valor)})`);
  checar(aprov.tom === 'bom', 'aprovado ganha o tom verde');

  const aguard = acharC(co, 'aguardando');
  checar(semNbsp(aguard.valor) === 'R$ 4.000,00',
    `aguardando resposta (${semNbsp(aguard.valor)})`);
  checar(aguard.sub === '1 enviado', `no singular quando é um só (${aguard.sub})`);
  checar(aguard.tom === 'atencao', 'aguardando ganha o tom de atenção');

  const rodape = semNbsp(await p.textContent('#anoOrc'));
  checar(rodape.includes('5 orçamentos'), `o ano conta os cinco deste ano (${rodape})`);
  checar(rodape.includes('R$ 14.500,00'), 'o ano soma tudo deste ano');
  checar(rodape.includes('R$ 9.000,00'), 'o ano soma os aprovados à parte');
  checar(!rodape.includes('90.000'), 'o orçamento de outro ano fica de fora');

  // ---------- 4. números das contas ----------
  console.log('\n[4] Números das contas');
  await semear(p, {
    historico: await p.evaluate(() => lerHistorico()),
    contas: [
      conta('a', 100, emDias(-4)),                   /* vencida */
      conta('b', 200, emDias(-1)),                   /* vencida */
      conta('c', 300, emDias(0)),                    /* vence hoje */
      conta('d', 400, emDias(7)),                    /* último dia do prazo */
      conta('e', 800, emDias(8)),                    /* fora do prazo */
      conta('f', 50, emDias(-30), {pago: true, pagoEm: `${mes}-02`}),
      conta('g', 60, emDias(-2), {pago: true, pagoEm: '2019-01-05'}),
    ],
  });
  await p.evaluate(() => renderInicio());
  await p.waitForTimeout(200);

  const cc = await cartoes(p, 'cartoesContas');
  const venc = acharC(cc, 'vencidas');
  checar(semNbsp(venc.valor) === 'R$ 300,00', `vencidas soma as duas (${semNbsp(venc.valor)})`);
  checar(venc.tom === 'alerta', 'vencidas ganha o tom vermelho');

  const semana = acharC(cc, 'vence em');
  /* o dia 7 conta, o dia 8 não; e o que já venceu não entra aqui de novo */
  checar(semNbsp(semana.valor) === 'R$ 700,00',
    `vence em 7 dias pega hoje e o sétimo dia, e para aí (${semNbsp(semana.valor)})`);
  checar(semana.sub === '2 contas', `conta certo (${semana.sub})`);

  const pagas = acharC(cc, 'pagas');
  checar(semNbsp(pagas.valor) === 'R$ 50,00',
    `pagas no mês ignora as pagas em outro mês (${semNbsp(pagas.valor)})`);

  const rodapeC = semNbsp(await p.textContent('#anoContas'));
  checar(rodapeC.includes('R$ 1.800,00'), `em aberto soma tudo que falta pagar (${rodapeC})`);
  checar(rodapeC.includes('5 contas'), 'em aberto conta só as não pagas');

  // ---------- 5. lista do que está vencendo ----------
  console.log('\n[5] Vencendo agora');
  checar(await p.locator('#blocoVencendo').isVisible(), 'a lista aparece');
  let venc5 = await linhas(p, 'listaVencendo');
  checar(venc5.length === 4, `mostra as quatro dentro do prazo (${venc5.length})`);
  checar(venc5.map(x => x.nome).join() === 'Conta a,Conta b,Conta c,Conta d',
    `da mais atrasada para a mais distante (${venc5.map(x => x.nome).join()})`);
  checar(venc5[0].sub.includes('venceu há 4 dias'), `diz há quanto venceu (${venc5[0].sub})`);
  checar(venc5[2].sub.includes('vence hoje'), `marca a de hoje (${venc5[2].sub})`);
  checar(venc5[3].sub.includes('vence em 7 dias'), `diz quanto falta (${venc5[3].sub})`);
  checar(!venc5.some(x => x.nome === 'Conta e'), 'a de daqui a 8 dias fica de fora');
  checar(!venc5.some(x => x.nome === 'Conta g'), 'conta já paga não aparece');

  // ---------- 6. marcar paga direto do início ----------
  console.log('\n[6] Marcar paga sem sair da tela');
  await p.click('#listaVencendo .mini-item:has-text("Conta a") .ini-pagar');
  await p.waitForTimeout(300);
  venc5 = await linhas(p, 'listaVencendo');
  checar(!venc5.some(x => x.nome === 'Conta a'), 'a conta paga sai da lista na hora');
  const ccDepois = await cartoes(p, 'cartoesContas');
  checar(semNbsp(acharC(ccDepois, 'vencidas').valor) === 'R$ 200,00',
    `o cartão de vencidas acompanha (${semNbsp(acharC(ccDepois, 'vencidas').valor)})`);
  checar(semNbsp(acharC(ccDepois, 'pagas').valor) === 'R$ 150,00',
    'o cartão de pagas no mês acompanha');
  checar((await p.evaluate(() => lerContas().find(c => c.id === 'a'))).pago === true,
    'o pagamento ficou gravado de verdade');

  // ---------- 7. "e mais N" quando passa de cinco ----------
  console.log('\n[7] Quando há muitas vencendo');
  await semear(p, {
    historico: await p.evaluate(() => lerHistorico()),
    contas: [1, 2, 3, 4, 5, 6, 7].map(n => conta('x' + n, 100 * n, emDias(n - 4))),
  });
  await p.evaluate(() => renderInicio());
  await p.waitForTimeout(200);
  checar((await linhas(p, 'listaVencendo')).length === 5,
    'mostra no máximo cinco de uma vez');
  const restam = await p.textContent('#listaVencendo .mini-restam');
  checar(restam.includes('mais 2 contas'), `avisa quantas ficaram (${restam})`);

  // ---------- 8. retornos pendentes ----------
  console.log('\n[8] Para dar retorno');
  checar(await p.locator('#blocoRetornos').isVisible(),
    'o orçamento enviado há 6 dias pede retorno');
  const ret = await linhas(p, 'listaRetornos');
  checar(ret.length === 1 && ret[0].sub.includes('enviado há 6 dias'),
    `mostra há quanto foi enviado (${ret[0] && ret[0].sub})`);
  checar(semNbsp(ret[0].valor) === 'R$ 4.000,00', 'traz o valor do orçamento');

  // ---------- 9. últimos orçamentos ----------
  console.log('\n[9] Últimos orçamentos');
  const ult = await linhas(p, 'listaUltimos');
  checar(ult.length === 5, `mostra no máximo cinco (${ult.length})`);
  checar(ult[0].nome === 'Cliente 0004/' + ano,
    `o mais recente primeiro (${ult[0].nome})`);
  checar(ult[1].sub.includes('Aprovado'), `mostra a situação (${ult[1].sub})`);
  checar(ult[0].sub.includes('0004/' + ano), 'mostra o número do orçamento');

  await p.click('#listaUltimos .mini-item:has-text("Cliente 0003") .ini-abrir');
  await p.waitForTimeout(400);
  checar(await p.locator('#secaoOrcamentos').isVisible(),
    'abrir um orçamento leva para a seção de orçamentos');
  checar((await p.inputValue('#orcNumero')) === '0003/' + ano,
    `carregou o orçamento certo (${await p.inputValue('#orcNumero')})`);

  // ---------- 10. atalhos dos cartões ----------
  console.log('\n[10] Os cartões levam ao lugar certo');
  await p.click('.secao-btn[data-secao="inicio"]');
  await p.waitForTimeout(300);
  await p.click('#cartoesContas .cartao[data-acao="contas:vencidas"]');
  await p.waitForTimeout(350);
  checar(await p.locator('#secaoContas').isVisible(),
    'o cartão de vencidas abre as contas a pagar');
  checar(await p.evaluate(() => filtroContas) === 'vencidas',
    'já chega filtrado pelas vencidas');
  const soVencidas = await p.evaluate(() =>
    [...document.querySelectorAll('#contasLista .conta-item')]
      .every(n => n.classList.contains('vencida')));
  checar(soVencidas, 'a lista mostra só as vencidas');

  await p.click('.secao-btn[data-secao="inicio"]');
  await p.waitForTimeout(300);
  await p.click('#cartoesOrc .cartao[data-acao="hist:aprovado"]');
  await p.waitForTimeout(350);
  checar(await p.locator('#painelHist').isVisible(),
    'o cartão de aprovados abre o histórico');
  checar(await p.evaluate(() => filtroSituacao) === 'aprovado',
    'já chega filtrado pelos aprovados');
  await p.click('#histFechar');
  await p.waitForTimeout(300);
  checar(await p.locator('#secaoInicio').isVisible(),
    'fechar o histórico devolve para o início');

  // ---------- 11. a seção escolhida é lembrada ----------
  console.log('\n[11] O app lembra onde você estava');
  await p.click('.secao-btn[data-secao="contas"]');
  await p.waitForTimeout(250);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(450);
  checar(await p.locator('#secaoContas').isVisible(), 'reabre nas contas');
  await p.click('.secao-btn[data-secao="inicio"]');
  await p.waitForTimeout(250);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(450);
  checar(await p.locator('#secaoInicio').isVisible(), 'reabre no início');

  // ---------- 12. o início não vai para o papel ----------
  console.log('\n[12] Impressão');
  await p.emulateMedia({ media: 'print' });
  const naImpressao = await p.evaluate(() => ({
    inicio: !!document.querySelector('#secaoInicio').offsetParent,
    nav: !!document.querySelector('.secoes').offsetParent,
    doc: !!document.querySelector('.doc').offsetParent,
  }));
  checar(!naImpressao.inicio, 'a tela de início não sai impressa');
  checar(!naImpressao.nav, 'os botões de seção não saem impressos');
  checar(naImpressao.doc, 'o orçamento sai impresso mesmo com o início aberto');
  await p.emulateMedia({ media: 'screen' });

  checar(erros.length === 0,
    `sem erros de JavaScript ${erros.length ? '-> ' + erros.join(' | ') : ''}`);

  await browser.close();
  srv.close();
  console.log(falhas.length ? `\nFALHAS: ${falhas.length}` : '\nTela de início OK');
  process.exit(falhas.length ? 1 : 0);
})();
