/* O histórico do módulo Comercial: cada linha da timeline de uma
   Oportunidade (mudou de status, teve visita, pediu desconto...).

   Regra de ouro (Etapa 3): o estado ATUAL fica em Oportunidade — status,
   datas de visita, próximo contato. O HISTÓRICO de como se chegou até
   ali fica só aqui. Nenhuma outra parte do domínio guarda de novo o que
   já está numa atividade, e nenhuma atividade guarda de novo o que já
   pertence à Oportunidade.

   `texto` é a frase para gente ler; `dados` é a mesma informação de
   forma estruturada, para quando o futuro dashboard precisar somar ou
   filtrar sem reprocessar texto (ex.: `mudanca_status` guarda
   `{de, para}`, não só "mudou de status"). */
import { listaEmChave } from '../core/storage.js';
import { gerarId } from '../core/ids.js';
import { agendarSincronia, marcarRemovido } from '../core/sync.js';

const CHAVE_ATIVIDADES = 'beccaGesso.atividadesComerciais.v1';
const { ler: lerAtividadesBruto, gravar: gravarAtividadesBruto } = listaEmChave(CHAVE_ATIVIDADES);

/* Vocabulário estável. Nem todo tipo daqui tem um gerador automático
   ainda — alguns só existirão quando a tela do Comercial (Etapa 3.3+)
   permitir registrar ligação, WhatsApp, pedido de desconto etc. à mão.
   Só `oportunidade_criada` e `mudanca_status` são gerados sozinhos por
   esta etapa. */
export const TIPOS = [
  'oportunidade_criada', 'mudanca_status', 'orcamento_criado',
  'orcamento_atualizado', 'orcamento_compartilhado', 'visita_agendada',
  'visita_realizada', 'ligacao', 'whatsapp', 'contato_outro',
  'pediu_desconto', 'pediu_prazo', 'observacao',
];

/* Por oportunidade, não global: uma oportunidade muito ativa não pode
   apagar o histórico de outra só por ter mais eventos. */
export const MAX_ATIVIDADES = 300;

export function lerAtividades(){
  return lerAtividadesBruto();
}

export function gravarAtividades(lista){
  gravarAtividadesBruto(lista);
  agendarSincronia();
}

export function listarPorOportunidade(oportunidadeId){
  return lerAtividades()
    .filter(a => a.oportunidadeId === oportunidadeId)
    .sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
}

/* Mantém só as MAX_ATIVIDADES mais recentes desta oportunidade; as
   atividades de qualquer outra oportunidade não são tocadas. Como toda
   gravação nova entra por `unshift`, a ordem "mais nova primeiro" já
   vem pronta — não precisa reordenar para saber quais são as mais
   antigas. */
function aparar(lista, oportunidadeId){
  const desta = lista.filter(a => a.oportunidadeId === oportunidadeId);
  if(desta.length <= MAX_ATIVIDADES) return lista;
  const manter = new Set(desta.slice(0, MAX_ATIVIDADES).map(a => a.id));
  return lista.filter(a => a.oportunidadeId !== oportunidadeId || manter.has(a.id));
}

/* `dados`: {oportunidadeId, tipo, texto, dados, automatica}. */
export function criar(dados){
  const d = dados || {};
  const agora = Date.now();
  const atividade = {
    id: gerarId('ativ'),
    oportunidadeId: d.oportunidadeId,
    tipo: d.tipo,
    texto: String(d.texto || '').trim(),
    dados: d.dados || null,
    automatica: !!d.automatica,
    criadoEm: agora,
  };
  let lista = lerAtividades();
  lista.unshift(atividade);
  lista = aparar(lista, atividade.oportunidadeId);
  gravarAtividades(lista);
  return atividade;
}

/* Usado só pela migração/testes, para poder rodar de novo sem acumular
   atividades de tentativas anteriores. Não é uma ação disponível na
   tela. */
export function removerDeVez(id){
  gravarAtividades(lerAtividades().filter(x => x.id !== id));
  marcarRemovido('atividadesComerciais', id);
}

/* ---------- os dois geradores automáticos desta etapa ----------
   Cada tipo automático tem exatamente uma função dona — nenhum outro
   lugar do código cria um evento `oportunidade_criada` ou
   `mudanca_status` por conta própria. */

export function registrarOportunidadeCriada(oportunidadeId, titulo){
  return criar({
    oportunidadeId,
    tipo: 'oportunidade_criada',
    texto: `Oportunidade "${titulo}" criada`,
    dados: null,
    automatica: true,
  });
}

export function registrarMudancaStatus(oportunidadeId, de, para){
  return criar({
    oportunidadeId,
    tipo: 'mudanca_status',
    texto: `Mudou de ${de} para ${para}`,
    dados: {de, para},
    automatica: true,
  });
}
