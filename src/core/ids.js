/* Identidade técnica das entidades: um id interno, estável, que nunca
   muda — diferente do número que a pessoa vê (ex.: "0001/2026"), que é
   só um rótulo. Isso prepara o app para múltiplos aparelhos e
   sincronização: o vínculo entre um orçamento e o cliente dele, por
   exemplo, aponta para este id, não para o nome digitado.

   O formato (prefixo + hora + acaso) é o mesmo que as contas a pagar já
   usavam antes desta etapa — só ficou centralizado aqui. */
export function gerarId(prefixo){
  return `${prefixo}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
