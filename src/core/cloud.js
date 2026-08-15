/* Fala com o Supabase (PostgREST + GoTrue), sem biblioteca nenhuma —
   só fetch. Esta é a única camada que sabe o endereço, a chave e o
   token de quem entrou; o resto do app pede dados por tipo (orçamentos,
   contas, clientes...) e não precisa saber que isso é HTTP. */
import { lerJson, gravarJson } from './storage.js';
import { erroSemRede, erroPrecisaEntrar, erroDoServidor } from './errors.js';

const CHAVE_NUVEM      = 'beccaGesso.nuvem.v1';        /* endereço e chave */
const CHAVE_NUVEM_OFF  = 'beccaGesso.nuvemDesligada.v1'; /* desligada à mão neste aparelho */
const CHAVE_SESSAO_N   = 'beccaGesso.sessaoNuvem.v1';  /* quem entrou */

/* O projeto da Becca Gesso já vem ligado: ninguém precisa colar
   endereço e chave à mão para o app funcionar. A chave é a pública
   (anon/publishable) — pode ficar no código sem problema, porque quem
   protege os dados são as regras de acesso do banco (build/supabase.sql),
   não o segredo dela. Sem essas regras ligadas no projeto, isto aqui
   deixaria os dados abertos para qualquer um que abrisse o link. */
export const NUVEM_PADRAO = {
  url: 'https://xipqhkaucbiaezrdvksg.supabase.co',
  chave: 'sb_publishable_tqRXHAp2o95tJbxt2hNpkQ_uXI0NXXw',
};

/* Alguém colou um projeto diferente à mão? Essa escolha vale, mesmo com
   um padrão embutido. Sem nada colado e sem ter sido desligada à mão,
   cai no projeto padrão da empresa. */
export function lerNuvem(){
  const guardada = lerJson(CHAVE_NUVEM, null);
  if(guardada) return guardada;
  if(NUVEM_PADRAO && !lerJson(CHAVE_NUVEM_OFF, false)) return NUVEM_PADRAO;
  return null;
}

export function usandoPadrao(){
  return !lerJson(CHAVE_NUVEM, null) && !!lerNuvem();
}

export function nuvemConfigurada(){
  const c = lerNuvem();
  return !!(c && c.url && c.chave);
}

export function salvarConfigNuvem(cfg){
  gravarJson(CHAVE_NUVEM, cfg);
}

/* Estado bruto (sem cair no padrão embutido) — usado para poder desfazer
   uma troca de conexão que falhou na conferência, devolvendo exatamente
   o que estava gravado antes, nem que fosse "nada". */
export function lerConfigBruta(){
  return lerJson(CHAVE_NUVEM, null);
}

export function restaurarConfigBruta(cfgOuNull, desligadaAntes){
  if(cfgOuNull) gravarJson(CHAVE_NUVEM, cfgOuNull);
  else{ try{ localStorage.removeItem(CHAVE_NUVEM); }catch(e){} }
  gravarJson(CHAVE_NUVEM_OFF, !!desligadaAntes);
}

export function desligarNuvemLocal(){
  gravarJson(CHAVE_NUVEM, null);
  gravarJson(CHAVE_NUVEM_OFF, true);
}

export function ligarPadraoLocal(){
  gravarJson(CHAVE_NUVEM, null);
  gravarJson(CHAVE_NUVEM_OFF, false);
}

export function nuvemDesligadaAqui(){
  return lerJson(CHAVE_NUVEM_OFF, false);
}

/* O painel do Supabase mostra o endereço e a chave em blocos que a
   pessoa copia inteiros. Em vez de exigir que ela recorte, o app
   procura o que interessa dentro do que foi colado. */
export function limparEndereco(texto){
  const t = String(texto || '').trim();
  const m = t.match(/https?:\/\/[a-z0-9-]+\.supabase\.(co|in)/i);
  if(m) return m[0];
  return t.replace(/\/+$/, '');
}

export function limparChave(texto){
  const t = String(texto || '').trim();
  /* chave nova (sb_publishable_…) ou a antiga, que é um JWT */
  const m = t.match(/sb_publishable_[A-Za-z0-9_-]+/) ||
            t.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+/);
  return m ? m[0] : t;
}

export function lerSessaoNuvem(){ return lerJson(CHAVE_SESSAO_N, null); }

export function entrouNaNuvem(){
  const s = lerSessaoNuvem();
  return !!(s && s.token && s.dono);
}

function guardarSessaoDaResposta(r){
  const antes = lerSessaoNuvem() || {};
  gravarJson(CHAVE_SESSAO_N, {
    token: r.access_token,
    renovacao: r.refresh_token || antes.renovacao,
    expiraEm: Date.now() + ((r.expires_in || 3600) * 1000),
    email: (r.user && r.user.email) || antes.email || '',
    dono: (r.user && r.user.id) || antes.dono || '',
  });
}

/* ---------- as chamadas ---------- */

export async function pedirNuvem(caminho, opcoes){
  const cfg = lerNuvem();
  if(!cfg) throw new Error('a conexão com a nuvem ainda não foi configurada');
  const o = opcoes || {};
  const cabecalho = Object.assign({
    'apikey': cfg.chave,
    'Content-Type': 'application/json',
  }, o.headers || {});
  if(!o.semToken){
    const s = lerSessaoNuvem();
    if(s && s.token) cabecalho['Authorization'] = 'Bearer ' + s.token;
  }

  let r;
  try{
    r = await fetch(cfg.url + caminho, {
      method: o.metodo || 'GET',
      headers: cabecalho,
      body: o.corpo === undefined ? undefined : JSON.stringify(o.corpo),
    });
  }catch(e){
    throw erroSemRede();
  }

  const texto = await r.text();
  let corpo = null;
  try{ corpo = texto ? JSON.parse(texto) : null; }catch(e){ corpo = texto; }

  if(!r.ok){
    const msg = (corpo && (corpo.msg || corpo.message || corpo.error_description ||
                 corpo.error || corpo.hint)) || `erro ${r.status}`;
    throw erroDoServidor(msg, r.status);
  }
  return corpo;
}

/* O token de entrada vale cerca de uma hora. Em vez de ficar olhando o
   relógio, tenta e, se levar 401, renova e tenta de novo — uma vez só,
   para um token de fato inválido não virar laço. */
export async function comToken(tentar){
  try{
    return await tentar();
  }catch(erro){
    if(erro.status !== 401) throw erro;
    await renovarToken();
    return await tentar();
  }
}

export async function renovarToken(){
  const s = lerSessaoNuvem();
  if(!s || !s.renovacao) throw erroPrecisaEntrar();
  try{
    const r = await pedirNuvem('/auth/v1/token?grant_type=refresh_token', {
      metodo:'POST', semToken:true, corpo:{refresh_token: s.renovacao}});
    guardarSessaoDaResposta(r);
  }catch(erro){
    if(erro.semRede) throw erro;
    sairDaNuvem();
    throw erroPrecisaEntrar();
  }
}

export async function entrarNaNuvem(email, senha){
  const r = await pedirNuvem('/auth/v1/token?grant_type=password', {
    metodo:'POST', semToken:true,
    corpo:{email: String(email || '').trim(), password: senha}});
  guardarSessaoDaResposta(r);
  return r;
}

export function sairDaNuvem(){
  try{ localStorage.removeItem(CHAVE_SESSAO_N); }catch(e){}
}
