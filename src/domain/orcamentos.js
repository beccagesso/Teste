/* O orçamento: leitura/escrita do histórico, situação (funil) e os
   retornos ao cliente pelo WhatsApp.

   O identificador visível continua sendo o número ("0001/2026") — é o
   que a Becca já usa para falar de um orçamento, e trocar isso agora
   não foi pedido. O que muda é que cada entrada passa a carregar também
   um `id` técnico estável (ex.: "orc_lz3k9f2a"), pensado para quando o
   app precisar apontar para "este orçamento" de um jeito que sobrevive
   a uma renumeração — hoje ele só serve para o vínculo com o cliente. */
import { listaEmChave, lerJson, gravarJson } from '../core/storage.js';
import { gerarId } from '../core/ids.js';
import { agendarSincronia } from '../core/sync.js';
import { totalComDesconto } from '../calculations/orcamento.js';
import { addDias, fmtDate } from '../core/dates.js';
import { formatar as fmtMoeda } from '../core/money.js';

const CHAVE_HISTORICO = 'beccaGesso.historico.v1';
const MAX_HISTORICO = 300;

/* Condições predefinidas de cada orçamento novo. Elas podem ser mudadas
   orçamento a orçamento, sem mexer aqui. */
export const PADRAO = {
  parcelas: 5,
  descontoAvista: 6,        /* em % */
  validadeDias: 15,
};

const { ler: lerHistoricoBruto, gravar: gravarHistoricoBruto } = listaEmChave(CHAVE_HISTORICO);

export function lerHistorico(){
  return lerHistoricoBruto();
}

export function gravarHistorico(lista){
  gravarHistoricoBruto(lista.slice(0, MAX_HISTORICO));
  agendarSincronia();
}

/* Em que pé está cada orçamento. A ordem é a do fluxo normal. */
export const SITUACOES = [
  {chave:'rascunho', rotulo:'Rascunho'},
  {chave:'enviado',  rotulo:'Enviado'},
  {chave:'aprovado', rotulo:'Aprovado'},
  {chave:'recusado', rotulo:'Recusado'},
];

export function situacaoValida(s){
  return SITUACOES.some(x => x.chave === s) ? s : 'rascunho';
}

export function temConteudo(e){
  return !!(e.cliNome || '').trim()
    || (e.servicos || []).some(s => (s.desc || '').trim() || Number(s.valor) > 0);
}

/* Grava (ou atualiza) a entrada do histórico para este número. Situação,
   data de envio e retornos já dados são do ORÇAMENTO, não do que está
   sendo digitado agora — reescrever a entrada a cada tecla não pode
   rebaixar um aprovado para rascunho nem apagar os retornos já feitos. */
export function arquivar(estado){
  if(!temConteudo(estado)) return null;
  const lista = lerHistorico();
  const anterior = lista.find(x => x.orcNumero === estado.orcNumero);
  const entrada = Object.assign({}, estado, {
    id: (anterior && anterior.id) || estado.id || gerarId('orc'),
    total: totalComDesconto(estado),
    situacao: situacaoValida(anterior && anterior.situacao),
    enviadoEm: (anterior && anterior.enviadoEm) || undefined,
    retornos: (anterior && anterior.retornos) || undefined,
    /* opcional — vínculo com uma Oportunidade (Etapa 3). Preserva o que
       já estava gravado mesmo que a tela ainda não tenha como editá-lo,
       para não perder o vínculo a cada resalvamento automático. */
    oportunidadeId: (anterior && anterior.oportunidadeId) || estado.oportunidadeId || null,
    atualizadoEm: Date.now(),
  });
  const semEla = lista.filter(x => x.orcNumero !== entrada.orcNumero);
  semEla.unshift(entrada);
  gravarHistorico(semEla);
  return entrada;
}

export function marcarSituacao(numero, situacao){
  const lista = lerHistorico();
  const e = lista.find(x => x.orcNumero === numero);
  if(!e) return false;
  e.situacao = situacaoValida(situacao);
  /* guarda quando foi enviado: é dessa data que saem os retornos */
  if(e.situacao === 'enviado' && !e.enviadoEm) e.enviadoEm = Date.now();
  e.atualizadoEm = Date.now();
  gravarHistorico(lista);
  return true;
}

/* ---------- numeração sequencial ---------- */

const CHAVE_CONTADOR = 'beccaGesso.contador.v1';

export function proximoNumero(){
  const ano = new Date().getFullYear();
  let c = {ano:ano, seq:0};
  try{
    const bruto = localStorage.getItem(CHAVE_CONTADOR);
    if(bruto){
      const lido = JSON.parse(bruto);
      if(lido && typeof lido.seq === 'number' && lido.ano === ano) c = lido;
    }
  }catch(e){ /* armazenamento indisponível: segue com 0 */ }
  c.seq++;
  try{ localStorage.setItem(CHAVE_CONTADOR, JSON.stringify(c)); }catch(e){}
  return `${String(c.seq).padStart(4,'0')}/${ano}`;
}

/* ---------- retorno ao cliente ----------
   O app não consegue avisar sozinho no dia certo: um app web no iPhone
   precisaria de um servidor para disparar aviso, e este não tem nenhum.
   O que ele faz é mostrar os retornos pendentes quando você abre. */

export const ETAPAS_RETORNO = [1, 5, 10];       /* dias depois do envio */
const DIA_EM_MS = 24 * 60 * 60 * 1000;

export function soDigitos(tel){
  return String(tel || '').replace(/\D/g, '');
}

/* Monta o número no formato que o WhatsApp abre: código do país junto. */
export function telefoneParaWhats(tel){
  let d = soDigitos(tel);
  if(d.length < 10) return '';           /* falta o DDD */
  if(d.length <= 11) d = '55' + d;       /* número brasileiro sem o 55 */
  if(d.length > 13) return '';
  return d;
}

function diasDesde(quando){
  if(!quando) return null;
  return Math.floor((Date.now() - quando) / DIA_EM_MS);
}

/* Qual retorno este orçamento está pedindo agora, se algum. */
export function retornoPendente(e){
  if(situacaoValida(e.situacao) !== 'enviado') return null;
  if(!telefoneParaWhats(e.cliTelefone)) return null;
  const dias = diasDesde(e.enviadoEm);
  if(dias === null) return null;
  const feitos = Array.isArray(e.retornos) ? e.retornos : [];
  /* a etapa mais avançada que já venceu e ainda não foi feita */
  const devidas = ETAPAS_RETORNO.filter(x => dias >= x && !feitos.includes(x));
  if(!devidas.length) return null;
  return {etapa: Math.max(...devidas), dias: dias};
}

export function orcamentosParaRetorno(){
  return lerHistorico()
    .map(e => ({entrada: e, pendente: retornoPendente(e)}))
    .filter(x => x.pendente)
    .sort((a, b) => b.pendente.dias - a.pendente.dias);
}

export function marcarRetornoFeito(numero, etapa){
  const lista = lerHistorico();
  const e = lista.find(x => x.orcNumero === numero);
  if(!e) return;
  const feitos = Array.isArray(e.retornos) ? e.retornos : [];
  /* dá por feitas todas as etapas até esta, para não voltar a cobrar
     a de 1 dia depois de já ter cobrado a de 10 */
  e.retornos = [...new Set([...feitos, ...ETAPAS_RETORNO.filter(x => x <= etapa)])];
  e.atualizadoEm = Date.now();
  gravarHistorico(lista);
}

/* ---------- textos de retorno ----------
   Editáveis: o app não sabe o nome da Becca nem como ela costuma falar
   com cada cliente. */

const CHAVE_MENSAGENS = 'beccaGesso.mensagens.v1';

export const MENSAGENS_PADRAO = {
  d1: 'Oi {primeiro}, tudo bem? Passei o orçamento nº {numero} ({valor}) ' +
      'para você. Conseguiu dar uma olhada?',
  d5: 'Oi {primeiro}, tudo bem? Passando para saber se ficou alguma dúvida ' +
      'sobre o orçamento nº {numero} ({valor}). Qualquer ajuste, é só falar.',
  d10: 'Oi {primeiro}, tudo bem? Passando para lembrar que o orçamento ' +
       'nº {numero} ({valor}) vale até {validade}. Quer seguir com o serviço?',
  vencido: 'Oi {primeiro}, tudo bem? O orçamento nº {numero} venceu em ' +
           '{validade}. Se ainda tiver interesse, atualizo os valores.',
};

export const MARCADORES = [
  ['{cliente}', 'nome do cliente como você digitou'],
  ['{primeiro}', 'só o primeiro nome'],
  ['{numero}', 'número do orçamento'],
  ['{valor}', 'valor total'],
  ['{validade}', 'data até quando vale'],
];

export function lerMensagens(){
  const guardadas = lerJson(CHAVE_MENSAGENS, {}) || {};
  const saida = {};
  /* texto em branco volta ao padrão, para nunca mandar mensagem vazia */
  for(const chave of Object.keys(MENSAGENS_PADRAO)){
    const t = (guardadas[chave] || '').trim();
    saida[chave] = t || MENSAGENS_PADRAO[chave];
  }
  return saida;
}

export function gravarMensagens(m){
  gravarJson(CHAVE_MENSAGENS, m);
}

/* Monta o texto trocando os marcadores pelos dados do orçamento. */
export function mensagemDeRetorno(e, etapa){
  const dias = (e.condicoes && e.condicoes.validadeDias) || PADRAO.validadeDias;
  const ateQuando = addDias(e.orcData, dias);
  const venceu = ateQuando && ateQuando < new Date();
  const modelos = lerMensagens();

  const modelo = etapa >= 10
    ? (venceu ? modelos.vencido : modelos.d10)
    : (etapa >= 5 ? modelos.d5 : modelos.d1);

  const nomeInteiro = (e.cliNome || '').trim();
  const valores = {
    '{cliente}': nomeInteiro,
    '{primeiro}': nomeInteiro.split(/\s+/)[0] || '',
    '{numero}': e.orcNumero || '',
    '{valor}': fmtMoeda(e.total || 0),
    '{validade}': fmtDate(ateQuando),
  };

  let texto = modelo;
  for(const [marcador, valor] of Object.entries(valores)){
    texto = texto.split(marcador).join(valor);
  }
  /* sem nome, "Oi , tudo bem?" fica esquisito */
  return texto.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();
}
