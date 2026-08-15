/* A sincronização entre este aparelho e a nuvem — um motor só, que
   qualquer entidade (orçamentos, contas, clientes, fornecedores,
   categorias) usa da mesma forma. Antes desta etapa isto conhecia só
   "orçamentos" e "contas" por se/senão; para caber uma entidade nova
   bastava — e ainda basta — registrar sua tabela com `configurarTabelas`.

   A regra que decide quem ganha quando o mesmo registro foi mexido em
   dois aparelhos (o carimbo `atualizadoEm` mais novo vence) e o apagar
   sem apagar de vez (fica marcado "removido", para o outro aparelho não
   trazer de volta o que foi excluído) são as mesmas de sempre — só
   deixaram de estar coladas a "orçamentos"/"contas" especificamente. */
import { lerJson, gravarJson } from './storage.js';
import {
  nuvemConfigurada, entrouNaNuvem, sairDaNuvem, comToken, pedirNuvem, lerSessaoNuvem,
} from './cloud.js';

const CHAVE_RECEBIDO    = 'beccaGesso.recebido.v1';     /* até onde já baixamos */
const CHAVE_ENVIADO     = 'beccaGesso.enviado.v1';      /* o que já subiu */
const CHAVE_REMOVIDOS   = 'beccaGesso.removidos.v1';    /* o que foi apagado aqui */
const CHAVE_ULTIMA_SIN  = 'beccaGesso.ultimaSincronia.v1';

const LIMITE_PAGINA = 500;

/* Preenchido por `configurarTabelas`, uma vez, na inicialização do app.
   De cada lado, o mesmo par: a tabela lá e o campo que identifica o
   registro aqui — mais as funções que leem/gravam a lista local. */
let TABELAS = {};

export function configurarTabelas(tabelas){
  TABELAS = tabelas;
}

export function tiposRegistrados(){
  return Object.keys(TABELAS);
}

function listaDe(tipo){
  return TABELAS[tipo].ler();
}

function gravarLista(tipo, lista){
  TABELAS[tipo].gravar(lista);
}

/* Apagar de verdade não basta: sem deixar registro, o outro aparelho
   mandaria o item de volta na sincronização seguinte. */
export function marcarRemovido(tipo, chave){
  if(!chave) return;
  const r = lerJson(CHAVE_REMOVIDOS, {});
  r[tipo] = r[tipo] || {};
  r[tipo][chave] = Date.now();
  gravarJson(CHAVE_REMOVIDOS, r);
  agendarSincronia();
}

/* Sair de vez: além da sessão, esquece os marcadores de sincronia, para
   uma próxima entrada baixar tudo do zero em vez de achar que já tem. */
export function esquecerNuvem(){
  sairDaNuvem();
  for(const c of [CHAVE_RECEBIDO, CHAVE_ENVIADO, CHAVE_ULTIMA_SIN]){
    try{ localStorage.removeItem(c); }catch(e){}
  }
}

/* ---------- o que ainda não subiu ---------- */

export function pendentesDe(tipo){
  const cfg = TABELAS[tipo];
  const enviado = (lerJson(CHAVE_ENVIADO, {})[tipo]) || {};
  const removidos = (lerJson(CHAVE_REMOVIDOS, {})[tipo]) || {};
  const lista = listaDe(tipo);
  const vivas = new Set(lista.map(e => e[cfg.chaveLocal]).filter(Boolean));
  const linhas = [];

  for(const e of lista){
    const k = e[cfg.chaveLocal];
    if(!k) continue;
    const quando = e.atualizadoEm || 0;
    if(enviado[k] !== quando) linhas.push({chave:k, dados:e, quando:quando, removido:false});
  }
  for(const [k, quando] of Object.entries(removidos)){
    /* um item apagado e depois restaurado volta a valer: a versão viva
       ganha da lápide */
    if(vivas.has(k)) continue;
    if(enviado[k] !== quando) linhas.push({chave:k, dados:{}, quando:quando, removido:true});
  }
  return linhas;
}

/* Quantos itens (de todos os tipos registrados) ainda não subiram —
   usado só para o aviso na tela. */
export function totalPendentes(){
  if(!podeSincronizar()) return 0;
  return tiposRegistrados().reduce((soma, t) => soma + pendentesDe(t).length, 0);
}

async function enviarPendentes(tipo){
  const linhas = pendentesDe(tipo);
  if(!linhas.length) return 0;
  const cfg = TABELAS[tipo];
  const dono = (lerSessaoNuvem() || {}).dono;

  for(let i = 0; i < linhas.length; i += LIMITE_PAGINA){
    const lote = linhas.slice(i, i + LIMITE_PAGINA);
    await comToken(() => pedirNuvem(
      `/rest/v1/${cfg.tabela}?on_conflict=dono,${cfg.coluna}`, {
        metodo:'POST',
        headers:{'Prefer':'resolution=merge-duplicates,return=minimal'},
        corpo: lote.map(l => ({
          dono: dono,
          [cfg.coluna]: l.chave,
          dados: l.removido ? {} : l.dados,
          atualizado_em: l.quando,
          removido: l.removido,
        })),
      }));
  }

  const enviado = lerJson(CHAVE_ENVIADO, {});
  enviado[tipo] = enviado[tipo] || {};
  for(const l of linhas) enviado[tipo][l.chave] = l.quando;
  gravarJson(CHAVE_ENVIADO, enviado);
  return linhas.length;
}

/* ---------- o que desceu ---------- */

function aplicarRecebidas(tipo, linhas){
  const cfg = TABELAS[tipo];
  const por = new Map(listaDe(tipo)
    .filter(e => e[cfg.chaveLocal])
    .map(e => [e[cfg.chaveLocal], e]));

  const removidos = lerJson(CHAVE_REMOVIDOS, {}); removidos[tipo] = removidos[tipo] || {};
  const enviado = lerJson(CHAVE_ENVIADO, {});     enviado[tipo]   = enviado[tipo]   || {};
  let mudou = 0;

  for(const l of linhas){
    const k = l[cfg.coluna];
    if(!k) continue;
    const aqui = por.get(k);
    const la = Number(l.atualizado_em) || 0;
    /* quando o item não está mais aqui, o que vale é a hora em que foi
       apagado — senão uma exclusão recente seria desfeita pela nuvem */
    const daqui = aqui ? (aqui.atualizadoEm || 0) : (removidos[tipo][k] || 0);
    if(daqui >= la) continue;

    if(l.removido){
      if(aqui){ por.delete(k); mudou++; }
      removidos[tipo][k] = la;
    }else{
      por.set(k, l.dados);
      delete removidos[tipo][k];
      mudou++;
    }
    /* veio de lá com esta hora: não precisa voltar para lá */
    enviado[tipo][k] = la;
  }

  if(mudou) gravarLista(tipo, [...por.values()]);
  gravarJson(CHAVE_REMOVIDOS, removidos);
  gravarJson(CHAVE_ENVIADO, enviado);
  return mudou;
}

async function receber(tipo){
  const cfg = TABELAS[tipo];
  const recebido = lerJson(CHAVE_RECEBIDO, {});
  let desde = recebido[tipo] || '1970-01-01T00:00:00Z';
  let mudou = 0;

  /* gte e não gt: dois registros podem cair no mesmo instante, e aplicar
     duas vezes o mesmo não faz mal — pular um faria */
  for(let volta = 0; volta < 50; volta++){
    const linhas = await comToken(() => pedirNuvem(
      `/rest/v1/${cfg.tabela}` +
      `?select=${cfg.coluna},dados,atualizado_em,gravado_em,removido` +
      `&gravado_em=gte.${encodeURIComponent(desde)}` +
      `&order=gravado_em.asc&limit=${LIMITE_PAGINA}`));
    if(!Array.isArray(linhas) || !linhas.length) break;

    mudou += aplicarRecebidas(tipo, linhas);
    const ultima = linhas[linhas.length - 1].gravado_em;
    recebido[tipo] = ultima;
    gravarJson(CHAVE_RECEBIDO, recebido);
    if(linhas.length < LIMITE_PAGINA) break;
    if(ultima === desde) break;      /* não avançou: para, para não girar */
    desde = ultima;
  }
  return mudou;
}

/* ---------- a sincronização ---------- */

let sincronizando = false;
let timerSincronia = null;
let aoMudarEstado = () => {};   /* app.js registra para pintar o aviso na tela */
let aoReceberNovidade = () => {}; /* app.js registra para re-renderizar telas */

export function aoMudarEstadoNuvem(fn){ aoMudarEstado = fn; }
export function aoReceberDados(fn){ aoReceberNovidade = fn; }

export function ultimaSincroniaEm(){
  return lerJson(CHAVE_ULTIMA_SIN, 0);
}

export function podeSincronizar(){
  return nuvemConfigurada() && entrouNaNuvem();
}

export function agendarSincronia(){
  if(!podeSincronizar()) return;
  clearTimeout(timerSincronia);
  timerSincronia = setTimeout(() => sincronizar({silencioso:true}), 3000);
}

export async function sincronizar(opcoes){
  const o = opcoes || {};
  if(sincronizando) return null;
  if(!podeSincronizar()) return null;
  if(navigator.onLine === false){
    aoMudarEstado('offline');
    return null;
  }

  sincronizando = true;
  aoMudarEstado('indo');
  try{
    let baixados = 0, enviados = 0;
    for(const tipo of tiposRegistrados()){
      baixados += await receber(tipo);
      enviados += await enviarPendentes(tipo);
    }
    gravarJson(CHAVE_ULTIMA_SIN, Date.now());
    if(baixados) aoReceberNovidade();
    aoMudarEstado('ok');
    return {baixados, enviados};
  }catch(erro){
    aoMudarEstado(erro.semRede ? 'offline' : 'erro', erro.message);
    if(!o.silencioso) throw erro;
    return null;
  }finally{
    sincronizando = false;
  }
}
