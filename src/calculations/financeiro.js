/* Cálculos financeiros que não são de um orçamento específico: os
   resumos que alimentam a tela de Início e a lista de contas a vencer.

   Cada função recebe a lista já lida (de orçamentos ou de contas) — quem
   lê do armazenamento é a camada de domínio, não aqui. Isso deixa estas
   contas testáveis sem precisar simular localStorage. */
import { diasAteVencer } from '../core/dates.js';
import { somar } from '../core/money.js';

const DIAS_VENCENDO = 7;

export function somaValores(lista){
  return somar((lista || []).map(e => e.valor || e.total || 0));
}

export function resumoContasInicio(todasContas, mesISOAtual){
  const abertas = todasContas.filter(c => !c.pago);
  const dias = c => diasAteVencer(c.vencimento);
  const grupo = l => ({qtd: l.length, valor: somaValores(l)});
  return {
    vencidas: grupo(abertas.filter(c => dias(c) !== null && dias(c) < 0)),
    /* "vence em 7 dias" inclui hoje: hoje é o prazo mais curto que existe */
    semana: grupo(abertas.filter(c => {
      const d = dias(c);
      return d !== null && d >= 0 && d <= DIAS_VENCENDO;
    })),
    pagasMes: grupo(todasContas.filter(c => c.pago && String(c.pagoEm || '').startsWith(mesISOAtual))),
    abertas: grupo(abertas),
  };
}

/* O que já venceu ou vence dentro da semana, do mais urgente para o menos. */
export function contasVencendo(todasContas){
  return todasContas
    .filter(c => {
      if(c.pago) return false;
      const d = diasAteVencer(c.vencimento);
      return d !== null && d <= DIAS_VENCENDO;
    })
    .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
}

export function resumoOrcamentos(todosOrcamentos, situacaoValida){
  const hoje = new Date();
  const mes = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}`;
  const ano = String(hoje.getFullYear());
  const doMes = todosOrcamentos.filter(e => String(e.orcData || '').startsWith(mes));
  const doAno = todosOrcamentos.filter(e => String(e.orcData || '').startsWith(ano));
  const comSituacao = (l, s) => l.filter(e => situacaoValida(e.situacao) === s);
  const grupo = l => ({qtd: l.length, valor: somaValores(l)});
  return {
    mes: grupo(doMes),
    aprovadosMes: grupo(comSituacao(doMes, 'aprovado')),
    /* aguardando não é do mês: um orçamento de abril ainda espera resposta */
    aguardando: grupo(comSituacao(todosOrcamentos, 'enviado')),
    ano: grupo(doAno),
    aprovadosAno: grupo(comSituacao(doAno, 'aprovado')),
  };
}

/* O total orçado em cada um dos últimos N meses (o atual por último). */
export function totaisUltimosMeses(todosOrcamentos, n){
  const hoje = new Date();
  const meses = [];
  for(let i = n - 1; i >= 0; i--){
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`;
    meses.push({mes: iso,
      total: somaValores(todosOrcamentos.filter(e => String(e.orcData || '').startsWith(iso)))});
  }
  return meses;
}
