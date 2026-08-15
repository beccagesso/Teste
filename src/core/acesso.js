/* A tranca de tela. Não é criptografia de verdade — serve para quem
   pega o aparelho destravado e abre o app. A senha não fica guardada em
   texto puro: o que fica é o resultado de PBKDF2, que não permite
   voltar para a senha original.

   Com a nuvem ligada, a tranca deixa de ser decorativa: quem entra é o
   Supabase (`core/cloud.js`). Mas o app precisa abrir na obra sem
   sinal, então a cada entrada bem-sucedida pela nuvem este módulo
   também grava aqui o PBKDF2 da mesma senha, e é ele que confere quando
   o prazo vence fora de área. */
import { entrarNaNuvem, nuvemConfigurada } from './cloud.js';

const CHAVE_ACESSO = 'beccaGesso.acesso.v1';
const CHAVE_SESSAO = 'beccaGesso.destrancado';
const VOLTAS_PBKDF2 = 250000;
/* No iPhone o app pode ficar horas em segundo plano sem fechar de vez.
   Sem um prazo, a senha praticamente nunca voltaria a ser pedida. */
const MINUTOS_ABERTO = 30;

export function lerAcesso(){
  try{ return JSON.parse(localStorage.getItem(CHAVE_ACESSO) || 'null'); }
  catch(e){ return null; }
}

export function temSenha(){
  const a = lerAcesso();
  return !!(a && a.hash && a.sal);
}

function bytesParaTexto64(bytes){
  let bin = '';
  for(const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/* O decodificador base64->bytes já existe em build/pdf.js (embutido no
   documento por `/*__PDF__*\/`, antes deste módulo carregar) — reaproveita
   em vez de duplicar 4 linhas que fazem exatamente a mesma coisa. */
function bytesDeBase64(b64){
  return window.bytesDeBase64(b64);
}

async function derivarSenha(senha, sal64, voltas){
  const sal = bytesDeBase64(sal64);
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {name:'PBKDF2', salt: sal, iterations: voltas, hash:'SHA-256'},
    material, 256);
  return bytesParaTexto64(bits);
}

export async function definirSenha(usuario, senha){
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const sal64 = bytesParaTexto64(sal);
  const hash = await derivarSenha(senha, sal64, VOLTAS_PBKDF2);
  localStorage.setItem(CHAVE_ACESSO, JSON.stringify({
    usuario: (usuario || '').trim(),
    sal: sal64,
    voltas: VOLTAS_PBKDF2,
    hash: hash,
    criadoEm: Date.now(),
  }));
}

export async function senhaConfere(usuario, senha){
  const a = lerAcesso();
  if(!a) return false;
  const nomeOk = (a.usuario || '').toLowerCase() ===
                 (usuario || '').trim().toLowerCase();
  const hash = await derivarSenha(senha, a.sal, a.voltas || VOLTAS_PBKDF2);
  /* compara os dois de qualquer jeito, para o tempo de resposta não
     entregar se o que errou foi o usuário ou a senha */
  return nomeOk && hash === a.hash;
}

export function removerSenha(){
  try{ localStorage.removeItem(CHAVE_ACESSO); }catch(e){}
}

export function estaDestrancado(){
  try{
    const quando = Number(sessionStorage.getItem(CHAVE_SESSAO) || 0);
    if(!quando) return false;
    if(Date.now() - quando > MINUTOS_ABERTO * 60 * 1000){
      esquecerSessao();
      return false;
    }
    return true;
  }catch(e){ return false; }
}

export function marcarDestrancado(){
  try{ sessionStorage.setItem(CHAVE_SESSAO, String(Date.now())); }catch(e){}
}

export function esquecerSessao(){
  try{ sessionStorage.removeItem(CHAVE_SESSAO); }catch(e){}
}

export function exigeEntrada(){
  return nuvemConfigurada() || temSenha();
}

export async function entradaConfere(usuario, senha){
  if(!nuvemConfigurada()) return await senhaConfere(usuario, senha);

  if(navigator.onLine === false){
    if(!temSenha()){
      const e = new Error('Sem internet, e este aparelho ainda não entrou ' +
        'nenhuma vez. Conecte à internet para entrar da primeira vez.');
      e.mostrar = true;
      throw e;
    }
    return await senhaConfere(usuario, senha);
  }

  try{
    await entrarNaNuvem(usuario, senha);
    /* guarda a mesma senha para valer offline da próxima vez */
    await definirSenha(usuario, senha);
    return true;
  }catch(erro){
    /* sem rede não é senha errada: cai para o que está guardado aqui */
    if(erro.semRede && temSenha()) return await senhaConfere(usuario, senha);
    if(erro.semRede){
      const e = new Error('Sem internet, e este aparelho ainda não entrou ' +
        'nenhuma vez. Conecte à internet para entrar da primeira vez.');
      e.mostrar = true;
      throw e;
    }
    return false;
  }
}
