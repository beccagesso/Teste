/* Único lugar que sabe formatar e comparar datas no app.

   Duas representações convivem de propósito:
   - "AAAA-MM-DD" (ISO): o que os campos <input type="date"> guardam e o
     que fica salvo — ordena certo como texto e não depende de fuso.
   - "DD/MM/AAAA": o que a pessoa vê no documento e nas listas. */

export const DIA_EM_MS = 24 * 60 * 60 * 1000;

export function hojeISO(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function mesISO(){
  return hojeISO().slice(0, 7);
}

export function fmtDataBR(dateStr){
  if(!dateStr) return '—';
  const [y,m,d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export function fmtDate(dt){
  if(!dt) return '—';
  const d = String(dt.getDate()).padStart(2,'0');
  const m = String(dt.getMonth()+1).padStart(2,'0');
  return `${d}/${m}/${dt.getFullYear()}`;
}

export function addDias(dateStr, dias){
  if(!dateStr) return null;
  const dt = new Date(dateStr + 'T00:00:00');
  if(isNaN(dt)) return null;
  dt.setDate(dt.getDate() + dias);
  return dt;
}

/* Diferença em dias corridos, ignorando a hora — um vencimento hoje não
   pode contar como atrasado às 14h. */
export function diasAteVencer(vencimento){
  if(!vencimento) return null;
  const alvo = new Date(vencimento + 'T00:00:00');
  if(isNaN(alvo)) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo - hoje) / DIA_EM_MS);
}

export function diasDesde(quandoMs){
  if(!quandoMs) return null;
  return Math.floor((Date.now() - quandoMs) / DIA_EM_MS);
}

/* "Sexta-feira, 14 de agosto" — sem o ano, que já não cabe no cartão e
   não ajuda quem está olhando o celular no dia em que abriu o app */
export function dataLongaBR(){
  const texto = new Date().toLocaleDateString('pt-BR',
    {weekday:'long', day:'numeric', month:'long'});
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function nomeDoMesCurto(){
  return new Date().toLocaleDateString('pt-BR', {month:'long'});
}

/* o mesmo nome, mas de um mês qualquer (usado na tendência: "que julho") */
export function nomeDoMesDe(iso){
  const [ano, mes] = iso.split('-').map(Number);
  return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', {month:'long'});
}
