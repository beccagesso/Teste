/* A entidade OrigemLead: de onde veio cada oportunidade (Indicação,
   Instagram, Google...). Existe para a lista não ficar espalhada em
   strings soltas pelo código — cadastro central, editável no futuro
   sem mexer em nenhuma tela, igual às categorias financeiras. */
import { listaEmChave } from '../core/storage.js';
import { gerarId } from '../core/ids.js';
import { agendarSincronia, marcarRemovido } from '../core/sync.js';

const CHAVE_ORIGENS = 'beccaGesso.origensLead.v1';
const { ler: lerOrigensBruto, gravar: gravarOrigensBruto } = listaEmChave(CHAVE_ORIGENS);

export const NOMES_PADRAO = [
  'Indicação', 'Instagram', 'Google', 'WhatsApp', 'Facebook',
  'Site', 'Cliente antigo', 'Parceiro', 'Outro',
];

export function lerOrigens(){
  return lerOrigensBruto();
}

export function gravarOrigens(lista){
  gravarOrigensBruto(lista);
  agendarSincronia();
}

export function listarAtivas(){
  return lerOrigens().filter(o => o.ativo !== false);
}

export function buscarPorId(id){
  return lerOrigens().find(o => o.id === id) || null;
}

export function criar(nome){
  const agora = Date.now();
  const origem = {
    id: gerarId('org'),
    nome: String(nome || '').trim(),
    criadoEm: agora,
    atualizadoEm: agora,
    ativo: true,
  };
  const lista = lerOrigens();
  lista.push(origem);
  gravarOrigens(lista);
  return origem;
}

/* Usado só pela migração/testes, para poder rodar de novo sem acumular
   origens de tentativas anteriores. Não é uma ação disponível na tela. */
export function removerDeVez(id){
  gravarOrigens(lerOrigens().filter(x => x.id !== id));
  marcarRemovido('origens', id);
}

/* Idempotente: cria as origens padrão só na primeira vez (lista vazia).
   Rodar de novo não duplica nada. */
export function semearPadrao(){
  if(lerOrigens().length) return;
  gravarOrigens(NOMES_PADRAO.map(nome => {
    const agora = Date.now();
    return {
      id: gerarId('org'),
      nome,
      criadoEm: agora,
      atualizadoEm: agora,
      ativo: true,
    };
  }));
}
