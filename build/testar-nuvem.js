/* Testa a ligação com o Supabase contra um servidor de mentira
   (build/falso-supabase.js): login, sincronia nos dois sentidos,
   exclusão que não ressuscita, conflito entre dois aparelhos, e o que
   acontece sem internet. */
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

function servidorDoApp() {
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

const EMAIL = 'becca@exemplo.com';
const SENHA = 'gesso2026';

function emDias(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* Abre um "aparelho": um contexto de navegador próprio, com o seu
   próprio armazenamento — que é o que separa um celular de outro. */
async function aparelho(browser, baseApp, baseNuvem, chave, erros) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  p.on('pageerror', e => erros.push(String(e)));
  p.on('dialog', d => d.accept());
  await p.goto(`${baseApp}/index.html`, { waitUntil: 'networkidle' });
  await p.evaluate(([url, k]) => {
    localStorage.setItem('beccaGesso.nuvem.v1', JSON.stringify({ url, chave: k }));
  }, [baseNuvem, chave]);
  return { ctx, p };
}

/* recarrega mantendo o armazenamento — é o "fechar e abrir o app" */
async function reabrir(ctx, p, baseApp, erros) {
  await p.close();
  const nova = await ctx.newPage();
  nova.on('pageerror', e => erros.push(String(e)));
  nova.on('dialog', d => d.accept());
  await nova.goto(`${baseApp}/index.html`, { waitUntil: 'networkidle' });
  await nova.waitForTimeout(400);
  return nova;
}

async function entrar(p, email, senha) {
  await p.fill('#acUsuario', email === undefined ? EMAIL : email);
  await p.fill('#acSenha', senha === undefined ? SENHA : senha);
  await p.click('#acEntrar');
  await p.waitForTimeout(1400);
}

const sincronizar = p => p.evaluate(() => sincronizar({}));
const historico = p => p.evaluate(() => lerHistorico());
const contas = p => p.evaluate(() => lerContas());

/* grava um orçamento e uma conta direto no armazenamento do aparelho */
async function lancar(p, { orcamento, conta }) {
  await p.evaluate(({ o, c }) => {
    if (o) {
      const l = lerHistorico().filter(x => x.orcNumero !== o.orcNumero);
      l.unshift(o);
      gravarHistorico(l);
    }
    if (c) {
      const l = lerContas().filter(x => x.id !== c.id);
      l.push(c);
      gravarContas(l);
    }
  }, { o: orcamento || null, c: conta || null });
}

const orc = (numero, nome, total, quando) => ({
  orcNumero: numero, orcData: emDias(0), cliNome: nome, total: total,
  situacao: 'rascunho', servicos: [], atualizadoEm: quando || Date.now(),
});

const cta = (id, desc, valor, quando) => ({
  id: id, descricao: desc, valor: valor, vencimento: emDias(5),
  pago: false, pagoEm: null, atualizadoEm: quando || Date.now(),
});

(async () => {
  const srvApp = await servidorDoApp();
  const baseApp = `http://127.0.0.1:${srvApp.address().port}`;

  const nuvem = falso.criar({ usuarios: { [EMAIL]: SENHA } });
  await new Promise(k => nuvem.servidor.listen(0, '127.0.0.1', k));
  const baseNuvem = `http://127.0.0.1:${nuvem.servidor.address().port}`;

  const browser = await chromium.launch();
  const erros = [];

  // =========================================================
  console.log('\n[1] A tela de conexão');
  // =========================================================
  const zero = await browser.newContext({ ...devices['iPhone 13'] });
  const p0 = await zero.newPage();
  p0.on('pageerror', e => erros.push(String(e)));
  p0.on('dialog', d => d.accept());
  await p0.goto(`${baseApp}/index.html`, { waitUntil: 'networkidle' });

  checar(await p0.locator('#tranca').isHidden(),
    'sem nuvem configurada, o app abre direto (como antes)');
  checar(await p0.locator('#nuvemEstado').isHidden(),
    'e não mostra aviso de nuvem');

  await p0.click('.secao-btn[data-secao="orcamentos"]');
  await p0.waitForTimeout(200);
  await p0.click('#histBtn');
  await p0.waitForTimeout(250);
  await p0.click('#nuvemBtn');
  await p0.waitForTimeout(300);
  checar(await p0.locator('#painelNuvem').isVisible(), 'o botão Nuvem abre a tela');

  /* o painel do Supabase é copiado em bloco; o app tem de achar o que
     interessa no meio do texto */
  await p0.fill('#nvUrl',
    `Project URL\nhttps://abcdefgh.supabase.co/\n`);
  await p0.fill('#nvChave',
    `anon public\n${nuvem.chaveValida}\nservice_role  (não use)`);
  const limpo = await p0.evaluate(([u, k]) => ({
    url: limparEndereco(u), chave: limparChave(k),
  }), [`Project URL\nhttps://abcdefgh.supabase.co/\n`,
       `anon public\n${nuvem.chaveValida}\nservice_role`]);
  checar(limpo.url === 'https://abcdefgh.supabase.co',
    `acha o endereço no meio do texto colado (${limpo.url})`);
  checar(limpo.chave === nuvem.chaveValida,
    `acha a chave no meio do texto colado (${limpo.chave})`);

  /* agora com o endereço do servidor de mentira */
  await p0.fill('#nvUrl', baseNuvem);
  await p0.fill('#nvChave', nuvem.chaveValida);
  await p0.click('#nvSalvar');
  await p0.waitForTimeout(900);
  const guardado = await p0.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.nuvem.v1') || 'null'));
  checar(guardado && guardado.url === baseNuvem, 'guardou o endereço');
  checar((await p0.textContent('#nvAviso')).includes('feche e abra'),
    'manda fechar e abrir para entrar');

  /* chave errada não pode ser aceita */
  await p0.fill('#nvChave', 'sb_publishable_chaveQueNaoExisteNenhumLugar');
  await p0.click('#nvSalvar');
  await p0.waitForTimeout(900);
  checar((await p0.textContent('#nvAviso')).toLowerCase().includes('chave não foi aceita'),
    `recusa uma chave que o projeto não conhece (${await p0.textContent('#nvAviso')})`);
  const depoisDoErro = await p0.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.nuvem.v1') || 'null'));
  checar(depoisDoErro.chave === nuvem.chaveValida,
    'e não estraga a conexão que já funcionava');
  await zero.close();

  // =========================================================
  console.log('\n[2] A tranca passa a ser do Supabase');
  // =========================================================
  const A = await aparelho(browser, baseApp, baseNuvem, nuvem.chaveValida, erros);
  A.p = await reabrir(A.ctx, A.p, baseApp, erros);
  checar(await A.p.locator('#tranca').isVisible(),
    'com a nuvem ligada, o app pede entrada ao abrir');
  checar((await A.p.textContent('#rotuloUsuario')) === 'E-mail',
    'o campo passa a pedir e-mail');

  await entrar(A.p, EMAIL, 'senhaErrada');
  checar(await A.p.locator('#tranca').isVisible(), 'senha errada não entra');
  checar((await A.p.textContent('#acErro')).includes('E-mail'),
    'e o aviso fala em e-mail, não em usuário');

  await entrar(A.p);
  checar(await A.p.locator('#tranca').isHidden(), 'entra com a senha certa');
  const sessao = await A.p.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.sessaoNuvem.v1') || 'null'));
  checar(!!(sessao && sessao.token && sessao.dono), 'guardou a sessão');
  checar(!JSON.stringify(sessao).includes(SENHA),
    'a senha não fica guardada em texto na sessão');
  const acesso = await A.p.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.acesso.v1') || 'null'));
  checar(!!(acesso && acesso.hash) && !JSON.stringify(acesso).includes(SENHA),
    'guardou o embaralhamento da senha para valer sem internet');

  // =========================================================
  console.log('\n[3] O que estava no aparelho sobe');
  // =========================================================
  await lancar(A.p, {
    orcamento: orc('0001/2026', 'Construtora Alvorada', 3561.25),
    conta: cta('c-aluguel', 'Aluguel do galpão', 2200),
  });
  await sincronizar(A.p);
  await A.p.waitForTimeout(400);
  checar(nuvem.estado.linhas.orcamentos.length === 1,
    `o orçamento subiu (${nuvem.estado.linhas.orcamentos.length})`);
  checar(nuvem.estado.linhas.contas.length === 1,
    `a conta subiu (${nuvem.estado.linhas.contas.length})`);
  checar(nuvem.estado.linhas.orcamentos[0].dados.cliNome === 'Construtora Alvorada',
    'subiu com o conteúdo certo');
  checar(nuvem.estado.linhas.orcamentos[0].dono === falso.idDoEmail(EMAIL),
    'subiu no nome da dona');

  const pend = await A.p.evaluate(() =>
    pendentesDe('orcamentos').length + pendentesDe('contas').length);
  checar(pend === 0, `depois de subir não sobra nada pendente (${pend})`);
  checar((await A.p.textContent('#nuvemEstado')).includes('salvo'),
    `o aviso na tela mostra que está tudo salvo (${await A.p.textContent('#nuvemEstado')})`);

  // =========================================================
  console.log('\n[4] O segundo aparelho recebe tudo');
  // =========================================================
  const B = await aparelho(browser, baseApp, baseNuvem, nuvem.chaveValida, erros);
  B.p = await reabrir(B.ctx, B.p, baseApp, erros);
  await entrar(B.p);
  await B.p.waitForTimeout(1200);
  let hB = await historico(B.p);
  let cB = await contas(B.p);
  checar(hB.length === 1 && hB[0].cliNome === 'Construtora Alvorada',
    `o orçamento chegou no outro aparelho (${hB.length})`);
  checar(cB.length === 1 && cB[0].descricao === 'Aluguel do galpão',
    `a conta chegou no outro aparelho (${cB.length})`);

  /* o que desceu não pode voltar a subir sozinho */
  const pendB = await B.p.evaluate(() =>
    pendentesDe('orcamentos').length + pendentesDe('contas').length);
  checar(pendB === 0, `o que veio da nuvem não vira pendência (${pendB})`);

  // =========================================================
  console.log('\n[5] Uma alteração atravessa de um para o outro');
  // =========================================================
  await lancar(B.p, { conta: cta('c-aluguel', 'Aluguel do galpão', 2350) });
  await sincronizar(B.p);
  await B.p.waitForTimeout(300);
  await sincronizar(A.p);
  await A.p.waitForTimeout(300);
  const aluguelA = (await contas(A.p)).find(c => c.id === 'c-aluguel');
  checar(aluguelA && aluguelA.valor === 2350,
    `o valor novo chegou no primeiro aparelho (${aluguelA && aluguelA.valor})`);

  // =========================================================
  console.log('\n[6] Excluir não pode ressuscitar');
  // =========================================================
  /* pelo botão da tela, não por dentro: é o caminho que a Becca usa, e
     é onde mora o gancho que deixa a lápide */
  await A.p.click('.secao-btn[data-secao="contas"]');
  await A.p.waitForTimeout(300);
  await A.p.click('#contasLista .conta-item:has-text("Aluguel do galpão") .ct-excluir');
  await A.p.waitForTimeout(400);
  checar(!(await contas(A.p)).some(c => c.id === 'c-aluguel'),
    'o botão Excluir tirou a conta do aparelho');
  const lapide = await A.p.evaluate(() =>
    (JSON.parse(localStorage.getItem('beccaGesso.removidos.v1') || '{}').contas || {})['c-aluguel']);
  checar(!!lapide, 'e deixou registrado que foi apagada, não que nunca existiu');
  await sincronizar(A.p);
  await A.p.waitForTimeout(300);
  checar(nuvem.estado.linhas.contas[0].removido === true,
    'a nuvem soube que a conta foi apagada');

  await sincronizar(B.p);
  await B.p.waitForTimeout(300);
  checar(!(await contas(B.p)).some(c => c.id === 'c-aluguel'),
    'a conta sumiu também no segundo aparelho');

  /* e a rodada seguinte não pode trazê-la de volta */
  await sincronizar(A.p);
  await sincronizar(B.p);
  await A.p.waitForTimeout(300);
  checar(!(await contas(A.p)).some(c => c.id === 'c-aluguel'),
    'e não volta na sincronia seguinte');

  // =========================================================
  console.log('\n[7] Os dois mexeram no mesmo: ganha o mais recente');
  // =========================================================
  const base = Date.now();
  /* A edita primeiro, B depois — mas quem sincroniza primeiro é o B */
  await lancar(A.p, { orcamento: orc('0007/2026', 'Versão antiga', 100, base) });
  await lancar(B.p, { orcamento: orc('0007/2026', 'Versão nova', 200, base + 5000) });
  await sincronizar(B.p);
  await B.p.waitForTimeout(300);
  await sincronizar(A.p);
  await A.p.waitForTimeout(300);
  let naNuvem = nuvem.estado.linhas.orcamentos.find(l => l.numero === '0007/2026');
  checar(naNuvem.dados.cliNome === 'Versão nova',
    `a versão mais antiga não derrubou a mais nova (${naNuvem.dados.cliNome})`);

  /* e o aparelho que estava atrasado recebe a boa */
  await sincronizar(A.p);
  await A.p.waitForTimeout(400);
  const emA = (await historico(A.p)).find(e => e.orcNumero === '0007/2026');
  checar(emA.cliNome === 'Versão nova',
    `o aparelho atrasado recebe a versão boa (${emA.cliNome})`);

  /* Os dois testes acima passam pelo cliente, que baixa antes de subir e
     por isso nem chega a mandar a versão velha. Falta a corrida que o
     cliente não vê: dois aparelhos subindo quase junto, sem tempo de um
     saber do outro. Aí quem segura é o gatilho do banco. */
  const corrida = (numero, nome, quando) => fetch(`${baseNuvem}/rest/v1/${'orcamentos'}`, {
    method: 'POST',
    headers: { apikey: nuvem.chaveValida, 'content-type': 'application/json',
               authorization: 'Bearer tok-' + EMAIL, prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ dono: falso.idDoEmail(EMAIL), numero: numero,
      dados: { cliNome: nome }, atualizado_em: quando, removido: false }]),
  });
  await corrida('0009/2026', 'Recente', base + 20000);
  await corrida('0009/2026', 'Atrasado', base);         /* chega depois, é mais velho */
  const emCorrida = nuvem.estado.linhas.orcamentos.find(l => l.numero === '0009/2026');
  checar(emCorrida.dados.cliNome === 'Recente',
    `numa corrida, o banco segura a versão velha (${emCorrida.dados.cliNome})`);

  /* agora ao contrário: o mais novo sincroniza depois */
  await lancar(A.p, { orcamento: orc('0008/2026', 'Antiga', 1, base) });
  await sincronizar(A.p);
  await lancar(B.p, { orcamento: orc('0008/2026', 'Nova', 2, base + 9000) });
  await sincronizar(B.p);
  await B.p.waitForTimeout(300);
  naNuvem = nuvem.estado.linhas.orcamentos.find(l => l.numero === '0008/2026');
  checar(naNuvem.dados.cliNome === 'Nova',
    `nos dois sentidos vence a mais recente (${naNuvem.dados.cliNome})`);

  // =========================================================
  console.log('\n[8] Sem internet');
  // =========================================================
  await A.ctx.setOffline(true);
  await lancar(A.p, { conta: cta('c-offline', 'Placas compradas na obra', 480) });
  await A.p.waitForTimeout(200);
  const salvouOffline = (await contas(A.p)).some(c => c.id === 'c-offline');
  checar(salvouOffline, 'dá para lançar sem internet');
  const rOff = await A.p.evaluate(() => sincronizar({ silencioso: true }));
  checar(rOff === null, 'a sincronia não trava sem sinal');
  await A.p.evaluate(() => mostrarEstadoNuvem('offline'));
  checar((await A.p.textContent('#nuvemEstado')).includes('Sem internet'),
    'a tela avisa que está sem internet');
  const pendOff = await A.p.evaluate(() => pendentesDe('contas').length);
  checar(pendOff === 1, `o lançamento fica na fila (${pendOff})`);

  /* o app tem de abrir e a entrada tem de funcionar sem sinal, pelo
     embaralhamento guardado na primeira entrada */
  A.p = await reabrir(A.ctx, A.p, baseApp, erros);
  checar(await A.p.locator('#tranca').isVisible(), 'ao reabrir sem sinal, pede entrada');
  await entrar(A.p);
  checar(await A.p.locator('#tranca').isHidden(),
    'entra sem internet com a mesma senha');
  checar((await contas(A.p)).some(c => c.id === 'c-offline'),
    'e os lançamentos continuam lá');

  /* O caso pior não é ficar sem sinal: é o celular achar que tem
     internet e a chamada morrer no caminho — wi-fi de padaria que pede
     senha, sinal de uma barra. Aí navigator.onLine mente. */
  await A.ctx.setOffline(false);
  await A.p.route('**/auth/v1/**', rota => rota.abort());
  A.p = await reabrir(A.ctx, A.p, baseApp, erros);
  await A.p.route('**/auth/v1/**', rota => rota.abort());
  checar(await A.p.evaluate(() => navigator.onLine) === true,
    'o aparelho acha que está com internet');
  await entrar(A.p);
  checar(await A.p.locator('#tranca').isHidden(),
    'mesmo assim entra, pela senha guardada aqui');
  await A.p.unroute('**/auth/v1/**');

  await A.p.evaluate(() => sincronizar({ silencioso: true }));
  await A.p.waitForTimeout(500);
  checar(nuvem.estado.linhas.contas.some(l => l.chave === 'c-offline'),
    'quando o sinal volta, o que ficou na fila sobe');

  // =========================================================
  console.log('\n[9] Aparelho novo, sem internet, nunca entrou');
  // =========================================================
  const C = await aparelho(browser, baseApp, baseNuvem, nuvem.chaveValida, erros);
  await C.ctx.setOffline(true);
  C.p = await reabrir(C.ctx, C.p, baseApp, erros);
  await entrar(C.p);
  checar(await C.p.locator('#tranca').isVisible(),
    'não deixa entrar num aparelho que nunca entrou, sem internet');
  checar((await C.p.textContent('#acErro')).toLowerCase().includes('internet'),
    `e explica por quê (${await C.p.textContent('#acErro')})`);
  await C.ctx.close();

  // =========================================================
  console.log('\n[10] Token vencido se renova sozinho');
  // =========================================================
  const tok = (await B.p.evaluate(() =>
    JSON.parse(localStorage.getItem('beccaGesso.sessaoNuvem.v1')))).token;
  nuvem.estado.tokensVencidos.add(tok);
  await lancar(B.p, { conta: cta('c-renova', 'Depois do token vencer', 90) });
  const rRenova = await B.p.evaluate(() => sincronizar({}));
  await B.p.waitForTimeout(400);
  checar(rRenova !== null, 'a sincronia se recupera do token vencido');
  checar(nuvem.estado.linhas.contas.some(l => l.chave === 'c-renova'),
    'e o lançamento sobe depois de renovar');

  // =========================================================
  console.log('\n[11] Sem entrar, a nuvem não entrega nada');
  // =========================================================
  /* Com as regras ligadas, o anônimo não toma erro: ele simplesmente
     não enxerga linha nenhuma. É a proteção funcionando. */
  const semEntrar = await fetch(`${baseNuvem}/rest/v1/orcamentos?select=numero`, {
    headers: { apikey: nuvem.chaveValida },
  });
  const nada = await semEntrar.json();
  checar(semEntrar.status === 200 && Array.isArray(nada) && nada.length === 0,
    `só com a chave pública não se enxerga nada (${semEntrar.status}, ${JSON.stringify(nada)})`);

  /* e gravar sem entrar bate na regra */
  const gravarSemEntrar = await fetch(`${baseNuvem}/rest/v1/orcamentos`, {
    method: 'POST',
    headers: { apikey: nuvem.chaveValida, 'content-type': 'application/json' },
    body: JSON.stringify([{ dono: falso.idDoEmail(EMAIL), numero: 'invasor',
                            dados: {}, atualizado_em: Date.now(), removido: false }]),
  });
  checar(gravarSemEntrar.status === 403,
    `nem gravar (${gravarSemEntrar.status})`);
  checar(!nuvem.estado.linhas.orcamentos.some(l => l.numero === 'invasor'),
    'e nada foi gravado');

  const comEntrada = await fetch(`${baseNuvem}/rest/v1/orcamentos?select=numero`, {
    headers: { apikey: nuvem.chaveValida, authorization: 'Bearer tok-' + EMAIL },
  });
  checar((await comEntrada.json()).length > 0, 'com a entrada feita, lê');

  // =========================================================
  console.log('\n[12] Desligar a nuvem não apaga nada');
  // =========================================================
  const antesDeDesligar = (await historico(B.p)).length;
  await B.p.evaluate(() => {
    esquecerNuvem();
    localStorage.removeItem('beccaGesso.nuvem.v1');
  });
  B.p = await reabrir(B.ctx, B.p, baseApp, erros);
  checar((await historico(B.p)).length === antesDeDesligar,
    'os orçamentos continuam no aparelho');
  checar(nuvem.estado.linhas.orcamentos.length > 0,
    'e continuam na nuvem');

  checar(erros.length === 0,
    `sem erros de JavaScript ${erros.length ? '-> ' + erros.join(' | ') : ''}`);

  await browser.close();
  srvApp.close();
  nuvem.servidor.close();
  console.log(falhas.length ? `\nFALHAS: ${falhas.length}` : '\nNuvem OK');
  process.exit(falhas.length ? 1 : 0);
})();
