/* A entidade Cliente.

   Até esta etapa, nome/telefone/endereço viviam só dentro de cada
   orçamento, repetidos a cada novo documento para a mesma pessoa. Isso
   vira um cadastro central: o orçamento passa a apontar para um
   cliente (`clienteId`) em vez de guardar os dados soltos — embora ele
   continue guardando também uma cópia do nome/endereço/telefone usados
   *naquele* documento, por um motivo explicado em `migrar.js`. */
import { listaEmChave } from '../core/storage.js';
import { gerarId } from '../core/ids.js';
import { agendarSincronia, marcarRemovido } from '../core/sync.js';

const CHAVE_CLIENTES = 'beccaGesso.clientes.v1';
const { ler: lerClientesBruto, gravar: gravarClientesBruto } = listaEmChave(CHAVE_CLIENTES);

export function lerClientes(){
  return lerClientesBruto();
}

export function gravarClientes(lista){
  gravarClientesBruto(lista);
  agendarSincronia();
}

export function listarAtivos(){
  return lerClientes().filter(c => c.ativo !== false);
}

export function buscarPorId(id){
  return lerClientes().find(c => c.id === id) || null;
}

/* Busca por nome, telefone ou documento — a mesma caixa faz as três,
   como pedido para a tela de Clientes. */
export function buscar(termo){
  const t = String(termo || '').trim().toLowerCase();
  if(!t) return listarAtivos();
  const digitos = t.replace(/\D/g, '');
  return listarAtivos().filter(c => {
    if((c.nome || '').toLowerCase().includes(t)) return true;
    if((c.documento || '').toLowerCase().includes(t)) return true;
    if(digitos && (c.telefone || '').replace(/\D/g, '').includes(digitos)) return true;
    return false;
  });
}

/* `dados`: {nome, telefone, email, documento, endereco, cidade, bairro,
   observacoes}. Só `nome` é obrigatório — o resto pode ser preenchido
   depois, inclusive pela criação rápida durante um orçamento. */
export function criar(dados){
  const agora = Date.now();
  const cliente = {
    id: gerarId('cli'),
    nome: String(dados.nome || '').trim(),
    telefone: String(dados.telefone || '').trim(),
    email: String(dados.email || '').trim(),
    documento: String(dados.documento || '').trim(),
    endereco: String(dados.endereco || '').trim(),
    cidade: String(dados.cidade || '').trim(),
    bairro: String(dados.bairro || '').trim(),
    observacoes: String(dados.observacoes || '').trim(),
    criadoEm: agora,
    atualizadoEm: agora,
    ativo: true,
  };
  const lista = lerClientes();
  lista.unshift(cliente);
  gravarClientes(lista);
  return cliente;
}

export function atualizar(id, dados){
  const lista = lerClientes();
  const c = lista.find(x => x.id === id);
  if(!c) return null;
  for(const campo of ['nome','telefone','email','documento','endereco','cidade','bairro','observacoes']){
    if(dados[campo] !== undefined) c[campo] = String(dados[campo]).trim();
  }
  c.atualizadoEm = Date.now();
  gravarClientes(lista);
  return c;
}

/* Não existe exclusão de verdade — um cliente pode ter orçamentos e
   obras vinculados. "Excluir" na tela desativa: ele some da busca e das
   sugestões, mas o vínculo nos documentos antigos continua íntegro. */
export function desativar(id){
  const lista = lerClientes();
  const c = lista.find(x => x.id === id);
  if(!c) return null;
  c.ativo = false;
  c.atualizadoEm = Date.now();
  gravarClientes(lista);
  return c;
}

export function reativar(id){
  const lista = lerClientes();
  const c = lista.find(x => x.id === id);
  if(!c) return null;
  c.ativo = true;
  c.atualizadoEm = Date.now();
  gravarClientes(lista);
  return c;
}

/* Some de vez — usado só pela migração, para poder rodar de novo em
   testes sem acumular clientes de tentativas anteriores. Não é uma ação
   disponível na tela. */
export function removerDeVez(id){
  gravarClientes(lerClientes().filter(x => x.id !== id));
  marcarRemovido('clientes', id);
}

/* As duas letras que representam o cliente num círculo (histórico,
   cartão do início) — primeira e última palavra do nome, ignorando
   sufixos de empresa (Ltda, ME...), ou só a primeira se for uma
   palavra só. */
const SUFIXOS_EMPRESA = new Set(['ltda','me','epp','eireli','sa','s.a','s/a','mei']);

export function iniciaisDoNome(nome){
  const todas = String(nome || '').trim().split(/\s+/).filter(Boolean);
  const partes = todas.filter(p =>
    !SUFIXOS_EMPRESA.has(p.toLowerCase().replace(/[.,]/g, ''))) || todas;
  const lista = partes.length ? partes : todas;
  if(!lista.length) return '?';
  if(lista.length === 1) return lista[0].slice(0, 2).toUpperCase();
  return (lista[0][0] + lista[lista.length - 1][0]).toUpperCase();
}
