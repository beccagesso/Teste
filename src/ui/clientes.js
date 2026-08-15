/* Tela de Clientes: listar, buscar, criar, editar. Abrir um cliente já
   mostra os dados e o histórico de orçamentos dele no mesmo painel — não
   existe uma "visualização" separada da edição, porque para este
   tamanho de cadastro seria uma tela a mais sem ganho nenhum; ver os
   campos preenchidos já é ver o cadastro. */
import * as dom from '../domain/index.js';
import { fmtDataBR } from '../core/dates.js';
import { formatar as fmtMoeda } from '../core/money.js';
import { escapeHtml, escapeAttr, el } from './dom.js';

let idEditando = null;

function rotuloSituacao(chave){
  const s = dom.orcamentos.SITUACOES.find(x => x.chave === chave);
  return s ? s.rotulo : 'Rascunho';
}

export function renderClientes(){
  const busca = el('cliBusca').value.trim();
  const lista = dom.clientes.buscar(busca)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const alvo = el('clientesLista');
  if(!lista.length){
    alvo.innerHTML = busca
      ? '<div class="contas-vazio">Nenhum cliente encontrado.</div>'
      : '<div class="contas-vazio">Nenhum cliente cadastrado ainda.<br>' +
        'Use o botão acima para cadastrar o primeiro.</div>';
    return;
  }

  alvo.innerHTML = lista.map(c => {
    const est = dom.estatisticasCliente(c.id);
    const detalhes = [c.telefone, c.cidade].filter(Boolean).join(' · ');
    const ultimo = est.ultimo
      ? `Último orçamento: ${fmtDataBR(est.ultimo.orcData)}`
      : 'Nenhum orçamento ainda';
    return `
      <div class="cliente-item">
        <div class="conta-topo">
          <span class="conta-desc">${escapeHtml(c.nome)}</span>
          <span class="cliente-qtd">${est.quantidade} ${est.quantidade === 1 ? 'orçamento' : 'orçamentos'}</span>
        </div>
        <div class="conta-linha2">${escapeHtml(detalhes || 'Sem telefone/cidade')}<br>${escapeHtml(ultimo)}</div>
        <div class="conta-acoes">
          <button type="button" class="cli-abrir" data-id="${escapeAttr(c.id)}">Abrir</button>
        </div>
      </div>`;
  }).join('');

  alvo.querySelectorAll('.cli-abrir').forEach(b =>
    b.addEventListener('click', ev => abrirCliente(ev.currentTarget.dataset.id)));
}

function limparFormCliente(){
  idEditando = null;
  el('cliFormTitulo').textContent = 'Novo cliente';
  el('cliSalvar').textContent = 'Cadastrar cliente';
  el('cliFicha').hidden = true;
  el('cliDesativar').hidden = true;
  for(const campo of ['cliFormNome','cliFormTelefone','cliFormEmail','cliFormDocumento',
                       'cliFormEndereco','cliFormCidade','cliFormBairro','cliFormObs']){
    el(campo).value = '';
  }
}

function preencherFormCliente(c){
  el('cliFormNome').value = c.nome || '';
  el('cliFormTelefone').value = c.telefone || '';
  el('cliFormEmail').value = c.email || '';
  el('cliFormDocumento').value = c.documento || '';
  el('cliFormEndereco').value = c.endereco || '';
  el('cliFormCidade').value = c.cidade || '';
  el('cliFormBairro').value = c.bairro || '';
  el('cliFormObs').value = c.observacoes || '';
}

function renderFichaCliente(cliente){
  const est = dom.estatisticasCliente(cliente.id);
  const linhas = est.orcamentos.slice(0, 8).map(e => `
    <div class="cliente-ficha-orc">
      <span>${escapeHtml(e.orcNumero)} · ${fmtDataBR(e.orcData)}</span>
      <span>${fmtMoeda(e.total || 0)}</span>
      <span class="conta-marca">${escapeHtml(rotuloSituacao(e.situacao))}</span>
    </div>`).join('') || '<div class="msg-ajuda pequena">Nenhum orçamento ainda.</div>';

  el('cliFicha').hidden = false;
  el('cliFicha').innerHTML = `
    <div class="msg-ajuda pequena">${est.quantidade} ${est.quantidade === 1 ? 'orçamento' : 'orçamentos'} no histórico</div>
    ${linhas}`;
}

export function abrirCliente(id){
  const c = dom.clientes.buscarPorId(id);
  if(!c) return;
  idEditando = id;
  el('cliFormTitulo').textContent = c.nome;
  el('cliSalvar').textContent = 'Salvar alterações';
  el('cliDesativar').hidden = false;
  preencherFormCliente(c);
  renderFichaCliente(c);
  abrirPainelCliente();
}

export function abrirNovoCliente(nomeInicial){
  limparFormCliente();
  if(nomeInicial) el('cliFormNome').value = nomeInicial;
  abrirPainelCliente();
}

function abrirPainelCliente(){
  el('painelCliente').hidden = false;
  el('cliFormNome').focus();
}

export function fecharPainelCliente(){
  el('painelCliente').hidden = true;
}

function dadosDoForm(){
  return {
    nome: el('cliFormNome').value.trim(),
    telefone: el('cliFormTelefone').value.trim(),
    email: el('cliFormEmail').value.trim(),
    documento: el('cliFormDocumento').value.trim(),
    endereco: el('cliFormEndereco').value.trim(),
    cidade: el('cliFormCidade').value.trim(),
    bairro: el('cliFormBairro').value.trim(),
    observacoes: el('cliFormObs').value.trim(),
  };
}

/* Salva o formulário aberto no painel. Devolve o cliente salvo, ou
   `null` se o nome (único campo obrigatório) estiver vazio. */
export function salvarFormCliente(){
  const dados = dadosDoForm();
  if(!dados.nome){
    el('cliAviso').hidden = false;
    el('cliAviso').textContent = 'Escreva o nome do cliente.';
    return null;
  }
  el('cliAviso').hidden = true;
  const cliente = idEditando
    ? dom.clientes.atualizar(idEditando, dados)
    : dom.clientes.criar(dados);
  fecharPainelCliente();
  renderClientes();
  return cliente;
}

export function desativarClienteAberto(){
  if(!idEditando) return;
  dom.clientes.desativar(idEditando);
  fecharPainelCliente();
  renderClientes();
}
