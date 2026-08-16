/* A entidade MotivoPerda: por que uma oportunidade foi perdida (Preço,
   Prazo, Concorrente...). Mesmo papel de OrigemLead — cadastro central
   em vez de string solta, seguindo o mesmo molde. */
import { listaEmChave } from '../core/storage.js';
import { gerarId } from '../core/ids.js';
import { agendarSincronia, marcarRemovido } from '../core/sync.js';

const CHAVE_MOTIVOS = 'beccaGesso.motivosPerda.v1';
const { ler: lerMotivosBruto, gravar: gravarMotivosBruto } = listaEmChave(CHAVE_MOTIVOS);

export const NOMES_PADRAO = [
  'Preço', 'Prazo', 'Concorrente', 'Desistiu',
  'Sem retorno', 'Projeto cancelado', 'Sem orçamento', 'Outro',
];

export function lerMotivosPerda(){
  return lerMotivosBruto();
}

export function gravarMotivosPerda(lista){
  gravarMotivosBruto(lista);
  agendarSincronia();
}

export function listarAtivos(){
  return lerMotivosPerda().filter(m => m.ativo !== false);
}

export function buscarPorId(id){
  return lerMotivosPerda().find(m => m.id === id) || null;
}

export function criar(nome){
  const agora = Date.now();
  const motivo = {
    id: gerarId('mot'),
    nome: String(nome || '').trim(),
    criadoEm: agora,
    atualizadoEm: agora,
    ativo: true,
  };
  const lista = lerMotivosPerda();
  lista.push(motivo);
  gravarMotivosPerda(lista);
  return motivo;
}

/* Usado só pela migração/testes, para poder rodar de novo sem acumular
   motivos de tentativas anteriores. Não é uma ação disponível na tela. */
export function removerDeVez(id){
  gravarMotivosPerda(lerMotivosPerda().filter(x => x.id !== id));
  marcarRemovido('motivosPerda', id);
}

/* Idempotente: cria os motivos padrão só na primeira vez (lista vazia).
   Rodar de novo não duplica nada. */
export function semearPadrao(){
  if(lerMotivosPerda().length) return;
  gravarMotivosPerda(NOMES_PADRAO.map(nome => {
    const agora = Date.now();
    return {
      id: gerarId('mot'),
      nome,
      criadoEm: agora,
      atualizadoEm: agora,
      ativo: true,
    };
  }));
}
