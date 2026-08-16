/* Tela do módulo Comercial (Etapa 3.2): lista de oportunidades, criação
   mínima e o detalhe (cabeçalho, funil, timeline, orçamentos
   vinculados). Camada de apresentação só — toda regra (status válido,
   motivo obrigatório em "perdida", o evento de cada mudança) mora em
   `domain/oportunidades.js` e `domain/atividadesComerciais.js`. Esta
   tela nunca decide nada sozinha: chama o domínio e mostra o que ele
   devolveu.

   Edição de dados cadastrais (título, cliente, origem, valor,
   responsável, datas, motivo de perda) entrou na Etapa 3.2.1, como um
   modo dentro do mesmo painel de detalhe — nunca muda `status`: editar
   dados nunca é uma forma disfarçada de mudar o funil, nem quando a
   oportunidade já está aprovada ou perdida. */
import * as dom from '../domain/index.js';
import { fmtDataBR, fmtDataHoraRelativa } from '../core/dates.js';
import { formatar as fmtMoeda, formatarEditavel as fmtValorEditavel, paraNumero } from '../core/money.js';
import { escapeHtml, escapeAttr, el } from './dom.js';

let idAberto = null;          /* oportunidade mostrada no painel de detalhe */
let pedindoMotivoPerda = false;
let modoEdicao = false;

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

/* `selecionadoId`: omitido no formulário de criação (mostra o
   placeholder "Selecione..."); passado no de edição, para o cliente
   atual já vir marcado. Usada nos dois formulários — não duplica a
   consulta a `clientes.listarAtivos()` em cada um. */
function preencherSelectClientes(idDoSelect, selecionadoId){
  const sel = el(idDoSelect);
  const clientes = dom.clientes.listarAtivos().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const placeholder = selecionadoId === undefined ? '<option value="">Selecione o cliente…</option>' : '';
  sel.innerHTML = placeholder + clientes.map(c =>
    `<option value="${escapeAttr(c.id)}"${c.id === selecionadoId ? ' selected' : ''}>${escapeHtml(c.nome)}</option>`).join('');
}

function preencherSelectOrigens(idDoSelect, selecionadoId){
  const sel = el(idDoSelect);
  const origens = dom.origens.listarAtivas();
  sel.innerHTML = '<option value="">Sem origem definida</option>' +
    origens.map(o => `<option value="${escapeAttr(o.id)}"${o.id === selecionadoId ? ' selected' : ''}>${escapeHtml(o.nome)}</option>`).join('');
}

export function abrirNovaOportunidade(){
  el('opoFormTitulo').value = '';
  el('opoFormResponsavel').value = '';
  el('opoFormValor').value = '';
  el('opoFormProximoContato').value = '';
  el('opoAviso').hidden = true;
  preencherSelectClientes('opoFormCliente');
  preencherSelectOrigens('opoFormOrigem');
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

/* ---------- cabeçalho: leitura e edição ---------- */

function renderCabecalhoLeitura(o){
  const origem = o.origemId ? dom.origens.buscarPorId(o.origemId) : null;
  const linhaOrigem = origem
    ? 'Origem: ' + escapeHtml(origem.nome) + (o.origemDetalhe ? ' — ' + escapeHtml(o.origemDetalhe) : '')
    : '';
  const datas = [
    o.visitaAgendadaEm ? 'Visita agendada: ' + fmtDataBR(o.visitaAgendadaEm) : '',
    o.visitaRealizadaEm ? 'Visita realizada: ' + fmtDataBR(o.visitaRealizadaEm) : '',
    o.proximoContatoEm ? 'Próximo contato: ' + fmtDataBR(o.proximoContatoEm) : '',
  ].filter(Boolean).map(escapeHtml).join(' · ');

  return `
    <div class="opo-det-linha"><b>${escapeHtml(nomeCliente(o.clienteId))}</b></div>
    <div class="opo-det-linha">
      ${o.responsavel ? escapeHtml(o.responsavel) : 'Sem responsável definido'}
      ${o.valorEstimado ? ' · Estimativa: ' + escapeHtml(fmtMoeda(o.valorEstimado)) : ''}
    </div>
    ${linhaOrigem ? `<div class="opo-det-linha msg-ajuda pequena">${linhaOrigem}</div>` : ''}
    ${datas ? `<div class="opo-det-linha msg-ajuda pequena">${datas}</div>` : ''}
    <button type="button" class="btn-secondary" id="opoEditarBtn" style="margin-top:8px;">Editar</button>`;
}

/* Só os 11 campos cadastrais que já existem no domínio (Etapa 3.2.1) —
   `status` nunca aparece aqui, é o `<select>` do funil que muda status.
   `motivoPerdaId`/`motivoPerdaDetalhe` só aparecem quando a oportunidade
   já está perdida — editar um motivo de perda antes de existir uma
   perda não faz sentido operacional, mesmo que o domínio aceitasse. */
function renderCabecalhoEdicao(o){
  const mostrarMotivo = o.status === 'perdida';
  return `
    <div class="field-group">
      <label for="opoEditTitulo">Título</label>
      <input type="text" id="opoEditTitulo" value="${escapeAttr(o.titulo)}">
      <label for="opoEditCliente">Cliente</label>
      <select id="opoEditCliente"></select>
      <label for="opoEditOrigem">Origem <span style="text-transform:none;font-weight:400;">— opcional</span></label>
      <select id="opoEditOrigem"></select>
      <label for="opoEditOrigemDetalhe">Detalhe da origem <span style="text-transform:none;font-weight:400;">— opcional</span></label>
      <input type="text" id="opoEditOrigemDetalhe" value="${escapeAttr(o.origemDetalhe || '')}">
      <div class="row2">
        <div>
          <label for="opoEditValor">Valor estimado</label>
          <input type="text" id="opoEditValor" inputmode="decimal" value="${escapeAttr(fmtValorEditavel(o.valorEstimado || 0))}">
        </div>
        <div>
          <label for="opoEditResponsavel">Responsável</label>
          <input type="text" id="opoEditResponsavel" value="${escapeAttr(o.responsavel || '')}">
        </div>
      </div>
      <div class="row2">
        <div>
          <label for="opoEditVisitaAgendada">Visita agendada</label>
          <input type="date" id="opoEditVisitaAgendada" value="${escapeAttr(o.visitaAgendadaEm || '')}">
        </div>
        <div>
          <label for="opoEditVisitaRealizada">Visita realizada</label>
          <input type="date" id="opoEditVisitaRealizada" value="${escapeAttr(o.visitaRealizadaEm || '')}">
        </div>
      </div>
      <label for="opoEditProximoContato">Próximo contato</label>
      <input type="date" id="opoEditProximoContato" value="${escapeAttr(o.proximoContatoEm || '')}">
      ${mostrarMotivo ? `
      <label for="opoEditMotivo">Motivo da perda</label>
      <select id="opoEditMotivo"></select>
      <label for="opoEditMotivoDetalhe">Detalhe do motivo <span style="text-transform:none;font-weight:400;">— opcional</span></label>
      <input type="text" id="opoEditMotivoDetalhe" value="${escapeAttr(o.motivoPerdaDetalhe || '')}">` : ''}
      <div class="tranca-erro" id="opoEditAviso" hidden></div>
    </div>
    <div class="painel-rodape">
      <button type="button" class="btn-secondary" id="opoEditCancelar">Cancelar</button>
      <button type="button" class="btn-primary" id="opoEditSalvar">Salvar alterações</button>
    </div>`;
}

function salvarEdicaoOportunidade(o){
  const dados = {
    titulo: el('opoEditTitulo').value.trim(),
    clienteId: el('opoEditCliente').value,
    origemId: el('opoEditOrigem').value || null,
    origemDetalhe: el('opoEditOrigemDetalhe').value.trim(),
    valorEstimado: paraNumero(el('opoEditValor').value),
    responsavel: el('opoEditResponsavel').value.trim(),
    visitaAgendadaEm: el('opoEditVisitaAgendada').value || null,
    visitaRealizadaEm: el('opoEditVisitaRealizada').value || null,
    proximoContatoEm: el('opoEditProximoContato').value || null,
  };
  if(o.status === 'perdida'){
    dados.motivoPerdaId = el('opoEditMotivo').value;
    dados.motivoPerdaDetalhe = el('opoEditMotivoDetalhe').value.trim();
  }

  const salva = dom.oportunidades.atualizar(o.id, dados);
  if(!salva){
    el('opoEditAviso').hidden = false;
    el('opoEditAviso').textContent = !dados.clienteId
      ? 'Escolha um cliente.'
      : 'Escreva um título para a oportunidade.';
    return;
  }
  modoEdicao = false;
  renderDetalhe();
  renderOportunidades();
}

function renderDetalhe(){
  const o = dom.oportunidades.buscarPorId(idAberto);
  if(!o) return;

  el('opoDetTitulo').textContent = o.titulo;

  if(modoEdicao){
    el('opoDetCabecalho').innerHTML = renderCabecalhoEdicao(o);
    preencherSelectClientes('opoEditCliente', o.clienteId);
    preencherSelectOrigens('opoEditOrigem', o.origemId);
    if(o.status === 'perdida'){
      el('opoEditMotivo').innerHTML = dom.motivosPerda.listarAtivos()
        .map(m => `<option value="${escapeAttr(m.id)}"${m.id === o.motivoPerdaId ? ' selected' : ''}>${escapeHtml(m.nome)}</option>`).join('');
    }
    el('opoEditCancelar').addEventListener('click', () => { modoEdicao = false; renderDetalhe(); });
    el('opoEditSalvar').addEventListener('click', () => salvarEdicaoOportunidade(o));
  }else{
    el('opoDetCabecalho').innerHTML = renderCabecalhoLeitura(o);
    el('opoEditarBtn').addEventListener('click', () => { modoEdicao = true; renderDetalhe(); });
  }

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
  modoEdicao = false;
  renderDetalhe();
  el('painelOportunidadeDetalhe').hidden = false;
}

export function fecharDetalheOportunidade(){
  el('painelOportunidadeDetalhe').hidden = true;
  idAberto = null;
  modoEdicao = false;
}
