/* Tela do módulo Comercial (Etapa 3.2): lista de oportunidades, criação
   mínima e o detalhe (cabeçalho, funil, timeline, orçamentos
   vinculados). Camada de apresentação só — toda regra (status válido,
   motivo obrigatório em "perdida", o evento de cada mudança) mora em
   `domain/oportunidades.js` e `domain/atividadesComerciais.js`. Esta
   tela nunca decide nada sozinha: chama o domínio e mostra o que ele
   devolveu.

   Edição de campos (título, valor, origem, responsável...) depois de
   criada não entra nesta etapa — só o que a Etapa 3.2 pediu: visualizar,
   criar, abrir, mudar status, timeline, orçamento vinculado. */
import * as dom from '../domain/index.js';
import { fmtDataBR, fmtDataHoraRelativa } from '../core/dates.js';
import { formatar as fmtMoeda, paraNumero } from '../core/money.js';
import { escapeHtml, escapeAttr, el } from './dom.js';

let idAberto = null;          /* oportunidade mostrada no painel de detalhe */
let pedindoMotivoPerda = false;

function rotuloStatus(chave){
  const s = dom.oportunidades.STATUS_OPORTUNIDADE.find(x => x.chave === chave);
  return s ? s.rotulo : chave;
}

function rotuloSituacaoOrc(chave){
  const s = dom.orcamentos.SITUACOES.find(x => x.chave === chave);
  return s ? s.rotulo : 'Rascunho';
}

function nomeCliente(clienteId){
  const c = dom.clientes.buscarPorId(clienteId);
  return c ? c.nome : '(cliente removido)';
}

/* ---------- lista ---------- */

export function renderOportunidades(){
  const lista = dom.oportunidades.listar()
    .sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0));

  const alvo = el('comercialLista');
  if(!lista.length){
    alvo.innerHTML = '<div class="contas-vazio">Nenhuma oportunidade ainda.<br>' +
      'Use o botão acima para criar a primeira.</div>';
    return;
  }

  alvo.innerHTML = lista.map(o => {
    const eventos = dom.atividadesComerciais.listarPorOportunidade(o.id);
    const ultima = eventos[0];
    const proximo = o.proximoContatoEm ? `Próximo contato: ${fmtDataBR(o.proximoContatoEm)}` : '';
    return `
      <div class="oportunidade-item">
        <div class="conta-topo">
          <span class="conta-desc">${escapeHtml(o.titulo)}</span>
          <span class="opo-status opo-status-${escapeAttr(o.status)}">${escapeHtml(rotuloStatus(o.status))}</span>
        </div>
        <div class="conta-linha2">
          ${escapeHtml(nomeCliente(o.clienteId))}
          ${o.responsavel ? ' · ' + escapeHtml(o.responsavel) : ''}
          ${o.valorEstimado ? ' · Estimativa: ' + escapeHtml(fmtMoeda(o.valorEstimado)) : ''}
        </div>
        <div class="conta-linha2">
          ${proximo}${proximo && ultima ? ' · ' : ''}${ultima ? 'Última atividade: ' + escapeHtml(ultima.texto) : ''}
        </div>
        <div class="conta-acoes">
          <button type="button" class="opo-abrir" data-id="${escapeAttr(o.id)}">Abrir</button>
        </div>
      </div>`;
  }).join('');

  alvo.querySelectorAll('.opo-abrir').forEach(b =>
    b.addEventListener('click', ev => abrirOportunidade(ev.currentTarget.dataset.id)));
}

/* ---------- criação ---------- */

function preencherSelectClientes(){
  const sel = el('opoFormCliente');
  const clientes = dom.clientes.listarAtivos().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  sel.innerHTML = '<option value="">Selecione o cliente…</option>' +
    clientes.map(c => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.nome)}</option>`).join('');
}

function preencherSelectOrigens(){
  const sel = el('opoFormOrigem');
  const origens = dom.origens.listarAtivas();
  sel.innerHTML = '<option value="">Sem origem definida</option>' +
    origens.map(o => `<option value="${escapeAttr(o.id)}">${escapeHtml(o.nome)}</option>`).join('');
}

export function abrirNovaOportunidade(){
  el('opoFormTitulo').value = '';
  el('opoFormResponsavel').value = '';
  el('opoFormValor').value = '';
  el('opoFormProximoContato').value = '';
  el('opoAviso').hidden = true;
  preencherSelectClientes();
  preencherSelectOrigens();
  el('opoFormCliente').value = '';
  el('opoFormOrigem').value = '';
  el('painelOportunidade').hidden = false;
  el('opoFormCliente').focus();
}

export function fecharPainelOportunidade(){
  el('painelOportunidade').hidden = true;
}

/* Cria a oportunidade a partir do formulário. Devolve a oportunidade
   criada, ou `null` se o domínio recusou (cliente ou título ausente) —
   o mesmo `null` que `oportunidades.criar()` já devolve; esta função
   não reproduz a validação, só reage a ela. */
export function salvarFormOportunidade(){
  const dados = {
    clienteId: el('opoFormCliente').value,
    titulo: el('opoFormTitulo').value.trim(),
    origemId: el('opoFormOrigem').value || null,
    valorEstimado: paraNumero(el('opoFormValor').value),
    responsavel: el('opoFormResponsavel').value.trim(),
    proximoContatoEm: el('opoFormProximoContato').value || null,
  };
  const criada = dom.oportunidades.criar(dados);
  if(!criada){
    el('opoAviso').hidden = false;
    el('opoAviso').textContent = !dados.clienteId
      ? 'Escolha um cliente.'
      : 'Escreva um título para a oportunidade.';
    return null;
  }
  el('opoAviso').hidden = true;
  fecharPainelOportunidade();
  renderOportunidades();
  return criada;
}

/* ---------- detalhe ---------- */

function renderFunil(oportunidade){
  const FUNIL = ['novo', 'contato', 'visita', 'orcamento', 'negociacao', 'aprovada'];
  const posAtual = FUNIL.indexOf(oportunidade.status);

  if(oportunidade.status === 'perdida'){
    const motivo = dom.motivosPerda.buscarPorId(oportunidade.motivoPerdaId);
    return `<div class="opo-perdida">
      Oportunidade perdida${motivo ? ' — motivo: ' + escapeHtml(motivo.nome) : ''}
      ${oportunidade.motivoPerdaDetalhe ? '<br>' + escapeHtml(oportunidade.motivoPerdaDetalhe) : ''}
    </div>`;
  }

  const passos = FUNIL.map((chave, i) => {
    const classe = i < posAtual ? 'feito' : (i === posAtual ? 'atual' : '');
    return `<div class="opo-funil-passo ${classe}">${escapeHtml(rotuloStatus(chave))}</div>`;
  }).join('<div class="opo-funil-seta">→</div>');

  return `<div class="opo-funil">${passos}</div>`;
}

function renderControleStatus(oportunidade){
  if(oportunidade.status === 'aprovada' || oportunidade.status === 'perdida') return '';

  const NAO_TERMINAIS = ['novo', 'contato', 'visita', 'orcamento', 'negociacao', 'aprovada'];
  const opcoes = NAO_TERMINAIS.map(chave => `
    <option value="${chave}"${chave === oportunidade.status ? ' selected' : ''}>
      ${escapeHtml(rotuloStatus(chave))}
    </option>`).join('');

  return `
    <div class="opo-controle-status">
      <label for="opoStatusSelect">Status</label>
      <select id="opoStatusSelect">${opcoes}</select>
      <button type="button" class="btn-secondary" id="opoMarcarPerdida">Oportunidade perdida</button>
    </div>
    <div class="opo-motivo-perda" id="opoMotivoPerda" hidden>
      <label for="opoMotivoSelect">Motivo da perda</label>
      <select id="opoMotivoSelect"></select>
      <label for="opoMotivoDetalhe">Detalhe <span style="text-transform:none;font-weight:400;">— opcional</span></label>
      <input type="text" id="opoMotivoDetalhe">
      <div class="painel-rodape">
        <button type="button" class="btn-secondary" id="opoMotivoCancelar">Cancelar</button>
        <button type="button" class="btn-primary" id="opoMotivoConfirmar">Confirmar perda</button>
      </div>
    </div>`;
}

function renderVinculo(oportunidade){
  const vinculados = dom.orcamentosDaOportunidade(oportunidade.id);
  if(!vinculados.length) return '<div class="msg-ajuda pequena">Nenhum orçamento vinculado.</div>';
  return vinculados.map(e => `
    <div class="cliente-ficha-orc">
      <span>${escapeHtml(e.orcNumero)}</span>
      <span>${escapeHtml(fmtMoeda(e.total || 0))}</span>
      <span class="conta-marca">${escapeHtml(rotuloSituacaoOrc(e.situacao))}</span>
    </div>`).join('');
}

function renderTimeline(oportunidade){
  const eventos = dom.atividadesComerciais.listarPorOportunidade(oportunidade.id);
  if(!eventos.length) return '<div class="msg-ajuda pequena">Nenhuma atividade ainda.</div>';
  return eventos.map(a => {
    const dados = (a.tipo === 'mudanca_status' && a.dados)
      ? `<div class="opo-timeline-dados">${escapeHtml(rotuloStatus(a.dados.de))} → ${escapeHtml(rotuloStatus(a.dados.para))}</div>`
      : '';
    return `
      <div class="opo-timeline-item">
        <div class="opo-timeline-quando">${escapeHtml(fmtDataHoraRelativa(a.criadoEm))}</div>
        <div class="opo-timeline-texto">${escapeHtml(a.texto)}</div>
        ${dados}
      </div>`;
  }).join('');
}

function renderDetalhe(){
  const o = dom.oportunidades.buscarPorId(idAberto);
  if(!o) return;

  el('opoDetTitulo').textContent = o.titulo;
  el('opoDetCabecalho').innerHTML = `
    <div class="opo-det-linha"><b>${escapeHtml(nomeCliente(o.clienteId))}</b></div>
    <div class="opo-det-linha">
      ${o.responsavel ? escapeHtml(o.responsavel) : 'Sem responsável definido'}
      ${o.valorEstimado ? ' · Estimativa: ' + escapeHtml(fmtMoeda(o.valorEstimado)) : ''}
    </div>`;

  el('opoDetFunil').innerHTML = renderFunil(o);
  el('opoDetControle').innerHTML = renderControleStatus(o);
  el('opoDetVinculo').innerHTML = renderVinculo(o);
  el('opoDetTimeline').innerHTML = renderTimeline(o);

  const selectStatus = el('opoStatusSelect');
  if(selectStatus) selectStatus.addEventListener('change', ev => {
    dom.oportunidades.alterarStatus(o.id, ev.currentTarget.value);
    renderDetalhe();
    renderOportunidades();
  });

  const btnPerdida = el('opoMarcarPerdida');
  if(btnPerdida) btnPerdida.addEventListener('click', () => {
    pedindoMotivoPerda = true;
    const selMotivo = el('opoMotivoSelect');
    selMotivo.innerHTML = dom.motivosPerda.listarAtivos()
      .map(m => `<option value="${escapeAttr(m.id)}">${escapeHtml(m.nome)}</option>`).join('');
    el('opoMotivoDetalhe').value = '';
    el('opoMotivoPerda').hidden = false;
  });

  const btnCancelarMotivo = el('opoMotivoCancelar');
  if(btnCancelarMotivo) btnCancelarMotivo.addEventListener('click', () => {
    pedindoMotivoPerda = false;
    el('opoMotivoPerda').hidden = true;
  });

  const btnConfirmarMotivo = el('opoMotivoConfirmar');
  if(btnConfirmarMotivo) btnConfirmarMotivo.addEventListener('click', () => {
    const motivoPerdaId = el('opoMotivoSelect').value;
    const motivoPerdaDetalhe = el('opoMotivoDetalhe').value.trim();
    const resultado = dom.oportunidades.alterarStatus(o.id, 'perdida', {motivoPerdaId, motivoPerdaDetalhe});
    if(!resultado) return; /* sem motivo válido: o domínio recusou, fica como está */
    pedindoMotivoPerda = false;
    el('opoMotivoPerda').hidden = true;
    renderDetalhe();
    renderOportunidades();
  });
}

export function abrirOportunidade(id){
  const o = dom.oportunidades.buscarPorId(id);
  if(!o) return;
  idAberto = id;
  pedindoMotivoPerda = false;
  renderDetalhe();
  el('painelOportunidadeDetalhe').hidden = false;
}

export function fecharDetalheOportunidade(){
  el('painelOportunidadeDetalhe').hidden = true;
  idAberto = null;
}
