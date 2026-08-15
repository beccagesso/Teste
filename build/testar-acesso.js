/* Testa a senha de acesso: o app abre livre sem senha, tranca depois de
   definida, recusa senha errada, deixa trocar e tirar, e nunca guarda a
   senha em texto legível. */
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

const guardado = p => p.evaluate(() =>
  JSON.parse(localStorage.getItem('beccaGesso.acesso.v1') || 'null'));

/* Recarregar mantém a sessão aberta de propósito: quem acabou de entrar
   não deve ser trancado de novo. Fechar e abrir o app é que pede senha. */
async function reabrirApp(ctx, pagina, base, erros) {
  await pagina.close();
  const nova = await ctx.newPage();
  nova.on('pageerror', e => erros.push(String(e)));
  nova.on('dialog', d => d.accept());
  await nova.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await nova.waitForTimeout(400);
  return nova;
}

async function definirPelaTela(p, { usuario, senha, atual }) {
  /* o histórico é a porta da tela de senha, e ele mora no editor */
  await p.click('.secao-btn[data-secao="orcamentos"]');
  await p.waitForTimeout(200);
  await p.click('#histBtn');
  await p.waitForTimeout(200);
  await p.click('#acessoBtn');
  await p.waitForTimeout(250);
  if (atual !== undefined) await p.fill('#acSenhaAtual', atual);
  await p.fill('#acNovoUsuario', usuario);
  await p.fill('#acNovaSenha', senha);
  await p.fill('#acRepetirSenha', senha);
  await p.click('#acGravar');
  await p.waitForTimeout(900);          // PBKDF2 leva um instante
}

(async () => {
  const srv = await servidor();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  /* estes testes são de outra parte do app; desligar a nuvem
     evita que a tela de login do Supabase (ligada por padrão)
     atrapalhe */
  await ctx.addInitScript(() => localStorage.setItem('beccaGesso.nuvemDesligada.v1', 'true'));
  let p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(String(e)));
  p.on('dialog', d => d.accept());
  await p.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  /* o app abre no resumo; estes testes mexem no orçamento em andamento */
  await p.click('.secao-btn[data-secao="orcamentos"]');
  await p.waitForTimeout(250);

  // ---------- 1. sem senha, o app abre direto ----------
  console.log('\n[1] Sem senha definida');
  checar(await p.locator('#tranca').isHidden(), 'não pede nada ao abrir');
  checar(await p.locator('.app').isVisible(), 'o app aparece normalmente');
  checar((await guardado(p)) === null, 'nada guardado sobre acesso');

  // ---------- 2. definir a senha ----------
  console.log('\n[2] Definir a senha');
  await definirPelaTela(p, { usuario: 'becca', senha: 'gesso2026' });
  const dados = await guardado(p);
  checar(dados !== null, 'a senha foi guardada');
  checar(dados.usuario === 'becca', `usuário guardado: ${dados && dados.usuario}`);

  /* o ponto principal: a senha em si não pode estar guardada */
  const bruto = JSON.stringify(dados);
  checar(!bruto.includes('gesso2026'), 'a senha não fica guardada em texto');
  checar(!!dados.sal && !!dados.hash, 'guarda sal e resultado do embaralhamento');
  checar((dados.voltas || 0) >= 100000,
    `usa muitas voltas de PBKDF2 (${dados.voltas})`);

  /* duas senhas iguais em aparelhos diferentes não podem dar o mesmo
     resultado guardado — é para isso que serve o sal */
  const ctx2 = await browser.newContext({ ...devices['iPhone 13'] });
  /* estes testes são de outra parte do app; desligar a nuvem
     evita que a tela de login do Supabase (ligada por padrão)
     atrapalhe */
  await ctx2.addInitScript(() => localStorage.setItem('beccaGesso.nuvemDesligada.v1', 'true'));
  const p2 = await ctx2.newPage();
  p2.on('dialog', d => d.accept());
  await p2.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await definirPelaTela(p2, { usuario: 'becca', senha: 'gesso2026' });
  const dados2 = await guardado(p2);
  checar(dados2.hash !== dados.hash,
    'a mesma senha gera resultados diferentes em aparelhos diferentes');
  await ctx2.close();

  // ---------- 3. o app tranca ao reabrir ----------
  console.log('\n[3] Reabrir o app');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  checar(await p.locator('#tranca').isHidden(),
    'recarregar logo depois de definir não tranca de novo');

  p = await reabrirApp(ctx, p, base, erros);
  checar(await p.locator('#tranca').isVisible(), 'pede a senha ao abrir o app');
  checar(await p.locator('.app').isHidden(), 'o app não fica visível atrás');

  // ---------- 4. senha errada ----------
  console.log('\n[4] Senha errada');
  await p.fill('#acUsuario', 'becca');
  await p.fill('#acSenha', 'errada');
  await p.click('#acEntrar');
  await p.waitForTimeout(900);
  checar(await p.locator('#acErro').isVisible(), 'avisa que não confere');
  checar(await p.locator('#tranca').isVisible(), 'continua trancado');
  checar((await p.inputValue('#acSenha')) === '', 'limpa o campo da senha');

  // usuário errado com a senha certa também não entra
  await p.fill('#acUsuario', 'outro');
  await p.fill('#acSenha', 'gesso2026');
  await p.click('#acEntrar');
  await p.waitForTimeout(900);
  checar(await p.locator('#tranca').isVisible(), 'usuário errado também não entra');

  // ---------- 5. senha certa ----------
  console.log('\n[5] Senha certa');
  await p.fill('#acUsuario', 'becca');
  await p.fill('#acSenha', 'gesso2026');
  await p.click('#acEntrar');
  await p.waitForTimeout(900);
  checar(await p.locator('#tranca').isHidden(), 'entra com a senha certa');
  checar(await p.locator('.app').isVisible(), 'o app aparece');

  /* maiúscula no usuário não deve atrapalhar */
  p = await reabrirApp(ctx, p, base, erros);
  await p.fill('#acUsuario', 'Becca');
  await p.fill('#acSenha', 'gesso2026');
  await p.click('#acEntrar');
  await p.waitForTimeout(900);
  checar(await p.locator('#tranca').isHidden(),
    'o usuário não diferencia maiúscula de minúscula');

  // ---------- 6. os orçamentos continuam lá ----------
  console.log('\n[6] Os dados atravessam a tranca');
  await p.fill('#cliNome', 'Construtora Alvorada Ltda');
  await p.fill('.s-desc', 'Forro de gesso');
  await p.fill('.s-qtd', '10');
  await p.fill('.s-valor', '90,00');
  await p.waitForTimeout(700);
  p = await reabrirApp(ctx, p, base, erros);
  await p.fill('#acUsuario', 'becca');
  await p.fill('#acSenha', 'gesso2026');
  await p.click('#acEntrar');
  await p.waitForTimeout(900);
  checar((await p.inputValue('#cliNome')) === 'Construtora Alvorada Ltda',
    'o orçamento em andamento continua lá depois de entrar');

  // ---------- 7. trocar a senha ----------
  console.log('\n[7] Trocar a senha');
  await p.click('#histBtn');
  await p.waitForTimeout(200);
  await p.click('#acessoBtn');
  await p.waitForTimeout(250);
  checar(await p.locator('#acAtualBloco').isVisible(),
    'com senha definida, pede a atual para trocar');
  await p.fill('#acSenhaAtual', 'chuteerrado');
  await p.fill('#acNovoUsuario', 'becca');
  await p.fill('#acNovaSenha', 'novasenha1');
  await p.fill('#acRepetirSenha', 'novasenha1');
  await p.click('#acGravar');
  await p.waitForTimeout(900);
  checar((await p.textContent('#acAviso')).includes('atual'),
    'não troca sem a senha atual certa');

  await p.fill('#acSenhaAtual', 'gesso2026');
  await p.fill('#acNovaSenha', 'nova1');
  await p.fill('#acRepetirSenha', 'nova2');
  await p.click('#acGravar');
  await p.waitForTimeout(900);
  checar((await p.textContent('#acAviso')).includes('iguais'),
    'não aceita as duas senhas diferentes');

  await p.fill('#acNovaSenha', 'ab');
  await p.fill('#acRepetirSenha', 'ab');
  await p.click('#acGravar');
  await p.waitForTimeout(900);
  checar((await p.textContent('#acAviso')).includes('caracteres'),
    'não aceita senha curta demais');

  await p.fill('#acNovaSenha', 'novasenha1');
  await p.fill('#acRepetirSenha', 'novasenha1');
  await p.click('#acGravar');
  await p.waitForTimeout(1000);
  p = await reabrirApp(ctx, p, base, erros);
  await p.fill('#acUsuario', 'becca');
  await p.fill('#acSenha', 'gesso2026');
  await p.click('#acEntrar');
  await p.waitForTimeout(900);
  checar(await p.locator('#tranca').isVisible(), 'a senha antiga deixou de valer');
  await p.fill('#acSenha', 'novasenha1');
  await p.click('#acEntrar');
  await p.waitForTimeout(900);
  checar(await p.locator('#tranca').isHidden(), 'a senha nova vale');

  // ---------- 8. tirar a senha ----------
  console.log('\n[8] Tirar a senha');
  await p.click('#histBtn');
  await p.waitForTimeout(200);
  await p.click('#acessoBtn');
  await p.waitForTimeout(250);
  await p.click('#acRemover');
  await p.waitForTimeout(700);
  checar((await p.textContent('#acAviso')).includes('atual'),
    'não tira a senha sem informar a atual');
  await p.fill('#acSenhaAtual', 'novasenha1');
  await p.click('#acRemover');
  await p.waitForTimeout(900);
  checar((await guardado(p)) === null, 'a senha foi removida');
  p = await reabrirApp(ctx, p, base, erros);
  checar(await p.locator('#tranca').isHidden(), 'o app volta a abrir direto');
  checar((await p.inputValue('#cliNome')) === 'Construtora Alvorada Ltda',
    'tirar a senha não apagou os orçamentos');

  checar(erros.length === 0,
    `sem erros de JavaScript ${erros.length ? '-> ' + erros.join(' | ') : ''}`);

  await browser.close();
  srv.close();
  console.log(falhas.length ? `\nFALHAS: ${falhas.length}` : '\nSenha de acesso OK');
  process.exit(falhas.length ? 1 : 0);
})();
