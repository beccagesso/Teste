/* Dinheiro, de um jeito só, usado em toda parte do app.

   Por fora, valor monetário continua sendo um número em reais (é o que
   já está salvo em todo orçamento e conta existente, e o que o gerador
   de PDF espera) — trocar isso agora exigiria migrar todo dado já
   guardado sem necessidade real. A mudança fica por dentro: toda soma
   passa primeiro para centavos inteiros, soma como inteiro, e só volta
   para reais no final. Um `reduce` somando várias parcelas em ponto
   flutuante (0.1 + 0.2 = 0.30000000000000004) pode acumular diferença
   de centavo depois de muitas linhas; somando inteiro isso não acontece.

   Esta é também a fonte única de arredondamento e formatação — nenhuma
   tela deve chamar `toLocaleString` por conta própria para mostrar
   dinheiro. */

/* Aceita "1.500,50", "1500,50" e "1500.50" — no iPhone o teclado
   decimal traz vírgula, e input[type=number] descartaria o valor. */
export function paraNumero(v){
  if(typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim();
  if(!s) return 0;
  s = s.replace(/[^\d.,-]/g, '');
  if(s.indexOf(',') !== -1){
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

export function paraCentavos(v){
  return Math.round(paraNumero(v) * 100);
}

export function deCentavos(centavos){
  return (centavos || 0) / 100;
}

/* Soma valores em reais (ou já em centavos, com `{centavos:true}`)
   passando por centavos inteiros, devolvendo reais. */
export function somar(valores, opcoes){
  const emCentavos = (opcoes || {}).centavos;
  const total = (valores || []).reduce(
    (soma, v) => soma + (emCentavos ? Math.round(v || 0) : paraCentavos(v)), 0);
  return deCentavos(total);
}

/* Desconto/abatimento nunca pode deixar o total negativo. */
export function abater(subtotalReais, abatimentoReais){
  const subC = paraCentavos(subtotalReais);
  const abC = Math.min(paraCentavos(abatimentoReais), subC);
  return {abatimento: deCentavos(abC), total: deCentavos(subC - abC)};
}

export function formatar(valorReais){
  return (isFinite(valorReais) ? valorReais : 0)
    .toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
}

/* Dinheiro de volta num campo de digitação: sempre com os centavos, para
   2200 voltar como "2.200,00" e não como "2.200". */
export function formatarEditavel(valorReais){
  return (isFinite(valorReais) ? valorReais : 0).toLocaleString('pt-BR',
    {minimumFractionDigits:2, maximumFractionDigits:2});
}

/* Números que não são dinheiro (percentual, parcelas) mas seguem o
   mesmo padrão de casas decimais pt-BR. */
export function formatarNumero(v){
  return paraNumero(v).toLocaleString('pt-BR', {maximumFractionDigits:2});
}
