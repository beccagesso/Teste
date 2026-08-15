/* Testa a tela de início: a saudação, o cartão de destaque com a
   tendência e o gráfico, os indicadores, as três listas do que precisa
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

/* Intl usa espaço fixo (U+00A0) depois do "R$" — comparar sem normalizar
   dá falha por um caractere invisível */
const semNbsp = t => String(t).replace(/\u00a0/g, ' ');

function emDias(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* mês corrente e mês anterior no formato 'YYYY-MM', do jeito que o app
   soma o histórico por mês */
function mesISO(deltaMeses) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + (deltaMeses || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* Escreve histórico e contas direto no armazenamento: o que interessa
   aqui é o resumo, não o caminho de digitação (já coberto nas outras
   baterias). */
async function semear(p, { historico, contas }) {
  await p.evaluate(({ h, c }) => {
    gravarHistorico(h);
    gravarContas(c);
    renderInicio();
  }, { h: historico || [], c: contas || [] });
}

const chips = (p, id) => p.evaluate(alvo =>
  [...document.querySelectorAll('#' + alvo + ' .chip')].map(b => ({
    rot: b.querySelector('.chip-rot').textContent.trim(),
    valor: b.querySelector('.chip-val').textContent.trim(),
    sub: b.querySelector('.chip-sub').textContent.trim(),
    tom: b.querySelector('.chip-icone').className.replace('chip-icone', '').trim(),
  })), id);

const linhas = (p, id) => p.evaluate(alvo =>
  [...document.querySelectorAll('#' + alvo + ' .linha')].map(n => ({
    nome: n.querySelector('.linha-nome').textContent.trim(),
    valor: n.querySelector('.linha-valor').textContent.trim(),
    sub: n.querySelector('.linha-sub').textContent.trim(),
  })), id);

const nomesDe = (p, id) => p.evaluate(alvo =>
  [...document.querySelectorAll('#' + alvo + ' .linha-nome')].map(n => n.textContent.trim()), id);

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
  /* estes testes são de outra parte do app; desligar a nuvem
     evita que a tela de login do Supabase (ligada por padrão)
     atrapalhe */
  await ctx.addInitScript(() => localStorage.setItem('beccaGesso.nuvemDesligada.v1', 'true'));
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));
  p.on('dialog', d => d.accept());
  await p.goto(`${base}/index.html`, { waitUntil: 'networkidle' });

  const mes = mesISO(0);
  const ano = mes.slice(0, 4);

  // ---------- 1. o app abre no início ----------
  console.log('\n[1] O app abre no início');
  checar(await p.locator('#secaoInicio').isVisible(), 'a tela de início é a primeira');
  checar(await p.locator('#secaoOrcamentos').isHidden(), 'os orçamentos ficam guardados');
  checar(await p.locator('.secao-btn[data-secao="inicio"]').getAttribute('aria-current') === 'page',
    'o botão de início vem marcado');

  // ---------- 2. sem nada guardado ----------
  console.log('\n[2] Sem nada guardado');
  checar(await p.locator('#blocoVazio').isVisible(), 'avisa que não há nada para resumir');
  checar(await p.locator('#grupoOrc').isHidden(), 'não mostra o cartão de destaque vazio');
  checar(await p.locator('#grupoContas').isHidden(), 'não mostra os indicadores de conta vazios');
  checar(await p.locator('#blocoVencendo').isHidden(), 'não mostra lista de vencimento');
  checar(await p.locator('#blocoUltimos').isHidden(), 'não mostra últimos orçamentos');

  const saudacao = await p.textContent('#saudacaoOla');
  checar(/^(Bom dia|Boa tarde|Boa noite), Becca\.$/.test(saudacao.trim()),
    `a saudação muda com a hora do dia (${saudacao})`);
  const dataTexto = await p.textContent('#saudacaoData');
  checar(dataTexto.includes(','), `mostra o dia da semana e a data (${dataTexto})`);

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

  // ---------- 3. o cartão de destaque e os indicadores dos orçamentos ----------
  console.log('\n[3] Cartão de destaque e indicadores dos orçamentos');
  await semear(p, {
    historico: [
      orc('0004/' + ano, `${mes}-05`, 1000, 'rascunho'),
      orc('0003/' + ano, `${mes}-04`, 2000, 'aprovado'),
      orc('0002/' + ano, `${mes}-03`, 4000, 'enviado',
        { cliTelefone: '14997577371', enviadoEm: Date.now() - 6 * 86400000 }),
      orc('0001/' + ano, `${mes}-02`, 500, 'recusado'),
      /* de um mês que já passou (mas não o anterior): entra no ano, não no mês */
      orc('0009/' + ano, `${ano}-01-15`, 7000, 'aprovado'),
      /* de outro ano: fica de fora dos dois */
      orc('0008/2019', '2019-06-10', 90000, 'aprovado'),
    ],
    contas: [],
  });

  checar(await p.locator('#blocoVazio').isHidden(), 'o aviso de vazio some quando há dados');
  checar(await p.locator('#grupoOrc').isVisible(), 'o cartão de destaque aparece');

  const heroMes = await p.textContent('#heroMes');
  const mesEsperado = new Date().toLocaleDateString('pt-BR', { month: 'long' });
  checar(heroMes.trim() === mesEsperado, `mostra o mês corrente (${heroMes})`);

  const heroVal = semNbsp(await p.textContent('#heroVal'));
  checar(heroVal === 'R$ 7.500,00',
    `o cartão de destaque soma só o mês corrente (${heroVal})`);

  const heroSub = await p.textContent('#heroSub');
  checar(heroSub.includes('4 orçamentos'), `conta os orçamentos do mês (${heroSub})`);

  const co = await chips(p, 'chipsOrc');
  checar(co.length === 2, `só dois indicadores de orçamento — feitos virou o cartão (${co.length})`);
  const acharC = (lista, texto) => lista.find(x => x.rot.toLowerCase().includes(texto));

  const aprov = acharC(co, 'aprovados');
  checar(semNbsp(aprov.valor) === 'R$ 2.000,00', `aprovados no mês (${semNbsp(aprov.valor)})`);
  checar(aprov.tom === 'bom', 'aprovado ganha o tom verde');

  const aguard = acharC(co, 'aguardando');
  checar(semNbsp(aguard.valor) === 'R$ 4.000,00', `aguardando resposta (${semNbsp(aguard.valor)})`);
  checar(aguard.sub === '1 enviado', `no singular quando é um só (${aguard.sub})`);
  checar(aguard.tom === 'atencao', 'aguardando ganha o tom de atenção');

  const rodape = semNbsp(await p.textContent('#anoOrc'));
  checar(rodape.includes('5 orçamentos'), `o ano conta os cinco deste ano (${rodape})`);
  checar(rodape.includes('R$ 14.500,00'), 'o ano soma tudo deste ano');
  checar(rodape.includes('R$ 9.000,00'), 'o ano soma os aprovados à parte');
  checar(!rodape.includes('90.000'), 'o orçamento de outro ano fica de fora');

  // ---------- 4. a tendência do cartão de destaque ----------
  console.log('\n[4] Tendência do cartão de destaque');

  await semear(p, {
    historico: [
      orc('0002/' + ano, emDias(0), 9000, 'rascunho'),
      orc('0001/' + ano, `${mesISO(-1)}-15`, 3000, 'aprovado'),
    ],
    contas: [],
  });
  let sub = await p.textContent('#heroSub');
  checar(/↑\s*200% que/.test(sub), `sobe 200% quando triplica (${sub})`);
  checar(!sub.toLowerCase().includes('↓'), 'a seta é para cima numa alta');

  await semear(p, {
    historico: [
      orc('0002/' + ano, emDias(0), 1500, 'rascunho'),
      orc('0001/' + ano, `${mesISO(-1)}-15`, 8000, 'aprovado'),
    ],
    contas: [],
  });
  sub = await p.textContent('#heroSub');
  checar(/↓\s*81% que/.test(sub), `cai quando o mês está mais fraco (${sub})`);
  const corBaixa = await p.evaluate(() =>
    document.querySelector('#heroSub .trend').className.includes('baixa'));
  checar(corBaixa, 'a queda ganha um tom diferente da alta');

  /* sem nada no mês anterior não há com o que comparar */
  await semear(p, {
    historico: [orc('0001/' + ano, emDias(0), 5000, 'rascunho')],
    contas: [],
  });
  sub = await p.textContent('#heroSub');
  checar(!sub.includes('%'), `sem mês anterior, não inventa comparação (${sub})`);

  /* sem orçamento nenhum, mesmo assim não quebra */
  await semear(p, { historico: [], contas: [] });
  checar(await p.locator('#grupoOrc').isHidden(), 'sem nada, o cartão de destaque some de novo');

  // ---------- 5. o gráfico dos últimos meses ----------
  console.log('\n[5] O gráfico dos últimos meses');
  await semear(p, {
    historico: [
      orc('0003/' + ano, emDias(0), 6000, 'rascunho'),
      orc('0002/' + ano, `${mesISO(-1)}-10`, 2000, 'aprovado'),
      orc('0001/' + ano, `${mesISO(-3)}-10`, 4000, 'aprovado'),
    ],
    contas: [],
  });
  const spark = await p.evaluate(() => {
    const linha = document.getElementById('heroSparkLinha');
    const ponto = document.getElementById('heroSparkPonto');
    return {
      pontos: linha.getAttribute('points').trim().split(/\s+/),
      cx: Number(ponto.getAttribute('cx')),
      cy: Number(ponto.getAttribute('cy')),
    };
  });
  checar(spark.pontos.length === 6, `a linha tem os 6 meses (${spark.pontos.length})`);
  const ultimoPonto = spark.pontos[5].split(',').map(Number);
  checar(Math.abs(spark.cx - ultimoPonto[0]) < 0.5 && Math.abs(spark.cy - ultimoPonto[1]) < 0.5,
    'a bolinha fica em cima do último ponto da linha');

  /* todo mês com o mesmo total (aqui, todos zerados) não pode dar
     divisão por zero — a linha tem de sair reta, não NaN */
  await semear(p, { historico: [], contas: [conta('c1', 10, emDias(5))] });
  const planaOk = await p.evaluate(() => {
    const pontos = document.getElementById('heroSparkLinha').getAttribute('points');
    return !pontos.includes('NaN') && pontos.trim().length > 0;
  });
  checar(planaOk, 'com tudo zerado a linha fica reta, sem NaN');

  // ---------- 6. indicadores das contas ----------
  console.log('\n[6] Indicadores das contas');
  await semear(p, {
    historico: [],
    contas: [
      conta('a', 100, emDias(-4)),                   /* vencida */
      conta('b', 200, emDias(-1)),                   /* vencida */
      conta('c', 300, emDias(0)),                    /* vence hoje */
      conta('d', 400, emDias(7)),                    /* último dia do prazo */
      conta('e', 800, emDias(8)),                    /* fora do prazo */
      conta('f', 50, emDias(-30), { pago: true, pagoEm: `${mes}-02` }),
      conta('g', 60, emDias(-2), { pago: true, pagoEm: '2019-01-05' }),
    ],
  });

  checar(await p.locator('#grupoContas').isVisible(), 'os indicadores de conta aparecem');
  const cc = await chips(p, 'chipsContas');
  checar(cc.length === 3, `três indicadores de conta (${cc.length})`);

  const venc = acharC(cc, 'vencidas');
  checar(semNbsp(venc.valor) === 'R$ 300,00', `vencidas soma as duas (${semNbsp(venc.valor)})`);
  checar(venc.tom === 'alerta', 'vencidas ganha o tom vermelho');

  const semana = acharC(cc, 'vence em');
  checar(semNbsp(semana.valor) === 'R$ 700,00',
    `vence em 7 dias pega hoje e o sétimo dia, e para aí (${semNbsp(semana.valor)})`);
  checar(semana.sub === '2 contas', `conta certo (${semana.sub})`);

  const pagas = acharC(cc, 'pagas');
  checar(semNbsp(pagas.valor) === 'R$ 50,00',
    `pagas no mês ignora as pagas em outro mês (${semNbsp(pagas.valor)})`);

  const rodapeC = semNbsp(await p.textContent('#anoContas'));
  checar(rodapeC.includes('R$ 1.800,00'), `em aberto soma tudo que falta pagar (${rodapeC})`);
  checar(rodapeC.includes('5 contas'), 'em aberto conta só as não pagas');

  // ---------- 7. vencendo agora ----------
  console.log('\n[7] Vencendo agora');
  checar(await p.locator('#blocoVencendo').isVisible(), 'a lista aparece');
  let venc7 = await linhas(p, 'listaVencendo');
  checar(venc7.length === 4, `mostra as quatro dentro do prazo (${venc7.length})`);
  checar(venc7.map(x => x.nome).join() === 'Conta a,Conta b,Conta c,Conta d',
    `da mais atrasada para a mais distante (${venc7.map(x => x.nome).join()})`);
  checar(venc7[0].sub.includes('venceu há 4 dias'), `diz há quanto venceu (${venc7[0].sub})`);
  checar(venc7[2].sub.includes('vence hoje'), `marca a de hoje (${venc7[2].sub})`);
  checar(venc7[3].sub.includes('vence em 7 dias'), `diz quanto falta (${venc7[3].sub})`);
  checar(!venc7.some(x => x.nome === 'Conta e'), 'a de daqui a 8 dias fica de fora');
  checar(!venc7.some(x => x.nome === 'Conta g'), 'conta já paga não aparece');

  const classes = await p.evaluate(() =>
    [...document.querySelectorAll('#listaVencendo .linha-icone')].map(n => n.className));
  checar(classes[0].includes('vencida') && classes[2].includes('hoje') && classes[3].includes('avencer'),
    `o ícone muda de cor conforme a urgência (${classes.join(' | ')})`);

  const botaoPagar = await p.evaluate(() =>
    document.querySelector('#listaVencendo .ini-pagar').getAttribute('aria-label'));
  checar(botaoPagar.includes('Conta a'), `o botão redondo explica a ação para quem usa leitor de tela (${botaoPagar})`);

  // ---------- 8. marcar paga sem sair do início ----------
  console.log('\n[8] Marcar paga sem sair do início');
  await p.click('#listaVencendo .linha:has-text("Conta a") .ini-pagar');
  await p.waitForTimeout(300);
  venc7 = await linhas(p, 'listaVencendo');
  checar(!venc7.some(x => x.nome === 'Conta a'), 'a conta paga sai da lista na hora');
  const ccDepois = await chips(p, 'chipsContas');
  checar(semNbsp(acharC(ccDepois, 'vencidas').valor) === 'R$ 200,00',
    `o indicador de vencidas acompanha (${semNbsp(acharC(ccDepois, 'vencidas').valor)})`);
  checar((await p.evaluate(() => lerContas().find(c => c.id === 'a'))).pago === true,
    'o pagamento ficou gravado de verdade');

  // ---------- 9. quando há muitas vencendo ----------
  console.log('\n[9] Quando há muitas vencendo');
  await semear(p, {
    historico: [],
    contas: [1, 2, 3, 4, 5, 6, 7].map(n => conta('x' + n, 100 * n, emDias(n - 4))),
  });
  checar((await linhas(p, 'listaVencendo')).length === 5, 'mostra no máximo cinco de uma vez');
  const restam = await p.textContent('#listaVencendo .linha-restam');
  checar(restam.includes('mais 2 contas'), `avisa quantas ficaram (${restam})`);

  // ---------- 10. para dar retorno ----------
  console.log('\n[10] Para dar retorno');
  await semear(p, {
    historico: [orc('0002/' + ano, emDias(0), 4000, 'enviado', {
      cliNome: 'Construtora Alvorada Ltda', cliTelefone: '14997577371',
      enviadoEm: Date.now() - 6 * 86400000,
    })],
    contas: [],
  });
  checar(await p.locator('#blocoRetornos').isVisible(),
    'o orçamento enviado há 6 dias pede retorno');
  const ret = await linhas(p, 'listaRetornos');
  checar(ret.length === 1 && ret[0].sub.includes('enviado há 6 dias'),
    `mostra há quanto foi enviado (${ret[0] && ret[0].sub})`);
  checar(semNbsp(ret[0].valor) === 'R$ 4.000,00', 'traz o valor do orçamento');

  const iniciais = await p.textContent('#listaRetornos .avatar');
  checar(iniciais.trim() === 'CA',
    `as iniciais ignoram o "Ltda" da razão social (${iniciais})`);

  const botaoZap = await p.evaluate(() =>
    document.querySelector('#listaRetornos .ini-msg').getAttribute('aria-label'));
  checar(botaoZap.includes('Construtora Alvorada Ltda'),
    `o botão do WhatsApp identifica o cliente para leitor de tela (${botaoZap})`);

  // ---------- 11. iniciais em outros formatos de nome ----------
  console.log('\n[11] Iniciais em outros formatos de nome');
  const casosIniciais = await p.evaluate(() => ([
    iniciaisDoNome('Rafael Moretti'),
    iniciaisDoNome('Ana'),
    iniciaisDoNome(''),
    iniciaisDoNome('  Edifício   Solar   das   Acácias  '),
    iniciaisDoNome('Gessos Bauru ME'),
  ]));
  checar(casosIniciais[0] === 'RM', `nome e sobrenome (${casosIniciais[0]})`);
  checar(casosIniciais[1] === 'AN', `uma palavra só usa as duas primeiras letras (${casosIniciais[1]})`);
  checar(casosIniciais[2] === '?', `nome vazio não quebra (${casosIniciais[2]})`);
  checar(casosIniciais[3] === 'EA', `espaços a mais não atrapalham (${casosIniciais[3]})`);
  checar(casosIniciais[4] === 'GB', `"ME" também é ignorado como sufixo (${casosIniciais[4]})`);

  /* guarda contra a regressão visual que já aconteceu antes: nome
     cortado com reticências em vez de quebrar linha */
  const naoTruncaNome = await p.evaluate(() => {
    const alvo = document.querySelector('.linha-nome') ||
      (() => { const d = document.createElement('div'); d.className = 'linha-nome';
                document.body.appendChild(d); return d; })();
    return getComputedStyle(alvo).whiteSpace !== 'nowrap';
  });
  checar(naoTruncaNome, 'o nome/descrição quebra linha em vez de cortar com reticências');

  // ---------- 12. últimos orçamentos ----------
  console.log('\n[12] Últimos orçamentos');
  await semear(p, {
    historico: [
      orc('0004/' + ano, emDias(0), 1000, 'rascunho'),
      orc('0003/' + ano, emDias(-1), 2000, 'aprovado'),
      orc('0002/' + ano, emDias(-2), 3000, 'enviado'),
      orc('0001/' + ano, emDias(-3), 4000, 'recusado'),
      orc('0000/' + ano, emDias(-4), 5000, 'rascunho'),
      orc('9999/' + ano, emDias(-5), 6000, 'rascunho'),
    ],
    contas: [],
  });
  const ult = await linhas(p, 'listaUltimos');
  checar(ult.length === 5, `mostra no máximo cinco (${ult.length})`);
  checar(ult[0].nome === 'Cliente 0004/' + ano, `o mais recente primeiro (${ult[0].nome})`);
  checar(ult[1].sub.includes('Aprovado'), `mostra a situação (${ult[1].sub})`);
  checar(ult[0].sub.includes('0004/' + ano), 'mostra o número do orçamento');

  const pontosStatus = await p.evaluate(() =>
    [...document.querySelectorAll('#listaUltimos .status-dot')].map(n => n.className));
  checar(pontosStatus[0].includes('rascunho') && pontosStatus[1].includes('aprovado') &&
    pontosStatus[2].includes('enviado') && pontosStatus[3].includes('recusado'),
    `cada situação tem sua cor (${pontosStatus.join(' | ')})`);

  await p.click('#listaUltimos .linha:has-text("Cliente 0003")');
  await p.waitForTimeout(400);
  checar(await p.locator('#secaoOrcamentos').isVisible(),
    'abrir um orçamento leva para a seção de orçamentos');
  checar((await p.inputValue('#orcNumero')) === '0003/' + ano,
    `carregou o orçamento certo (${await p.inputValue('#orcNumero')})`);

  // ---------- 13. os atalhos dos indicadores ----------
  console.log('\n[13] Os indicadores levam ao lugar certo');
  await p.click('.secao-btn[data-secao="inicio"]');
  await p.waitForTimeout(300);
  await semear(p, {
    historico: [orc('0001/' + ano, emDias(0), 1000, 'aprovado')],
    contas: [conta('a', 100, emDias(-1))],
  });
  await p.click('#chipsContas .chip[data-acao="contas:vencidas"]');
  await p.waitForTimeout(350);
  checar(await p.locator('#secaoContas').isVisible(),
    'o indicador de vencidas abre as contas a pagar');
  checar(await p.evaluate(() => filtroContas) === 'vencidas',
    'já chega filtrado pelas vencidas');

  await p.click('.secao-btn[data-secao="inicio"]');
  await p.waitForTimeout(300);
  await p.click('#chipsOrc .chip[data-acao="hist:aprovado"]');
  await p.waitForTimeout(350);
  checar(await p.locator('#painelHist').isVisible(),
    'o indicador de aprovados abre o histórico');
  checar(await p.evaluate(() => filtroSituacao) === 'aprovado',
    'já chega filtrado pelos aprovados');
  await p.click('#histFechar');
  await p.waitForTimeout(300);
  checar(await p.locator('#secaoInicio').isVisible(),
    'fechar o histórico devolve para o início');

  // ---------- 14. a seção escolhida é lembrada ----------
  console.log('\n[14] O app lembra onde você estava');
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

  // ---------- 15. o início não vai para o papel ----------
  console.log('\n[15] Impressão');
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
