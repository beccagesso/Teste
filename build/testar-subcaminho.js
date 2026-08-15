/* Simula o GitHub Pages servindo o app em /Teste/ em vez da raiz. */
const { chromium, devices } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const RAIZ='/home/user/Teste', BASE='/Teste';
const T={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/manifest+json','.png':'image/png'};
const falhas=[];
const checar=(c,m)=>{console.log(`  ${c?'ok  ':'FALHA'}  ${m}`); if(!c)falhas.push(m);};
(async()=>{
  const s=http.createServer((q,r)=>{
    let u=decodeURIComponent(q.url.split('?')[0]);
    if(!u.startsWith(BASE)){r.writeHead(404);return r.end('fora do subcaminho');}
    let p=u.slice(BASE.length)||'/';
    if(p==='/')p='/index.html';
    const f=path.join(RAIZ,p);
    if(!f.startsWith(RAIZ)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('404');}
    r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});
    r.end(fs.readFileSync(f));
  });
  await new Promise(k=>s.listen(0,'127.0.0.1',k));
  const base=`http://127.0.0.1:${s.address().port}${BASE}/`;
  console.log('servindo em', base);
  const b=await chromium.launch();
  const c=await b.newContext({...devices['iPhone 13']});
  /* estes testes são de outra parte do app; desligar a nuvem
     evita que a tela de login do Supabase (ligada por padrão)
     atrapalhe */
  await c.addInitScript(() => localStorage.setItem('beccaGesso.nuvemDesligada.v1', 'true'));
  const p=await c.newPage();
  const quebrados=[];
  p.on('response', r=>{ if(r.status()>=400) quebrados.push(`${r.status()} ${r.url()}`); });
  await p.goto(base,{waitUntil:'networkidle'});
  /* o app abre no resumo do mês; daqui para a frente o teste é do editor */
  await p.click('.secao-btn[data-secao="orcamentos"]');
  await p.waitForTimeout(250);

  checar(quebrados.length===0, `nenhum arquivo faltando ${quebrados.length?'-> '+quebrados.join(' | '):''}`);

  // manifest e icones resolvem?
  const rec=await p.evaluate(async()=>{
    const abs=s=>new URL(s, location.href).href;
    const manifestHref=document.querySelector('link[rel=manifest]').href;
    const touch=document.querySelector('link[rel=apple-touch-icon]').href;
    const m=await fetch(manifestHref).then(r=>r.ok?r.json():null).catch(()=>null);
    const okTouch=await fetch(touch).then(r=>r.ok).catch(()=>false);
    let okIcones=false, inicio=null;
    if(m){
      inicio=abs(m.start_url);
      const res=await Promise.all(m.icons.map(i=>fetch(abs(i.src)).then(r=>r.ok).catch(()=>false)));
      okIcones=res.every(Boolean);
    }
    return {manifest:!!m, okTouch, okIcones, inicio, atual:location.href};
  });
  checar(rec.manifest, 'manifest.json carrega no subcaminho');
  checar(rec.okTouch, 'apple-touch-icon carrega');
  checar(rec.okIcones, 'ícones do manifest carregam');
  // start_url tem de abrir o proprio app; comparar o texto seria rigido demais,
  // entao buscamos o endereco e conferimos que veio o app.
  const inicioServe=await p.evaluate(async u=>{
    const t=await fetch(u).then(r=>r.ok?r.text():'').catch(()=>'');
    return t.includes('id="totTotal"');
  }, rec.inicio);
  checar(inicioServe, `start_url abre o app (${rec.inicio})`);
  checar(rec.inicio===rec.atual, `start_url é o mesmo endereço que o navegador abre (${rec.inicio} vs ${rec.atual})`);

  // service worker no escopo certo
  await p.waitForTimeout(1500);
  const sw=await p.evaluate(async()=>{
    const r=await navigator.serviceWorker.getRegistration();
    return r?{escopo:r.scope, ativo:!!(r.active||r.waiting||r.installing)}:null;
  });
  checar(sw&&sw.ativo, `service worker ativo (escopo ${sw?sw.escopo:'nenhum'})`);
  checar(sw&&sw.escopo.endsWith('/Teste/'), 'escopo do service worker limitado a /Teste/');

  // offline no subcaminho
  await p.fill('#cliNome','Teste Offline');
  await p.waitForTimeout(700);
  await c.setOffline(true);
  await p.reload({waitUntil:'domcontentloaded'}).catch(()=>{});
  const vivo=await p.evaluate(()=>!!document.querySelector('#totTotal')).catch(()=>false);
  checar(vivo,'app abre sem internet no subcaminho');
  const nome=await p.inputValue('#cliNome').catch(()=>'');
  checar(nome==='Teste Offline','dados preservados');
  await c.setOffline(false);

  await b.close(); s.close();
  console.log(falhas.length?`\nFALHAS: ${falhas.length}`:'\nTudo certo no subcaminho');
  process.exit(falhas.length?1:0);
})();
