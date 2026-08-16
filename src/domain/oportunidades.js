/* A entidade Oportunidade: uma venda em potencial, do primeiro contato
   até aprovada ou perdida. Pertence a exatamente um Cliente e pode ter
   vários Orçamentos (ou nenhum) — o vínculo do lado do Orçamento é
   opcional e mora em `orcamentos.js` (`oportunidadeId`), não aqui.

   Regra de ouro: o que está acontecendo AGORA fica nos campos abaixo
   (`status`, as datas). COMO se chegou até aqui é histórico, e histórico
   vive em `atividadesComerciais.js` — esta entidade nunca reconstrói
   nem guarda de novo o que já está lá. */
import { listaEmChave } from '../core/storage.js';
import { gerarId } from '../core/ids.js';
import { agendarSincronia, marcarRemovido } from '../core/sync.js';
import * as atividades from './atividadesComerciais.js';

const CHAVE_OPORTUNIDADES = 'beccaGesso.oportunidades.v1';
const { ler: lerOportunidadesBruto, gravar: gravarOportunidadesBruto } = listaEmChave(CHAVE_OPORTUNIDADES);

/* Fonte única de verdade dos status — nenhuma outra parte do código
   deve aceitar uma string de status que não venha desta lista. Sete
   valores: cinco não-terminais e dois terminais (aprovada/perdida). */
export const STATUS_OPORTUNIDADE = [
  {chave:'novo',       rotulo:'Novo'},
  {chave:'contato',    rotulo:'Contato'},
  {chave:'visita',     rotulo:'Visita'},
  {chave:'orcamento',  rotulo:'Orçamento'},
  {chave:'negociacao', rotulo:'Negociação'},
  {chave:'aprovada',   rotulo:'Aprovada'},
  {chave:'perdida',    rotulo:'Perdida'},
];
const STATUS_VALIDOS = new Set(STATUS_OPORTUNIDADE.map(s => s.chave));

export function statusValido(status){
  return STATUS_VALIDOS.has(status);
}

export function lerOportunidades(){
  return lerOportunidadesBruto();
}

export function gravarOportunidades(lista){
  gravarOportunidadesBruto(lista);
  agendarSincronia();
}

export function listar(){
  return lerOportunidades().filter(o => o.ativo !== false);
}

export function buscarPorId(id){
  return lerOportunidades().find(o => o.id === id) || null;
}

export function listarPorCliente(clienteId){
  return listar().filter(o => o.clienteId === clienteId);
}

/* `dados`: {clienteId, titulo, origemId, origemDetalhe, valorEstimado,
   responsavel, visitaAgendadaEm, proximoContatoEm}. `clienteId` e
   `titulo` são obrigatórios — sem eles não há o que criar, e devolve
   `null` em vez de lançar erro, seguindo o mesmo padrão que o resto do
   domínio já usa para "não achei"/"não pude" (ver `atualizar`/
   `desativar` de clientes.js). Começa sempre em `novo`; `valorAprovado`
   não existe como campo — é derivado do orçamento aprovado quando
   houver um vínculo, para não ter duas fontes de verdade. */
export function criar(dados){
  const d = dados || {};
  const titulo = String(d.titulo || '').trim();
  if(!titulo) return null;
  if(!d.clienteId) return null;

  const agora = Date.now();
  const oportunidade = {
    id: gerarId('opo'),
    clienteId: d.clienteId,
    titulo,
    status: 'novo',
    origemId: d.origemId || null,
    origemDetalhe: String(d.origemDetalhe || '').trim(),
    valorEstimado: Number(d.valorEstimado) || 0,
    responsavel: String(d.responsavel || '').trim(),
    visitaAgendadaEm: d.visitaAgendadaEm || null,
    visitaRealizadaEm: d.visitaRealizadaEm || null,
    proximoContatoEm: d.proximoContatoEm || null,
    motivoPerdaId: null,
    motivoPerdaDetalhe: '',
    criadoEm: agora,
    atualizadoEm: agora,
    ativo: true,
  };
  const lista = lerOportunidades();
  lista.unshift(oportunidade);
  gravarOportunidades(lista);
  atividades.registrarOportunidadeCriada(oportunidade.id, oportunidade.titulo);
  return oportunidade;
}

/* Não muda `status` (isso é só `alterarStatus` — editar dados
   cadastrais aqui nunca muda o estado da oportunidade, nem quando ela
   está aprovada ou perdida). Um `titulo` vazio é rejeitado do mesmo
   jeito que na criação; um `clienteId` esvaziado também (a oportunidade
   continua pertencendo a exatamente um cliente — só passa a apontar
   para outro). Trocar o cliente daqui nunca toca nenhum orçamento: o
   vínculo de cada orçamento com seu cliente é independente (mora em
   `orcamentos.js`, com o próprio snapshot), e esta função nunca lê nem
   grava nada lá. */
export function atualizar(id, dados){
  const d = dados || {};
  const lista = lerOportunidades();
  const o = lista.find(x => x.id === id);
  if(!o) return null;

  if(d.titulo !== undefined){
    const t = String(d.titulo).trim();
    if(!t) return null;
    o.titulo = t;
  }
  if(d.clienteId !== undefined){
    if(!d.clienteId) return null;
    o.clienteId = d.clienteId;
  }
  if(d.origemId !== undefined) o.origemId = d.origemId || null;
  if(d.origemDetalhe !== undefined) o.origemDetalhe = String(d.origemDetalhe).trim();
  if(d.valorEstimado !== undefined) o.valorEstimado = Number(d.valorEstimado) || 0;
  if(d.responsavel !== undefined) o.responsavel = String(d.responsavel).trim();
  for(const campo of ['visitaAgendadaEm', 'visitaRealizadaEm', 'proximoContatoEm']){
    if(d[campo] !== undefined) o[campo] = d[campo] || null;
  }
  if(d.motivoPerdaId !== undefined) o.motivoPerdaId = d.motivoPerdaId || null;
  if(d.motivoPerdaDetalhe !== undefined) o.motivoPerdaDetalhe = String(d.motivoPerdaDetalhe).trim();

  o.atualizadoEm = Date.now();
  gravarOportunidades(lista);
  return o;
}

/* Não existe exclusão de verdade — desativar não apaga cliente,
   orçamentos vinculados nem o histórico de atividades. */
export function desativar(id){
  const lista = lerOportunidades();
  const o = lista.find(x => x.id === id);
  if(!o) return null;
  o.ativo = false;
  o.atualizadoEm = Date.now();
  gravarOportunidades(lista);
  return o;
}

export function reativar(id){
  const lista = lerOportunidades();
  const o = lista.find(x => x.id === id);
  if(!o) return null;
  o.ativo = true;
  o.atualizadoEm = Date.now();
  gravarOportunidades(lista);
  return o;
}

/* Some de vez — usado só pela migração/testes, para poder rodar de novo
   sem acumular oportunidades de tentativas anteriores. */
export function removerDeVez(id){
  gravarOportunidades(lerOportunidades().filter(x => x.id !== id));
  marcarRemovido('oportunidades', id);
}

/* A única função que muda `status`. `extras`: {motivoPerdaId,
   motivoPerdaDetalhe} — obrigatório passar `motivoPerdaId` para ENTRAR
   em `perdida` (não para permanecer nela). Devolve `null` para status
   inválido, oportunidade inexistente, ou perda sem motivo — nunca
   lança erro, mesmo padrão do resto do domínio. Mudar para o mesmo
   status não gera evento novo (só atualiza `atualizadoEm`): nada
   mudou, não há o que registrar na timeline. */
export function alterarStatus(oportunidadeId, novoStatus, extras){
  if(!statusValido(novoStatus)) return null;

  const lista = lerOportunidades();
  const o = lista.find(x => x.id === oportunidadeId);
  if(!o) return null;

  const ex = extras || {};
  const de = o.status;

  if(novoStatus === 'perdida' && de !== 'perdida' && !ex.motivoPerdaId) return null;

  if(de === novoStatus){
    o.atualizadoEm = Date.now();
    gravarOportunidades(lista);
    return o;
  }

  if(novoStatus === 'perdida'){
    o.motivoPerdaId = ex.motivoPerdaId;
    o.motivoPerdaDetalhe = String(ex.motivoPerdaDetalhe || '').trim();
  }
  o.status = novoStatus;
  o.atualizadoEm = Date.now();
  gravarOportunidades(lista);
  atividades.registrarMudancaStatus(oportunidadeId, de, novoStatus);
  return o;
}
