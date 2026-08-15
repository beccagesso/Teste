/* Fonte única de verdade para o cálculo de um orçamento.

   Antes desta etapa, quatro lugares recalculavam subtotal/desconto/total
   cada um do seu jeito (`totalDe`, `totalComDesconto`, o preview na tela
   e o PDF) — o risco real não era o valor estar errado hoje, mas um dos
   quatro divergir no dia em que alguém mexesse só num deles. Agora só
   este módulo soma; quem precisa do total (tela, histórico, PDF) chama
   `calcularOrcamento` e lê o resultado. */
import { paraNumero, somar, abater } from '../core/money.js';

/* `servicos`: lista de {desc, qtd, valor, unidade}.
   `condicoes`: {parcelas, descontoPct, abatimento}. */
export function calcularOrcamento(servicos, condicoes){
  const itens = (servicos || []).map(s => {
    const qtd = paraNumero(s.qtd);
    const valor = paraNumero(s.valor);
    return { desc: s.desc || '', qtd, valor, unidade: s.unidade, sub: qtd * valor };
  });
  const itensPreenchidos = itens.filter(s => s.desc.trim() || s.valor > 0);

  const subtotal = somar(itens.map(s => s.sub));
  const c = condicoes || {};
  const { abatimento, total } = abater(subtotal, c.abatimento || 0);
  const parcelas = c.parcelas || 1;
  const descontoPct = c.descontoPct || 0;

  return {
    itens,
    itensPreenchidos,
    subtotal,
    abatimento,
    total,
    parcelas,
    parcela: total / parcelas,
    descontoPct,
    avista: total * (1 - descontoPct / 100),
  };
}

/* Atalho para quando só o total (já com desconto) importa — é o caso do
   histórico e dos resumos do início. */
export function totalComDesconto(entradaHistorico){
  return calcularOrcamento(entradaHistorico.servicos, entradaHistorico.condicoes).total;
}
