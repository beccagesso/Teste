/* Os três pequenos ajudantes de DOM que toda tela usa — sem framework,
   é o que sobra para não repetir `document.getElementById` e o
   escape de HTML em cada arquivo novo. */

export function el(id){ return document.getElementById(id); }

export function escapeAttr(str){
  return String(str)
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
