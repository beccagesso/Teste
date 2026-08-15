/* Contas a pagar: leitura/escrita, situação (vencida/a vencer/paga) e as
   ações do dia a dia (marcar como paga, repetir no mês seguinte,
   excluir).

   `fornecedor`/`categoria` (texto) continuam existindo tal como estavam
   — é o que já está gravado em toda conta antiga e o que a lista/busca
   usa direto, sem precisar saber se veio de um cadastro ou foi digitado
   na hora. `fornecedorId`/`categoriaId` são novos e opcionais: quando a
   conta foi criada apontando para um Fornecedor/Categoria cadastrado,
   eles guardam esse vínculo, sem exigir nada de quem só quer lançar uma
   conta rápida com um nome digitado. */
import { listaEmChave } from '../core/storage.js';
import { gerarId } from '../core/ids.js';
import { agendarSincronia, marcarRemovido } from '../core/sync.js';
import { diasAteVencer, hojeISO } from '../core/dates.js';

const CHAVE_CONTAS = 'beccaGesso.contas.v1';
const { ler: lerContas, gravar: gravarContasBruto } = listaEmChave(CHAVE_CONTAS);

export { lerContas };

export function gravarContas(lista){
  gravarContasBruto(lista);
  agendarSincronia();
}

export function situacaoDaConta(c){
  if(c.pago) return 'paga';
  const dias = diasAteVencer(c.vencimento);
  if(dias === null) return 'avencer';
  if(dias < 0) return 'vencida';
  if(dias === 0) return 'hoje';
  return 'avencer';
}

export const ROTULO_SITUACAO = {
  vencida: 'Vencida',
  hoje: 'Vence hoje',
  avencer: 'A vencer',
  paga: 'Paga',
};

/* `dados`: {descricao, fornecedor, fornecedorId, categoria, categoriaId,
   valor, vencimento, obs}. `idEditando`: id da conta em edição, ou
   falsy para criar uma nova. A validação de campo obrigatório é da UI —
   aqui já chega o que deve ser gravado. */
export function salvarConta(dados, idEditando){
  const lista = lerContas();
  const campos = Object.assign({}, dados, {atualizadoEm: Date.now()});
  if(idEditando){
    const c = lista.find(x => x.id === idEditando);
    if(c) Object.assign(c, campos);
  }else{
    lista.push(Object.assign({
      id: gerarId('conta'),
      pago: false,
      pagoEm: null,
      criadoEm: Date.now(),
    }, campos));
  }
  gravarContas(lista);
}

export function alternarPagamento(id){
  const lista = lerContas();
  const c = lista.find(x => x.id === id);
  if(!c) return null;
  c.pago = !c.pago;
  c.pagoEm = c.pago ? hojeISO() : null;
  c.atualizadoEm = Date.now();
  gravarContas(lista);
  return c;
}

/* Aluguel, internet e contador voltam todo mês. Em vez de um sistema de
   repetição, um toque cria a conta do mês seguinte já preenchida.
   Devolve {ok:true, quando} ou {ok:false, motivo:'duplicada', quando}. */
export function repetirNoProximoMes(id){
  const lista = lerContas();
  const c = lista.find(x => x.id === id);
  if(!c) return {ok:false, motivo:'nao-encontrada'};

  const d = new Date(c.vencimento + 'T00:00:00');
  const diaOriginal = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  /* 31 de janeiro repetido cai no último dia de fevereiro, não em março */
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(diaOriginal, ultimoDia));
  const proximo = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  if(lista.some(x => x.descricao === c.descricao && x.vencimento === proximo)){
    return {ok:false, motivo:'duplicada', quando: proximo};
  }

  lista.push({
    id: gerarId('conta'),
    descricao: c.descricao,
    fornecedor: c.fornecedor,
    fornecedorId: c.fornecedorId,
    categoria: c.categoria,
    categoriaId: c.categoriaId,
    valor: c.valor,
    vencimento: proximo,
    obs: c.obs,
    pago: false,
    pagoEm: null,
    criadoEm: Date.now(),
    atualizadoEm: Date.now(),
  });
  gravarContas(lista);
  return {ok:true, quando: proximo};
}

export function excluirConta(id){
  const c = lerContas().find(x => x.id === id);
  if(!c) return null;
  gravarContas(lerContas().filter(x => x.id !== id));
  marcarRemovido('contas', id);
  return c;
}
