/* Formato comum dos erros que atravessam o app.

   O armazenamento local pode falhar (modo privado, cota cheia) e a nuvem
   pode falhar de várias formas (sem internet, sessão vencida, recusada
   pelo servidor). Em vez de cada função inventar seu próprio jeito de
   sinalizar isso, as duas usam as mesmas marcações. */

/* Roda `fn`; se der erro, devolve `padrao` em vez de propagar. É o
   `try{...}catch(e){return padrao}` que se repetia em cada função de
   localStorage — aqui centralizado. */
export function silenciosa(fn, padrao){
  try{ return fn(); }
  catch(e){ return padrao; }
}

/* Erro de rede: o fetch não completou (sem internet, DNS, etc). */
export function erroSemRede(mensagem){
  const erro = new Error(mensagem || 'não consegui falar com a nuvem (sem internet?)');
  erro.semRede = true;
  return erro;
}

/* Sessão vencida ou ausente: quem chamou precisa mandar entrar de novo. */
export function erroPrecisaEntrar(mensagem){
  const erro = new Error(mensagem || 'a sessão venceu; entre de novo');
  erro.precisaEntrar = true;
  return erro;
}

/* Erro devolvido pelo servidor, com o código HTTP junto (para saber,
   por exemplo, quando vale renovar o token e tentar de novo). */
export function erroDoServidor(mensagem, status){
  const erro = new Error(String(mensagem || `erro ${status}`));
  erro.status = status;
  return erro;
}
