/* A busca de cliente usada no formulário de orçamento: digita, aparece
   quem já existe (nome + telefone), escolhe um — ou cria um novo sem
   sair do orçamento. É o único componente desta etapa que se repete em
   mais de uma tela (a busca em si só aparece no orçamento, mas tanto
   ela quanto a tela de Clientes usam a mesma `domain/clientes.js`). */
import * as clientesDom from '../domain/clientes.js';
import { el, escapeHtml, escapeAttr } from './dom.js';

const estado = {
  clienteId: null,
  nomeSelecionado: '',
  aoSelecionar: () => {},
  aoPedirNovoCliente: () => {},
};

export function clienteSelecionadoId(){
  return estado.clienteId;
}

export function limparSelecaoCliente(){
  estado.clienteId = null;
  estado.nomeSelecionado = '';
}

/* Chamado ao carregar um orçamento já salvo, para a busca "lembrar"
   qual cliente está vinculado a ele. */
export function carregarSelecaoCliente(clienteId){
  limparSelecaoCliente();
  if(!clienteId) return;
  const c = clientesDom.buscarPorId(clienteId);
  if(c){ estado.clienteId = c.id; estado.nomeSelecionado = c.nome; }
}

function fecharLista(){
  const alvo = el('cliBuscaResultados');
  alvo.hidden = true;
  alvo.innerHTML = '';
}

function mostrarResultados(termo){
  const alvo = el('cliBuscaResultados');
  const encontrados = clientesDom.buscar(termo).slice(0, 8);
  const linhas = encontrados.map(c => `
    <button type="button" class="cli-busca-item" data-id="${escapeAttr(c.id)}">
      <span>${escapeHtml(c.nome)}</span>
      <span class="cli-busca-tel">${escapeHtml(c.telefone || '')}</span>
    </button>`).join('');
  const digitado = termo.trim();
  const novo = digitado
    ? `<button type="button" class="cli-busca-item cli-busca-novo" id="cliBuscaNovo">
         + Novo cliente${digitado ? ' "' + escapeHtml(digitado) + '"' : ''}
       </button>`
    : '';

  alvo.innerHTML = linhas + novo;
  alvo.hidden = !(linhas || novo);

  alvo.querySelectorAll('.cli-busca-item[data-id]').forEach(b =>
    b.addEventListener('mousedown', ev => {
      ev.preventDefault(); /* não deixa o campo perder o foco antes do clique valer */
      const c = clientesDom.buscarPorId(b.dataset.id);
      if(c) selecionarCliente(c);
    }));
  const btnNovo = el('cliBuscaNovo');
  if(btnNovo) btnNovo.addEventListener('mousedown', ev => {
    ev.preventDefault();
    fecharLista();
    estado.aoPedirNovoCliente(digitado);
  });
}

export function selecionarCliente(cliente){
  estado.clienteId = cliente.id;
  estado.nomeSelecionado = cliente.nome;
  el('cliNome').value = cliente.nome;
  fecharLista();
  estado.aoSelecionar(cliente);
}

/* Liga a busca ao campo `cliNome`, que passa a servir tanto para
   digitar um nome livre (como antes) quanto para escolher um cliente
   já cadastrado. `aoSelecionar(cliente)` é chamado depois de escolher
   um resultado; `aoPedirNovoCliente(nomeDigitado)` quando a pessoa
   escolhe "+ Novo cliente". */
export function montarBuscaCliente({aoSelecionar, aoPedirNovoCliente} = {}){
  estado.aoSelecionar = aoSelecionar || (() => {});
  estado.aoPedirNovoCliente = aoPedirNovoCliente || (() => {});

  const campo = el('cliNome');
  campo.addEventListener('input', () => {
    const valor = campo.value;
    if(estado.clienteId && valor.trim() !== estado.nomeSelecionado.trim()){
      limparSelecaoCliente();
    }
    if(valor.trim()) mostrarResultados(valor);
    else fecharLista();
  });
  campo.addEventListener('focus', () => {
    if(campo.value.trim()) mostrarResultados(campo.value);
  });
  campo.addEventListener('blur', fecharLista);
}
