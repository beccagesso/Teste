/* A entidade Fornecedor — o mesmo papel para as contas a pagar que
   Cliente tem para os orçamentos: um cadastro central em vez de um
   nome redigitado em cada conta lançada. */
import { listaEmChave } from '../core/storage.js';
import { gerarId } from '../core/ids.js';
import { agendarSincronia, marcarRemovido } from '../core/sync.js';

const CHAVE_FORNECEDORES = 'beccaGesso.fornecedores.v1';
const { ler: lerFornecedoresBruto, gravar: gravarFornecedoresBruto } = listaEmChave(CHAVE_FORNECEDORES);

export function lerFornecedores(){
  return lerFornecedoresBruto();
}

export function gravarFornecedores(lista){
  gravarFornecedoresBruto(lista);
  agendarSincronia();
}

export function listarAtivos(){
  return lerFornecedores().filter(f => f.ativo !== false);
}

export function buscarPorId(id){
  return lerFornecedores().find(f => f.id === id) || null;
}

export function buscar(termo){
  const t = String(termo || '').trim().toLowerCase();
  if(!t) return listarAtivos();
  return listarAtivos().filter(f =>
    (f.nome || '').toLowerCase().includes(t) ||
    (f.documento || '').toLowerCase().includes(t));
}

/* `dados`: {nome, documento, telefone, email, observacoes}. */
export function criar(dados){
  const agora = Date.now();
  const fornecedor = {
    id: gerarId('for'),
    nome: String(dados.nome || '').trim(),
    documento: String(dados.documento || '').trim(),
    telefone: String(dados.telefone || '').trim(),
    email: String(dados.email || '').trim(),
    observacoes: String(dados.observacoes || '').trim(),
    criadoEm: agora,
    atualizadoEm: agora,
    ativo: true,
  };
  const lista = lerFornecedores();
  lista.unshift(fornecedor);
  gravarFornecedores(lista);
  return fornecedor;
}

export function atualizar(id, dados){
  const lista = lerFornecedores();
  const f = lista.find(x => x.id === id);
  if(!f) return null;
  for(const campo of ['nome','documento','telefone','email','observacoes']){
    if(dados[campo] !== undefined) f[campo] = String(dados[campo]).trim();
  }
  f.atualizadoEm = Date.now();
  gravarFornecedores(lista);
  return f;
}

export function desativar(id){
  const lista = lerFornecedores();
  const f = lista.find(x => x.id === id);
  if(!f) return null;
  f.ativo = false;
  f.atualizadoEm = Date.now();
  gravarFornecedores(lista);
  return f;
}

/* Acha um fornecedor pelo nome (sem diferenciar maiúsculas) ou cria um
   novo — usado tanto pela migração quanto pela criação rápida ao
   digitar um fornecedor novo numa conta. */
export function buscarOuCriarPorNome(nome){
  const alvo = String(nome || '').trim();
  if(!alvo) return null;
  const existente = lerFornecedores()
    .find(f => f.nome.toLowerCase() === alvo.toLowerCase());
  return existente || criar({nome: alvo});
}

export function removerDeVez(id){
  gravarFornecedores(lerFornecedores().filter(x => x.id !== id));
  marcarRemovido('fornecedores', id);
}
