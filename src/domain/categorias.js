/* A entidade CategoriaFinanceira. As oito categorias que já existiam
   fixas no código (Material, Ferramenta...) viram os primeiros
   registros dela, todos do tipo DESPESA — hoje é só o que a tela de
   contas a pagar usa. `tipo` já existe para quando houver receita
   (contas a receber, Etapa 3+), mas nenhuma tela usa RECEITA ainda; não
   foi montado um DRE nem uma tela de gestão de categorias — só a
   estrutura, como pedido. */
import { listaEmChave } from '../core/storage.js';
import { gerarId } from '../core/ids.js';
import { agendarSincronia, marcarRemovido } from '../core/sync.js';

const CHAVE_CATEGORIAS = 'beccaGesso.categorias.v1';
const { ler: lerCategoriasBruto, gravar: gravarCategoriasBruto } = listaEmChave(CHAVE_CATEGORIAS);

export const TIPOS = ['DESPESA', 'RECEITA'];

export const NOMES_PADRAO = ['Material', 'Ferramenta', 'Mão de obra', 'Transporte',
                              'Imposto', 'Aluguel', 'Serviços', 'Outros'];

export function lerCategorias(){
  return lerCategoriasBruto();
}

export function gravarCategorias(lista){
  gravarCategoriasBruto(lista);
  agendarSincronia();
}

export function listarAtivas(tipo){
  return lerCategorias().filter(c => c.ativo !== false && (!tipo || c.tipo === tipo));
}

export function buscarPorId(id){
  return lerCategorias().find(c => c.id === id) || null;
}

export function buscarPorNome(nome){
  const alvo = String(nome || '').trim().toLowerCase();
  if(!alvo) return null;
  return lerCategorias().find(c => c.nome.toLowerCase() === alvo) || null;
}

export function criar(nome, tipo){
  const agora = Date.now();
  const categoria = {
    id: gerarId('cat'),
    nome: String(nome || '').trim(),
    tipo: TIPOS.includes(tipo) ? tipo : 'DESPESA',
    criadoEm: agora,
    atualizadoEm: agora,
    ativo: true,
  };
  const lista = lerCategorias();
  lista.push(categoria);
  gravarCategorias(lista);
  return categoria;
}

export function removerDeVez(id){
  gravarCategorias(lerCategorias().filter(x => x.id !== id));
  marcarRemovido('categorias', id);
}

/* Idempotente: cria as categorias padrão só na primeira vez (lista
   vazia). Rodar de novo não duplica nada. */
export function semearPadrao(){
  if(lerCategorias().length) return;
  gravarCategorias(NOMES_PADRAO.map(nome => {
    const agora = Date.now();
    return {
      id: gerarId('cat'),
      nome,
      tipo: 'DESPESA',
      criadoEm: agora,
      atualizadoEm: agora,
      ativo: true,
    };
  }));
}
