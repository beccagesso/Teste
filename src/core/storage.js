/* A única porta de entrada para o localStorage.

   Duas coisas resolvidas aqui, para não repetir em cada tela:
   1. o armazenamento pode falhar (modo privado do Safari, cota cheia) —
      toda leitura e escrita já vem protegida, e o app segue funcionando
      mesmo sem conseguir guardar nada;
   2. cada entidade (clientes, orçamentos, contas...) guarda sua lista
      inteira sob uma chave, como já era feito — `listaEmChave` só
      nomeia esse padrão para não reescrevê-lo em cada módulo novo. */

export function lerJson(chave, padrao){
  try{
    const v = JSON.parse(localStorage.getItem(chave) || 'null');
    return (v === null || v === undefined) ? padrao : v;
  }catch(e){ return padrao; }
}

export function gravarJson(chave, valor){
  try{ localStorage.setItem(chave, JSON.stringify(valor)); }
  catch(e){ /* modo privado ou cota cheia: o app segue funcionando */ }
}

/* Fábrica de `ler`/`gravar` para uma lista guardada inteira sob uma
   chave — o mesmo formato usado por clientes, fornecedores, categorias,
   contas e (antes desta etapa) já era repetido à mão para cada uma. */
export function listaEmChave(chave){
  return {
    ler(){
      const lista = lerJson(chave, []);
      return Array.isArray(lista) ? lista : [];
    },
    gravar(lista){
      gravarJson(chave, lista);
    },
  };
}
