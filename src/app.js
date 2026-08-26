/* ==========================================================
   Becca Gesso — gerador de orçamentos / Becca OS
   Ponto de entrada: liga a interface (o que já existia: início,
   orçamentos, contas a pagar, e agora clientes) aos módulos de
   domínio, cálculo e nuvem em src/core, src/domain e src/calculations.

   Esta continua sendo a camada que conhece o DOM — ela lê campos,
   desenha listas, liga botões. Nenhuma conta de dinheiro, nenhuma
   decisão de quem-ganha-na-sincronização e nenhuma regra de cliente
   mora aqui: tudo isso já foi para os módulos que este arquivo importa.
   ========================================================== */
import { el, escapeHtml, escapeAttr } from './ui/dom.js';
import {
  paraNumero as parseNum,
  formatar as fmtMoeda,
  formatarEditavel as fmtValorEditavel,
  formatarNumero as fmtNumeroBR,
} from './core/money.js';
import {
  hojeISO, mesISO, fmtDataBR, fmtDate, addDias, diasAteVencer, diasDesde,
  dataLongaBR, nomeDoMesCurto, nomeDoMesDe,
} from './core/dates.js';
import * as acesso from './core/acesso.js';
import * as cloud from './core/cloud.js';
import * as sync from './core/sync.js';
import { calcularOrcamento } from './calculations/orcamento.js';
import {
  somaValores, resumoContasInicio, contasVencendo, resumoOrcamentos, totaisUltimosMeses,
} from './calculations/financeiro.js';
import * as domain from './domain/index.js';
import * as clientesUi from './ui/clientes.js';
import * as comercialUi from './ui/comercial.js';
import * as componentes from './ui/components.js';

const orc = domain.orcamentos;
const cli = domain.clientes;
const forn = domain.fornecedores;
const cat = domain.categorias;
const cta = domain.contas;
const opo = domain.oportunidades;
const ativ = domain.atividadesComerciais;
const org = domain.origens;
const mot = domain.motivosPerda;

/* ---------- liga as entidades à sincronização ----------
   O motor de sincronização (src/core/sync.js) não conhece nenhuma
   entidade de propósito — é só registrar, aqui, qual tabela da nuvem e
   qual leitura/escrita local correspondem a cada tipo. Antes desta
   etapa só "orcamentos" e "contas" existiam; clientes, fornecedores e
   categorias entram exatamente do mesmo jeito. */
sync.configurarTabelas({
  orcamentos:   {tabela:'orcamentos', coluna:'numero', chaveLocal:'orcNumero',
                 ler: orc.lerHistorico, gravar: orc.gravarHistorico},
  contas:       {tabela:'contas', coluna:'chave', chaveLocal:'id',
                 ler: cta.lerContas, gravar: cta.gravarContas},
  clientes:     {tabela:'clientes', coluna:'chave', chaveLocal:'id',
                 ler: cli.lerClientes, gravar: cli.gravarClientes},
  fornecedores: {tabela:'fornecedores', coluna:'chave', chaveLocal:'id',
                 ler: forn.lerFornecedores, gravar: forn.gravarFornecedores},
  categorias:   {tabela:'categorias_financeiras', coluna:'chave', chaveLocal:'id',
                 ler: cat.lerCategorias, gravar: cat.gravarCategorias},
  oportunidades: {tabela:'oportunidades', coluna:'chave', chaveLocal:'id',
                 ler: opo.lerOportunidades, gravar: opo.gravarOportunidades},
  atividadesComerciais: {tabela:'atividades_comerciais', coluna:'chave', chaveLocal:'id',
                 ler: ativ.lerAtividades, gravar: ativ.gravarAtividades},
  origens:      {tabela:'origens_lead', coluna:'chave', chaveLocal:'id',
                 ler: org.lerOrigens, gravar: org.gravarOrigens},
  motivosPerda: {tabela:'motivos_perda', coluna:'chave', chaveLocal:'id',
                 ler: mot.lerMotivosPerda, gravar: mot.gravarMotivosPerda},
});
sync.aoMudarEstadoNuvem((estado, detalhe) => mostrarEstadoNuvem(estado, detalhe));
sync.aoReceberDados(() => {
  if(!el('painelHist').hidden) renderHistorico();
  if(!el('secaoContas').hidden) renderContas();
  if(!el('secaoClientes').hidden) clientesUi.renderClientes();
  if(!el('secaoComercial').hidden) comercialUi.renderOportunidades();
  if(!el('secaoInicio').hidden) renderInicio();
});

/* ---------- utilidades do editor de serviços ---------- */

const UNIDADES = [
  {valor:'m²',   rotulo:'m²'},
  {valor:'m.l.', rotulo:'m.l.'},
  {valor:'un.',  rotulo:'un.'},
];
const UNIDADE_PADRAO = UNIDADES[0].valor;

function unidadeValida(u){
  return UNIDADES.some(x => x.valor === u) ? u : UNIDADE_PADRAO;
}

let servicos = [];
let idCounter = 0;

function novoServico(desc="", qtd=1, valor=0, unidade=UNIDADE_PADRAO){
  idCounter++;
  return {id:idCounter, desc, qtd, valor, unidade:unidadeValida(unidade)};
}

/* Mantém o valor dentro de limites que fazem sentido, e volta ao padrão
   se o campo estiver vazio ou ilegível. */
function limitar(valor, minimo, maximo, padrao){
  const n = parseNum(valor);
  if(!n) return padrao;
  return Math.min(maximo, Math.max(minimo, n));
}

function aplicarCondicoes(c){
  const v = c || {};
  el('condParcelas').value = v.parcelas || orc.PADRAO.parcelas;
  el('condDesconto').value = fmtNumeroBR(
    v.descontoPct === undefined ? orc.PADRAO.descontoAvista : v.descontoPct);
  el('condValidade').value = v.validadeDias || orc.PADRAO.validadeDias;
  el('condAbatimento').value = v.abatimento ? fmtNumeroBR(v.abatimento) : '';
}

function condicoes(){
  return {
    parcelas: Math.round(limitar(el('condParcelas').value, 1, 24, orc.PADRAO.parcelas)),
    descontoPct: limitar(el('condDesconto').value, 0, 90, orc.PADRAO.descontoAvista),
    validadeDias: Math.round(limitar(el('condValidade').value, 1, 365, orc.PADRAO.validadeDias)),
    abatimento: Math.max(0, parseNum(el('condAbatimento').value)),
  };
}

/* ---------- salvamento automático do orçamento em edição ---------- */

const CHAVE_RASCUNHO = 'beccaGesso.rascunho.v1';
let timerSalvar = null;

/* Etapa 3.3: qual oportunidade (se alguma) este orçamento em edição
   pertence. `null` é o caminho direto de sempre — orçamento sem
   Comercial nenhum, comportamento inalterado. */
let oportunidadeAtualId = null;

function estadoAtual(){
  return {
    cliNome: el('cliNome').value,
    cliEndereco: el('cliEndereco').value,
    cliTelefone: el('cliTelefone').value,
    clienteId: componentes.clienteSelecionadoId(),
    orcNumero: el('orcNumero').value,
    orcData: el('orcData').value,
    obs: el('obs').value,
    condicoes: condicoes(),
    servicos: servicos.map(s => ({desc:s.desc, qtd:s.qtd, valor:s.valor, unidade:s.unidade})),
    oportunidadeId: oportunidadeAtualId,
  };
}

/* Trava a escolha de cliente quando o orçamento pertence a uma
   oportunidade — o relacionamento (`clienteId`) não pode ser trocado
   silenciosamente por baixo dela. O snapshot documental (telefone,
   endereço) continua editável sempre: não é o mesmo papel. */
function aplicarBloqueioCliente(bloqueado){
  el('cliNome').disabled = bloqueado;
  el('cliBloqueioAviso').hidden = !bloqueado;
}

function atualizarFaixaOportunidade(){
  const faixa = el('opoContextoOrcamento');
  if(!oportunidadeAtualId){ faixa.hidden = true; return; }
  const oportunidade = domain.oportunidades.buscarPorId(oportunidadeAtualId);
  faixa.hidden = false;
  el('opoContextoTexto').textContent = oportunidade
    ? `Orçamento da oportunidade: ${oportunidade.titulo}`
    : 'Orçamento vinculado a uma oportunidade';
}

function salvar(){
  const estado = estadoAtual();
  try{
    localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(estado));
    domain.arquivarOrcamento(estado);
    piscarAviso();
  }catch(e){ /* modo privado ou cota cheia: o app segue funcionando */ }
}

function agendarSalvar(){
  clearTimeout(timerSalvar);
  timerSalvar = setTimeout(salvar, 400);
}

let timerAviso = null;
function piscarAviso(){
  const a = el('autosave');
  a.classList.add('on');
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => a.classList.remove('on'), 1400);
}

function restaurar(){
  let d = null;
  try{
    const bruto = localStorage.getItem(CHAVE_RASCUNHO);
    if(bruto) d = JSON.parse(bruto);
  }catch(e){ return false; }
  if(!d || typeof d !== 'object') return false;

  el('cliNome').value = d.cliNome || '';
  el('cliEndereco').value = d.cliEndereco || '';
  el('cliTelefone').value = d.cliTelefone || '';
  componentes.carregarSelecaoCliente(d.clienteId);
  el('orcNumero').value = d.orcNumero || orc.proximoNumero();
  el('orcData').value = d.orcData || hojeISO();
  el('obs').value = d.obs || '';
  aplicarCondicoes(d.condicoes);
  oportunidadeAtualId = d.oportunidadeId || null;
  aplicarBloqueioCliente(!!oportunidadeAtualId);
  atualizarFaixaOportunidade();

  servicos = Array.isArray(d.servicos) && d.servicos.length
    ? d.servicos.map(s => novoServico(s.desc || '', parseNum(s.qtd), parseNum(s.valor), s.unidade))
    : [novoServico()];
  return true;
}

function carregarOrcamento(e){
  el('cliNome').value = e.cliNome || '';
  el('cliEndereco').value = e.cliEndereco || '';
  el('cliTelefone').value = e.cliTelefone || '';
  componentes.carregarSelecaoCliente(e.clienteId);
  oportunidadeAtualId = e.oportunidadeId || null;
  aplicarBloqueioCliente(!!oportunidadeAtualId);
  atualizarFaixaOportunidade();
  el('orcNumero').value = e.orcNumero || orc.proximoNumero();
  el('orcData').value = e.orcData || hojeISO();
  el('obs').value = e.obs || '';
  aplicarCondicoes(e.condicoes);
  servicos = Array.isArray(e.servicos) && e.servicos.length
    ? e.servicos.map(s => novoServico(s.desc || '', parseNum(s.qtd), parseNum(s.valor), s.unidade))
    : [novoServico()];
  renderServicosEditor();
  renderDoc();
  salvar();
}

function novoOrcamento(){
  el('cliNome').value = '';
  el('cliEndereco').value = '';
  el('cliTelefone').value = '';
  componentes.limparSelecaoCliente();
  el('orcNumero').value = orc.proximoNumero();
  el('orcData').value = hojeISO();
  el('obs').value = '';
  aplicarCondicoes(null);
  oportunidadeAtualId = null;
  aplicarBloqueioCliente(false);
  atualizarFaixaOportunidade();
  servicos = [novoServico()];
  renderServicosEditor();
  renderDoc();
}

/* ---------- busca de cliente no formulário de orçamento ---------- */

let vindoDoOrcamento = false;

componentes.montarBuscaCliente({
  aoSelecionar(cliente){
    /* preenche o que estiver vazio — nunca sobrescreve o que já foi
       digitado especificamente para este orçamento */
    let mudou = false;
    if(!el('cliTelefone').value.trim() && cliente.telefone){
      el('cliTelefone').value = cliente.telefone; mudou = true;
    }
    if(!el('cliEndereco').value.trim() && cliente.endereco){
      el('cliEndereco').value = cliente.endereco; mudou = true;
    }
    renderDoc();
    agendarSalvar();
  },
  aoPedirNovoCliente(nomeDigitado){
    vindoDoOrcamento = true;
    clientesUi.abrirNovoCliente(nomeDigitado);
  },
});

/* ---------- backup ---------- */

const MARCA_BACKUP = 'becca-gesso-orcamentos';
const CHAVE_CONTADOR = 'beccaGesso.contador.v1';

function conteudoDoBackup(){
  return JSON.stringify({
    app: MARCA_BACKUP,
    versao: 1,
    geradoEm: new Date().toISOString(),
    contador: JSON.parse(localStorage.getItem(CHAVE_CONTADOR) || 'null'),
    mensagens: orc.lerMensagens(),
    historico: orc.lerHistorico(),
    contas: cta.lerContas(),
    clientes: cli.lerClientes(),
    fornecedores: forn.lerFornecedores(),
    categorias: cat.lerCategorias(),
  }, null, 2);
}

function nomeDoBackup(){
  return `becca-gesso-backup-${hojeISO()}.json`;
}

async function fazerBackup(){
  const botao = el('backupBtn');
  const rotulo = botao.textContent;
  botao.disabled = true;
  try{
    salvar();
    const quantos = orc.lerHistorico().length;
    const contas = cta.lerContas().length;
    if(!quantos && !contas){
      alert('Ainda não há nada para guardar.');
      return;
    }
    const blob = new Blob([conteudoDoBackup()], {type:'application/json'});
    const nome = nomeDoBackup();
    const arquivo = new File([blob], nome, {type:'application/json'});

    if(navigator.canShare && navigator.canShare({files:[arquivo]})){
      try{
        await navigator.share({
          files:[arquivo],
          title:'Backup da Becca Gesso',
          text:`Backup da Becca Gesso — ${quantos} ` +
               `${quantos === 1 ? 'orçamento' : 'orçamentos'} e ${contas} ` +
               `${contas === 1 ? 'conta' : 'contas'}, ${fmtDataBR(hojeISO())}`,
        });
        return;
      }catch(erro){
        if(erro && erro.name === 'AbortError') return;
      }
    }
    baixarArquivo(blob, nome);
  }catch(erro){
    alert('Não consegui gerar o backup: ' +
      (erro && erro.message ? erro.message : erro));
  }finally{
    botao.disabled = false;
    botao.textContent = rotulo;
  }
}

/* A restauração junta o arquivo ao que já existe em vez de trocar tudo:
   assim um backup antigo nunca apaga orçamentos mais novos. */
function restaurarDoTexto(texto){
  let d;
  try{ d = JSON.parse(texto); }
  catch(e){ throw new Error('esse arquivo não parece um backup'); }
  if(!d || d.app !== MARCA_BACKUP || !Array.isArray(d.historico)){
    throw new Error('esse arquivo não é um backup do gerador de orçamentos');
  }

  if(d.mensagens) orc.gravarMensagens(d.mensagens);

  const atual = orc.lerHistorico();
  const porNumero = new Map(atual.map(e => [e.orcNumero, e]));
  let novos = 0, atualizados = 0, mantidos = 0;

  for(const vindo of d.historico){
    if(!vindo || !vindo.orcNumero) continue;
    const tinha = porNumero.get(vindo.orcNumero);
    if(!tinha){
      porNumero.set(vindo.orcNumero, vindo);
      novos++;
    }else if((vindo.atualizadoEm || 0) > (tinha.atualizadoEm || 0)){
      porNumero.set(vindo.orcNumero, vindo);
      atualizados++;
    }else{
      mantidos++;
    }
  }

  const juntos = [...porNumero.values()]
    .sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0));
  orc.gravarHistorico(juntos);

  /* a numeração acompanha o maior número já usado, para não repetir */
  const ano = new Date().getFullYear();
  let maior = 0;
  for(const e of juntos){
    const [seq, anoEntrada] = String(e.orcNumero || '').split('/');
    if(Number(anoEntrada) === ano) maior = Math.max(maior, parseInt(seq, 10) || 0);
  }
  try{
    const c = JSON.parse(localStorage.getItem(CHAVE_CONTADOR) || 'null');
    const atualSeq = (c && c.ano === ano) ? c.seq : 0;
    localStorage.setItem(CHAVE_CONTADOR,
      JSON.stringify({ano: ano, seq: Math.max(atualSeq, maior)}));
  }catch(e){ /* segue sem ajustar a numeração */ }

  return Object.assign({novos, atualizados, mantidos}, restaurarContas(d.contas));
}

/* As contas seguem a mesma regra do histórico: junta em vez de trocar, e
   entre duas versões da mesma conta fica a que foi mexida por último. */
function restaurarContas(vindas){
  if(!Array.isArray(vindas)) return {contasNovas: 0, contasAtualizadas: 0};
  const porId = new Map(cta.lerContas().map(c => [c.id, c]));
  let contasNovas = 0, contasAtualizadas = 0;
  for(const c of vindas){
    if(!c || !c.id) continue;
    const tinha = porId.get(c.id);
    if(!tinha){ porId.set(c.id, c); contasNovas++; }
    else if((c.atualizadoEm || 0) > (tinha.atualizadoEm || 0)){
      porId.set(c.id, c); contasAtualizadas++;
    }
  }
  cta.gravarContas([...porId.values()]);
  return {contasNovas, contasAtualizadas};
}

function escolherBackup(){
  el('restaurarArquivo').click();
}

async function aoEscolherBackup(evento){
  const arquivo = evento.target.files && evento.target.files[0];
  evento.target.value = '';          /* permite escolher o mesmo arquivo de novo */
  if(!arquivo) return;
  try{
    const texto = await arquivo.text();
    const r = restaurarDoTexto(texto);
    renderHistorico();
    renderContas();
    alert(`Backup restaurado.\n\n` +
      `${r.novos} ${r.novos === 1 ? 'orçamento novo' : 'orçamentos novos'}\n` +
      `${r.atualizados} ${r.atualizados === 1 ? 'atualizado' : 'atualizados'}\n` +
      `${r.mantidos} já ${r.mantidos === 1 ? 'estava' : 'estavam'} aqui\n` +
      `${r.contasNovas} ${r.contasNovas === 1 ? 'conta nova' : 'contas novas'}`);
  }catch(erro){
    alert('Não consegui restaurar: ' +
      (erro && erro.message ? erro.message : erro));
  }
}

/* ---------- seções do app ---------- */

const CHAVE_SECAO = 'beccaGesso.secao.v1';

const SECOES = {
  inicio:     {alvo:'secaoInicio',     titulo:'resumo do mês'},
  orcamentos: {alvo:'secaoOrcamentos', titulo:'documento pronto para impressão / PDF'},
  contas:     {alvo:'secaoContas',     titulo:'o que a empresa tem a pagar'},
  clientes:   {alvo:'secaoClientes',   titulo:'quem já foi atendido'},
  comercial:  {alvo:'secaoComercial',  titulo:'oportunidades em andamento'},
};

function abrirSecao(nome){
  const escolhida = SECOES[nome] ? nome : 'orcamentos';
  for(const [chave, s] of Object.entries(SECOES)){
    el(s.alvo).hidden = chave !== escolhida;
  }
  document.querySelectorAll('.secao-btn').forEach(b => {
    const ativo = b.dataset.secao === escolhida;
    b.classList.toggle('ativo', ativo);
    if(ativo) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  el('tituloSecao').textContent = SECOES[escolhida].titulo;
  try{ localStorage.setItem(CHAVE_SECAO, escolhida); }catch(e){}
  if(escolhida === 'contas') renderContas();
  if(escolhida === 'inicio') renderInicio();
  if(escolhida === 'clientes') clientesUi.renderClientes();
  if(escolhida === 'comercial') comercialUi.renderOportunidades();
  window.scrollTo(0, 0);
}

function secaoGuardada(){
  try{ return localStorage.getItem(CHAVE_SECAO) || 'inicio'; }
  catch(e){ return 'inicio'; }
}

/* ---------- contas a pagar ---------- */

let contaEditando = null;      /* id da conta aberta para edição */
let filtroContas = '';         /* '', 'vencidas', 'avencer' ou 'pagas' */

const ROTULO_SITUACAO = cta.ROTULO_SITUACAO;

function limparFormConta(){
  contaEditando = null;
  el('contaFormTitulo').textContent = 'Nova conta';
  el('ctSalvar').textContent = 'Adicionar conta';
  el('ctSecundarios').hidden = true;
  el('ctDescricao').value = '';
  el('ctFornecedor').value = '';
  el('ctValor').value = '';
  el('ctVencimento').value = hojeISO();
  el('ctCategoria').value = '';
  el('ctObs').value = '';
}

/* O fornecedor e a categoria continuam sendo digitados/escolhidos como
   texto, exatamente como antes — mas ao salvar, viram (ou reaproveitam)
   um cadastro de verdade, e a conta passa a guardar o vínculo junto
   com o texto. */
function salvarConta(){
  const descricao = el('ctDescricao').value.trim();
  const valor = parseNum(el('ctValor').value);
  const vencimento = el('ctVencimento').value;

  if(!descricao) return alert('Escreva a descrição da conta.');
  if(valor <= 0) return alert('Informe o valor da conta.');
  if(!vencimento) return alert('Informe a data de vencimento.');

  const fornecedorTexto = el('ctFornecedor').value.trim();
  const categoriaTexto = el('ctCategoria').value;
  const fornecedor = fornecedorTexto ? forn.buscarOuCriarPorNome(fornecedorTexto) : null;
  const categoriaEntidade = categoriaTexto ? cat.buscarPorNome(categoriaTexto) : null;

  cta.salvarConta({
    descricao,
    fornecedor: fornecedorTexto,
    fornecedorId: fornecedor ? fornecedor.id : undefined,
    categoria: categoriaTexto,
    categoriaId: categoriaEntidade ? categoriaEntidade.id : undefined,
    valor,
    vencimento,
    obs: el('ctObs').value.trim(),
  }, contaEditando);

  limparFormConta();
  renderContas();
  piscarAvisoConta();
}

function editarConta(id){
  const c = cta.lerContas().find(x => x.id === id);
  if(!c) return;
  contaEditando = id;
  el('contaFormTitulo').textContent = 'Editando conta';
  el('ctSalvar').textContent = 'Salvar alterações';
  el('ctSecundarios').hidden = false;
  el('ctDescricao').value = c.descricao || '';
  el('ctFornecedor').value = c.fornecedor || '';
  el('ctValor').value = c.valor ? fmtValorEditavel(c.valor) : '';
  el('ctVencimento').value = c.vencimento || '';
  el('ctCategoria').value = c.categoria || '';
  el('ctObs').value = c.obs || '';
  el('ctDescricao').focus();
  el('ctDescricao').scrollIntoView({block:'center', behavior:'smooth'});
}

function alternarPagamento(id){
  cta.alternarPagamento(id);
  renderContas();
}

/* Aluguel, internet e contador voltam todo mês. Em vez de um sistema de
   repetição, um toque cria a conta do mês seguinte já preenchida. */
function repetirNoProximoMes(id){
  const r = cta.repetirNoProximoMes(id);
  if(!r.ok){
    if(r.motivo === 'duplicada'){
      alert(`Já existe essa conta com vencimento em ${fmtDataBR(r.quando)}.`);
    }
    return;
  }
  renderContas();
  alert(`Criada para ${fmtDataBR(r.quando)}.`);
}

function excluirConta(id){
  const c = cta.lerContas().find(x => x.id === id);
  if(!c) return;
  if(!confirm(`Excluir "${c.descricao}"? Isso não pode ser desfeito.`)) return;
  cta.excluirConta(id);
  if(contaEditando === id) limparFormConta();
  renderContas();
}

let timerAvisoConta = null;
function piscarAvisoConta(){
  const a = el('ctAviso');
  a.classList.add('on');
  clearTimeout(timerAvisoConta);
  timerAvisoConta = setTimeout(() => a.classList.remove('on'), 1400);
}

/* A lista de sugestão do campo Fornecedor e as opções da Categoria
   vêm dos cadastros — não mais de um texto fixo no código nem de uma
   varredura das contas já lançadas. */
function atualizarFornecedores(){
  el('fornecedoresConhecidos').innerHTML = forn.listarAtivos()
    .map(f => `<option value="${escapeAttr(f.nome)}"></option>`).join('');
}

function preencherOpcoesCategoria(){
  el('ctCategoria').innerHTML = '<option value="">— sem categoria —</option>' +
    cat.listarAtivas('DESPESA')
      .map(c => `<option value="${escapeAttr(c.nome)}">${escapeHtml(c.nome)}</option>`).join('');
}

function renderResumoContas(contas){
  const hoje = new Date();
  const mesAtual = hoje.getFullYear() + '-' + String(hoje.getMonth()+1).padStart(2,'0');
  const grupos = {
    vencidas: {rot:'Vencidas', qtd:0, valor:0},
    avencer:  {rot:'A vencer', qtd:0, valor:0},
    pagas:    {rot:'Pagas no mês', qtd:0, valor:0},
  };
  for(const c of contas){
    const sit = cta.situacaoDaConta(c);
    if(sit === 'paga'){
      if((c.pagoEm || '').startsWith(mesAtual)){
        grupos.pagas.qtd++; grupos.pagas.valor += c.valor || 0;
      }
    }else if(sit === 'vencida'){
      grupos.vencidas.qtd++; grupos.vencidas.valor += c.valor || 0;
    }else{
      grupos.avencer.qtd++; grupos.avencer.valor += c.valor || 0;
    }
  }
  el('contasResumo').innerHTML = Object.entries(grupos).map(([chave, g]) => `
    <button type="button" class="conta-chip ${chave}${
      filtroContas === chave ? ' ativo' : ''}" data-filtro="${chave}">
      <span class="chip-rot">${g.rot}</span>
      <span class="chip-val">${fmtMoeda(g.valor)}</span>
      <span class="chip-qtd">${g.qtd} ${g.qtd === 1 ? 'conta' : 'contas'}</span>
    </button>`).join('');

  el('contasResumo').querySelectorAll('.conta-chip').forEach(b =>
    b.addEventListener('click', ev => {
      const f = ev.currentTarget.dataset.filtro;
      filtroContas = (filtroContas === f) ? '' : f;
      renderContas();
    }));
}

function renderContas(){
  const todas = cta.lerContas();
  renderResumoContas(todas);
  atualizarFornecedores();

  const busca = el('contasBusca').value.trim().toLowerCase();
  const lista = todas.filter(c => {
    const sit = cta.situacaoDaConta(c);
    if(filtroContas === 'vencidas' && sit !== 'vencida') return false;
    if(filtroContas === 'pagas' && sit !== 'paga') return false;
    if(filtroContas === 'avencer' && (sit === 'paga' || sit === 'vencida')) return false;
    if(!busca) return true;
    return [c.descricao, c.fornecedor, c.categoria, c.obs]
      .some(x => (x || '').toLowerCase().includes(busca));
  }).sort((a, b) => {
    /* não pagas primeiro, e dentro de cada grupo o vencimento mais
       próximo na frente: é a ordem em que as contas precisam de atenção */
    if(!!a.pago !== !!b.pago) return a.pago ? 1 : -1;
    return String(a.vencimento).localeCompare(String(b.vencimento));
  });

  const alvo = el('contasLista');
  if(!lista.length){
    alvo.innerHTML = (busca || filtroContas)
      ? '<div class="contas-vazio">Nenhuma conta nesse filtro.</div>'
      : '<div class="contas-vazio">Nenhuma conta cadastrada ainda.<br>' +
        'Use o formulário ao lado para lançar a primeira.</div>';
    return;
  }

  alvo.innerHTML = lista.map(c => {
    const sit = cta.situacaoDaConta(c);
    const dias = diasAteVencer(c.vencimento);
    let quando = fmtDataBR(c.vencimento);
    if(sit === 'vencida') quando += ` · há ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'dia' : 'dias'}`;
    else if(sit === 'avencer' && dias !== null) quando += ` · em ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
    else if(sit === 'paga' && c.pagoEm) quando = `Paga em ${fmtDataBR(c.pagoEm)}`;

    const detalhes = [c.fornecedor, c.categoria].filter(Boolean).join(' · ');
    return `
      <div class="conta-item ${sit}">
        <div class="conta-topo">
          <span class="conta-desc">${escapeHtml(c.descricao)}</span>
          <span class="conta-valor">${fmtMoeda(c.valor || 0)}</span>
        </div>
        <div class="conta-linha2">${escapeHtml(quando)}${
          detalhes ? ' · ' + escapeHtml(detalhes) : ''}${
          c.obs ? '<br>' + escapeHtml(c.obs) : ''}</div>
        <span class="conta-marca ${sit}">${ROTULO_SITUACAO[sit]}</span>
        <div class="conta-acoes">
          <button type="button" class="ct-pagar" data-id="${escapeAttr(c.id)}">${
            c.pago ? 'Desfazer' : 'Marcar paga'}</button>
          <button type="button" class="ct-editar" data-id="${escapeAttr(c.id)}">Editar</button>
          <button type="button" class="ct-repetir" data-id="${escapeAttr(c.id)}">Próximo mês</button>
          <button type="button" class="ct-excluir" data-id="${escapeAttr(c.id)}">Excluir</button>
        </div>
      </div>`;
  }).join('');

  const ligar = (classe, acao) =>
    alvo.querySelectorAll('.' + classe).forEach(b =>
      b.addEventListener('click', ev => acao(ev.currentTarget.dataset.id)));
  ligar('ct-pagar', alternarPagamento);
  ligar('ct-editar', editarConta);
  ligar('ct-repetir', repetirNoProximoMes);
  ligar('ct-excluir', excluirConta);
}

/* ---------- tela de início ----------
   Um resumo do que precisa de atenção hoje. Não guarda nada próprio: é
   tudo lido do histórico e das contas na hora de mostrar. */

function saudacaoDoDia(){
  const h = new Date().getHours();
  if(h < 12) return 'Bom dia';
  if(h < 18) return 'Boa tarde';
  return 'Boa noite';
}

const DIAS_VENCENDO = 7;

/* ícones do início, desenhados à mão para não depender de biblioteca */
const SVG_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>';
const SVG_RELOGIO = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/>' +
  '<path d="M12 7v5l3 3"/></svg>';
const SVG_ALERTA = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2.5"><path d="M12 9v4M12 17h.01M10.3 3.9 ' +
  '1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';
const SVG_ZAP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
  '<path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm5.4 14.2c-.2.6' +
  '-1.3 1.2-1.8 1.3-.5.1-1 .1-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7' +
  '-2 .9-2.3c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .6-.1.2-.2.3-.3.5l' +
  '-.4.5c-.2.2-.3.4-.1.7.2.3.8 1.4 1.8 2.2 1.2 1.1 2.2 1.4 2.6 1.6.3.1.5.1.7-.1l.6' +
  '-.7c.2-.3.4-.2.7-.1l1.8.9c.2.1.4.2.5.3.1.2.1.9-.1 1.5Z"/></svg>';

function chip(c){
  return `<button type="button" class="chip"${
    c.acao ? ` data-acao="${escapeAttr(c.acao)}"` : ''}>
      <span class="chip-topo">
        <span class="chip-icone ${c.tom || 'neutro'}">${c.icone}</span>
        <span class="chip-rot">${escapeHtml(c.rot)}</span>
      </span>
      <span class="chip-val">${fmtMoeda(c.valor)}</span>
      <span class="chip-sub">${escapeHtml(c.sub)}</span>
    </button>`;
}

const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

/* Converte os totais em pontos de um SVG 260×36. Quando todo mês deu o
   mesmo valor (inclusive todos zerados), a faixa é zero e a linha sai
   reta no meio — nunca uma divisão por zero. */
function pontosSparkline(meses){
  const LARGURA = 260, ALTURA = 36, MARGEM = 4;
  const valores = meses.map(m => m.total);
  const max = Math.max(...valores), min = Math.min(...valores);
  const faixa = max - min;
  const coords = valores.map((v, i) => ({
    x: meses.length > 1 ? (i / (meses.length - 1)) * LARGURA : LARGURA,
    y: faixa > 0
      ? (ALTURA - MARGEM) - ((v - min) / faixa) * (ALTURA - MARGEM * 2)
      : ALTURA / 2,
  }));
  return {
    pontos: coords.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    ultimo: coords[coords.length - 1],
  };
}

/* O cartão de destaque: o total orçado no mês, a comparação com o mês
   anterior (quando há dado para comparar) e a linha dos últimos 6
   meses. */
function renderHero(orcResumo){
  const meses = totaisUltimosMeses(orc.lerHistorico(), 6);
  const atual = meses[meses.length - 1].total;
  const anterior = meses[meses.length - 2].total;

  el('heroMes').textContent = nomeDoMesCurto();
  el('heroVal').textContent = fmtMoeda(atual);

  let sub = `<span>${plural(orcResumo.mes.qtd, 'orçamento', 'orçamentos')}</span>`;
  if(anterior > 0){
    const pct = Math.round(((atual - anterior) / anterior) * 100);
    if(pct !== 0){
      const seta = pct > 0 ? '↑' : '↓';
      sub = `<span class="trend${pct < 0 ? ' baixa' : ''}">${seta} ` +
        `${Math.abs(pct)}% que ${escapeHtml(nomeDoMesDe(meses[meses.length - 2].mes))}` +
        `</span>` + sub;
    }
  }
  el('heroSub').innerHTML = sub;

  const {pontos, ultimo} = pontosSparkline(meses);
  el('heroSparkLinha').setAttribute('points', pontos);
  el('heroSparkPonto').setAttribute('cx', ultimo.x.toFixed(1));
  el('heroSparkPonto').setAttribute('cy', ultimo.y.toFixed(1));
}

function renderInicio(){
  const historico = orc.lerHistorico();
  const contasTodas = cta.lerContas();
  const resumoOrc = resumoOrcamentos(historico, orc.situacaoValida);
  const ct = resumoContasInicio(contasTodas, mesISO());
  const temAlgo = historico.length > 0 || contasTodas.length > 0;

  el('blocoVazio').hidden = temAlgo;
  el('saudacaoOla').textContent = `${saudacaoDoDia()}, Becca.`;
  el('saudacaoData').textContent = dataLongaBR();
  for(const id of ['grupoOrc', 'grupoContas'])
    if(el(id)) el(id).hidden = !temAlgo;

  renderHero(resumoOrc);

  el('chipsOrc').innerHTML = [
    chip({rot:'Aprovados', valor:resumoOrc.aprovadosMes.valor, icone:SVG_CHECK,
          tom:resumoOrc.aprovadosMes.qtd ? 'bom' : 'neutro', acao:'hist:aprovado',
          sub:plural(resumoOrc.aprovadosMes.qtd, 'orçamento', 'orçamentos')}),
    chip({rot:'Aguardando', valor:resumoOrc.aguardando.valor, icone:SVG_RELOGIO,
          tom:resumoOrc.aguardando.qtd ? 'atencao' : 'neutro', acao:'hist:enviado',
          sub:plural(resumoOrc.aguardando.qtd, 'enviado', 'enviados')}),
  ].join('');

  el('anoOrc').innerHTML = resumoOrc.ano.qtd
    ? `No ano: <b>${plural(resumoOrc.ano.qtd, 'orçamento', 'orçamentos')}</b> somando ` +
      `<b>${fmtMoeda(resumoOrc.ano.valor)}</b>, dos quais ` +
      `<b>${fmtMoeda(resumoOrc.aprovadosAno.valor)}</b> aprovados.`
    : 'Nenhum orçamento neste ano ainda.';

  el('chipsContas').innerHTML = [
    chip({rot:'Vencidas', valor:ct.vencidas.valor, icone:SVG_ALERTA,
          tom:ct.vencidas.qtd ? 'alerta' : 'neutro', acao:'contas:vencidas',
          sub:plural(ct.vencidas.qtd, 'conta', 'contas')}),
    chip({rot:`Vence em ${DIAS_VENCENDO} dias`, valor:ct.semana.valor, icone:SVG_RELOGIO,
          tom:ct.semana.qtd ? 'atencao' : 'neutro', acao:'contas:avencer',
          sub:plural(ct.semana.qtd, 'conta', 'contas')}),
    chip({rot:'Pagas no mês', valor:ct.pagasMes.valor, icone:SVG_CHECK,
          tom:ct.pagasMes.qtd ? 'bom' : 'neutro', acao:'contas:pagas',
          sub:plural(ct.pagasMes.qtd, 'conta', 'contas')}),
  ].join('');

  el('anoContas').innerHTML = ct.abertas.qtd
    ? `Em aberto no total: <b>${fmtMoeda(ct.abertas.valor)}</b> em ` +
      `<b>${plural(ct.abertas.qtd, 'conta', 'contas')}</b>.`
    : 'Nenhuma conta em aberto.';

  renderVencendo();
  renderRetornosInicio();
  renderUltimos();
}

const LIMITE_LISTA_INICIO = 5;

function renderVencendo(){
  const todas = contasVencendo(cta.lerContas());
  el('blocoVencendo').hidden = !todas.length;
  if(!todas.length) return;

  const lista = todas.slice(0, LIMITE_LISTA_INICIO);
  el('listaVencendo').innerHTML = lista.map(c => {
    const d = diasAteVencer(c.vencimento);
    const classe = d < 0 ? 'vencida' : (d === 0 ? 'hoje' : 'avencer');
    const icone = d < 0 ? SVG_ALERTA : SVG_RELOGIO;
    let quando;
    if(d < 0) quando = `<span class="atrasado">venceu há ${
      plural(Math.abs(d), 'dia', 'dias')}</span>`;
    else if(d === 0) quando = '<span class="hoje">vence hoje</span>';
    else quando = `vence em ${plural(d, 'dia', 'dias')}`;
    return `
      <div class="linha">
        <div class="linha-icone ${classe}">${icone}</div>
        <div class="linha-corpo">
          <div class="linha-nome">${escapeHtml(c.descricao)}</div>
          <div class="linha-sub">${quando} · ${fmtDataBR(c.vencimento)}${
            c.fornecedor ? ' · ' + escapeHtml(c.fornecedor) : ''}</div>
        </div>
        <div class="linha-valor">${fmtMoeda(c.valor || 0)}</div>
        <button type="button" class="linha-acao ini-pagar" data-id="${escapeAttr(c.id)}"
                aria-label="Marcar ${escapeAttr(c.descricao)} como paga">${SVG_CHECK}</button>
      </div>`;
  }).join('') + (todas.length > lista.length
    ? `<div class="linha-restam">e mais ${plural(
        todas.length - lista.length, 'conta', 'contas')} nesse prazo.</div>`
    : '');

  el('listaVencendo').querySelectorAll('.ini-pagar').forEach(b =>
    b.addEventListener('click', ev => {
      alternarPagamento(ev.currentTarget.dataset.id);
      renderInicio();
    }));
}

function renderRetornosInicio(){
  const pendentes = orc.orcamentosParaRetorno();
  el('blocoRetornos').hidden = !pendentes.length;
  if(!pendentes.length) return;

  el('listaRetornos').innerHTML = pendentes
    .slice(0, LIMITE_LISTA_INICIO)
    .map(({entrada: e, pendente: p}) => `
      <div class="linha">
        <div class="avatar">${escapeHtml(cli.iniciaisDoNome(e.cliNome))}</div>
        <div class="linha-corpo">
          <div class="linha-nome">${escapeHtml(e.cliNome || 'Sem nome')}</div>
          <div class="linha-sub">Nº ${escapeHtml(e.orcNumero)} · enviado há ${
            plural(p.dias, 'dia', 'dias')}</div>
        </div>
        <div class="linha-valor">${fmtMoeda(e.total || 0)}</div>
        <button type="button" class="zap ini-msg" data-num="${escapeAttr(e.orcNumero)}"
                data-etapa="${p.etapa}"
                aria-label="Mandar mensagem pelo WhatsApp para ${
                  escapeAttr(e.cliNome || 'o cliente')}">${SVG_ZAP}</button>
      </div>`).join('');

  el('listaRetornos').querySelectorAll('.ini-msg').forEach(b =>
    b.addEventListener('click', ev => {
      abrirConversa(ev.currentTarget.dataset.num,
        Number(ev.currentTarget.dataset.etapa));
      renderInicio();
    }));
}

function renderUltimos(){
  const todos = orc.lerHistorico().slice(0, LIMITE_LISTA_INICIO);
  el('blocoUltimos').hidden = !todos.length;
  if(!todos.length) return;

  const rotulo = s => (orc.SITUACOES.find(x => x.chave === s) || orc.SITUACOES[0]).rotulo;
  el('listaUltimos').innerHTML = todos.map(e => {
    const sit = orc.situacaoValida(e.situacao);
    return `
      <button type="button" class="linha ini-abrir" data-num="${escapeAttr(e.orcNumero)}">
        <span class="status-dot ${sit}"></span>
        <span class="linha-corpo">
          <span class="linha-nome">${escapeHtml(e.cliNome || 'Sem nome')}</span>
          <span class="linha-sub">Nº ${escapeHtml(e.orcNumero || '—')} · ${
            fmtDataBR(e.orcData)} · ${rotulo(sit)}</span>
        </span>
        <span class="linha-valor">${fmtMoeda(e.total || 0)}</span>
      </button>`;
  }).join('');

  el('listaUltimos').querySelectorAll('.ini-abrir').forEach(b =>
    b.addEventListener('click', ev => {
      const e = orc.lerHistorico().find(x => x.orcNumero === ev.currentTarget.dataset.num);
      if(!e) return;
      carregarOrcamento(e);
      abrirSecao('orcamentos');
    }));
}

/* ---------- painel da nuvem ---------- */

function abrirNuvem(){
  const cfg = cloud.lerNuvem() || {};
  el('nvUrl').value = cfg.url || '';
  el('nvChave').value = cfg.chave || '';
  el('nvAviso').hidden = true;
  desenharSituacaoNuvem();
  el('painelNuvem').hidden = false;
  document.body.style.overflow = 'hidden';
}

function fecharNuvem(){
  el('painelNuvem').hidden = true;
  document.body.style.overflow = '';
  mostrarEstadoNuvem();
}

function quandoFoi(ms){
  if(!ms) return 'ainda não';
  const min = Math.floor((Date.now() - ms) / 60000);
  if(min < 1) return 'agora há pouco';
  if(min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if(h < 24) return `há ${h} ${h === 1 ? 'hora' : 'horas'}`;
  return fmtDataBR(new Date(ms).toISOString().slice(0, 10));
}

function desenharSituacaoNuvem(){
  const caixa = el('nvSituacao');
  const sessao = cloud.lerSessaoNuvem();
  el('nvLigada').hidden = !cloud.entrouNaNuvem();
  el('nvDesligada').hidden = cloud.nuvemConfigurada();

  if(!cloud.nuvemConfigurada()){
    caixa.className = 'nuvem-situacao';
    caixa.innerHTML = 'Você desligou a nuvem neste aparelho. Os orçamentos e ' +
      'as contas existem só aqui, até ligar de novo.';
    return;
  }
  const projeto = cloud.usandoPadrao()
    ? 'o projeto da Becca Gesso' : 'um projeto personalizado';
  if(!cloud.entrouNaNuvem()){
    caixa.className = 'nuvem-situacao parcial';
    caixa.innerHTML = `Ligado a ${projeto}, mas ninguém entrou ainda. ` +
      'Feche o app e entre com o seu e-mail e senha.';
    return;
  }
  const pendentes = sync.totalPendentes();
  caixa.className = 'nuvem-situacao ligada';
  caixa.innerHTML =
    `Ligada a ${projeto} como <b>${escapeHtml(sessao.email || '—')}</b>.<br>` +
    `Última sincronia: <b>${quandoFoi(sync.ultimaSincroniaEm())}</b>.<br>` +
    (pendentes
      ? `<b>${plural(pendentes, 'item', 'itens')}</b> esperando para subir.`
      : 'Tudo que está aqui já está na nuvem.');
}

function avisarNuvem(texto){
  el('nvAviso').hidden = false;
  el('nvAviso').textContent = texto;
}

async function salvarNuvem(){
  const url = cloud.limparEndereco(el('nvUrl').value);
  const chave = cloud.limparChave(el('nvChave').value);
  if(!/^https?:\/\/.+/.test(url)) return avisarNuvem('O endereço não parece certo.');
  if(chave.length < 20) return avisarNuvem('A chave não parece completa.');

  const botao = el('nvSalvar');
  botao.disabled = true;
  botao.textContent = 'Conferindo…';
  el('nvAviso').hidden = true;

  /* só o que está EXPLICITAMENTE salvo, sem cair no padrão — é isso que
     `desfazer` tem de devolver se a conferência falhar */
  const antes = cloud.lerConfigBruta();
  const desligadaAntes = cloud.nuvemDesligadaAqui();
  cloud.salvarConfigNuvem({url, chave});

  const desfazer = () => {
    cloud.restaurarConfigBruta(antes, desligadaAntes);
    botao.disabled = false;
    botao.textContent = 'Salvar e conectar';
  };

  try{
    /* Uma leitura sem entrar. Com as regras ligadas, o esperado é vir
       uma lista vazia — a regra não deixa o anônimo enxergar linha
       nenhuma, mas o projeto responde. É isso que prova que o endereço
       existe, que a chave foi aceita e que as tabelas estão lá. */
    await cloud.pedirNuvem('/rest/v1/orcamentos?select=numero&limit=1', {semToken:true});
  }catch(erro){
    if(erro.semRede){
      desfazer();
      return avisarNuvem('Sem internet para conferir agora. Tente de novo com sinal.');
    }
    if(erro.status === 401){
      desfazer();
      return avisarNuvem('A chave não foi aceita por esse projeto. ' +
        'Confira se copiou a chave anon / publishable, e não outra.');
    }
    if(erro.status === 404){
      desfazer();
      return avisarNuvem('O projeto respondeu, mas as tabelas não existem. ' +
        'Rode o arquivo build/supabase.sql no SQL Editor do Supabase.');
    }
    desfazer();
    return avisarNuvem('Não consegui falar com esse projeto: ' + erro.message);
  }

  botao.disabled = false;
  botao.textContent = 'Salvar e conectar';
  /* escolher uma conexão à mão é ligar de novo, mesmo que estivesse desligada */
  cloud.restaurarConfigBruta({url, chave}, false);
  desenharSituacaoNuvem();
  mostrarEstadoNuvem();
  if(!cloud.entrouNaNuvem()){
    avisarNuvem('Pronto. Agora feche e abra o app para entrar com o seu ' +
      'e-mail e senha.');
  }else{
    avisarNuvem('Conexão salva.');
  }
}

async function sincronizarAgora(){
  const botao = el('nvSincronizar');
  botao.disabled = true;
  botao.textContent = 'Sincronizando…';
  el('nvAviso').hidden = true;
  try{
    const r = await sync.sincronizar({});
    if(r) avisarNuvem(`Pronto: ${plural(r.enviados, 'item enviado', 'itens enviados')}, ` +
      `${plural(r.baixados, 'item recebido', 'itens recebidos')}.`);
    desenharSituacaoNuvem();
    renderInicio();
  }catch(erro){
    avisarNuvem('Não deu certo: ' + (erro && erro.message ? erro.message : erro));
  }finally{
    botao.disabled = false;
    botao.textContent = 'Sincronizar agora';
  }
}

function sairDaConta(){
  if(!confirm('Sair da conta neste aparelho?\n\nOs orçamentos e as contas ' +
              'continuam aqui e continuam na nuvem.')) return;
  sync.esquecerNuvem();
  desenharSituacaoNuvem();
  mostrarEstadoNuvem();
  avisarNuvem('Você saiu. Feche e abra o app para entrar de novo.');
}

function desligarNuvem(){
  if(!confirm('Desligar a nuvem neste aparelho?\n\nOs orçamentos e as contas ' +
              'continuam guardados aqui, e continuam guardados na nuvem. ' +
              'O app deixa de pedir e-mail e senha para abrir, a não ser que ' +
              'este aparelho tenha uma senha própria.')) return;
  sync.esquecerNuvem();
  cloud.desligarNuvemLocal();
  el('nvUrl').value = '';
  el('nvChave').value = '';
  desenharSituacaoNuvem();
  mostrarEstadoNuvem();
  avisarNuvem('Nuvem desligada neste aparelho.');
}

function ligarPadrao(){
  cloud.ligarPadraoLocal();
  const cfg = cloud.lerNuvem() || {};
  el('nvUrl').value = cfg.url || '';
  el('nvChave').value = cfg.chave || '';
  desenharSituacaoNuvem();
  mostrarEstadoNuvem();
  avisarNuvem(cloud.entrouNaNuvem()
    ? 'Nuvem ligada de novo.'
    : 'Nuvem ligada de novo. Feche e abra o app para entrar.');
}

const RECADO_NUVEM = {
  desligada: {texto:'', titulo:''},
  fora:      {texto:'Nuvem desligada', titulo:'Entre para sincronizar'},
  indo:      {texto:'Sincronizando…', titulo:'Trocando dados com a nuvem'},
  ok:        {texto:'Tudo salvo na nuvem', titulo:''},
  offline:   {texto:'Sem internet', titulo:'O que você lançar sobe quando o sinal voltar'},
  erro:      {texto:'Nuvem com problema', titulo:''},
};

function mostrarEstadoNuvem(estado, detalhe){
  const alvo = el('nuvemEstado');
  if(!alvo) return;
  const e = estado || (!cloud.nuvemConfigurada() ? 'desligada'
                     : (cloud.entrouNaNuvem() ? 'ok' : 'fora'));
  const r = RECADO_NUVEM[e] || RECADO_NUVEM.desligada;
  alvo.hidden = !r.texto;
  alvo.className = 'nuvem-estado ' + e;
  alvo.textContent = r.texto;
  const pendentes = sync.podeSincronizar() ? sync.totalPendentes() : 0;
  if(e === 'ok' && pendentes){
    alvo.textContent = `${pendentes} ${pendentes === 1 ? 'item' : 'itens'} para subir`;
    alvo.className = 'nuvem-estado pendente';
  }
  alvo.title = detalhe || r.titulo;
}

/* ---------- painel da senha ---------- */

function abrirAcesso(){
  const tem = acesso.temSenha();
  el('acAjuda').innerHTML = tem
    ? 'A senha é pedida toda vez que o app abre. Para trocá-la, informe a ' +
      'atual e escreva a nova.<br><b>Se esquecer, não há como recuperar.</b>'
    : 'Com uma senha definida, o app passa a pedi-la ao abrir. Protege de ' +
      'quem pega o aparelho destravado — não substitui a senha do iPhone.' +
      '<br><b>Se esquecer, não há como recuperar: mantenha um backup.</b>';
  el('acAtualBloco').hidden = !tem;
  el('acRemover').hidden = !tem;
  el('acNovoUsuario').value = tem ? (acesso.lerAcesso().usuario || '') : '';
  el('acSenhaAtual').value = '';
  el('acNovaSenha').value = '';
  el('acRepetirSenha').value = '';
  el('acAviso').hidden = true;
  el('painelAcesso').hidden = false;
  document.body.style.overflow = 'hidden';
}

function fecharAcesso(){
  el('painelAcesso').hidden = true;
  document.body.style.overflow = el('painelHist').hidden ? '' : 'hidden';
}

function avisarAcesso(texto){
  el('acAviso').hidden = false;
  el('acAviso').textContent = texto;
}

async function gravarAcesso(){
  const usuario = el('acNovoUsuario').value.trim();
  const nova = el('acNovaSenha').value;
  const repetida = el('acRepetirSenha').value;

  if(acesso.temSenha()){
    const atual = el('acSenhaAtual').value;
    if(!await acesso.senhaConfere(acesso.lerAcesso().usuario, atual)){
      return avisarAcesso('A senha atual não confere.');
    }
  }
  if(!usuario) return avisarAcesso('Escolha um usuário.');
  if(nova.length < 4) return avisarAcesso('A senha precisa de pelo menos 4 caracteres.');
  if(nova !== repetida) return avisarAcesso('As duas senhas não são iguais.');

  const botao = el('acGravar');
  botao.disabled = true;
  botao.textContent = 'Salvando…';
  try{
    await acesso.definirSenha(usuario, nova);
    acesso.marcarDestrancado();
    fecharAcesso();
    alert('Senha definida.\n\nEla será pedida na próxima vez que o app abrir.\n' +
          'Guarde-a bem: não há como recuperá-la.');
  }catch(erro){
    avisarAcesso('Não consegui salvar a senha neste navegador.');
  }finally{
    botao.disabled = false;
    botao.textContent = 'Salvar';
  }
}

async function removerAcesso(){
  const atual = el('acSenhaAtual').value;
  if(!await acesso.senhaConfere(acesso.lerAcesso().usuario, atual)){
    return avisarAcesso('Informe a senha atual para poder tirá-la.');
  }
  if(!confirm('Tirar a senha? O app volta a abrir direto, sem pedir nada.')) return;
  acesso.removerSenha();
  acesso.esquecerSessao();
  fecharAcesso();
  alert('Senha removida.');
}

function trancar(){
  document.body.classList.add('trancado');
  el('tranca').hidden = false;
  const naNuvem = cloud.nuvemConfigurada();
  el('rotuloUsuario').textContent = naNuvem ? 'E-mail' : 'Usuário';
  el('acUsuario').type = naNuvem ? 'email' : 'text';
  el('acUsuario').setAttribute('inputmode', naNuvem ? 'email' : 'text');
  el('trancaNota').textContent = naNuvem
    ? 'Entre com o e-mail e a senha da sua conta. Os orçamentos e as ' +
      'contas ficam guardados na nuvem e neste aparelho.'
    : 'Se esquecer a senha não há como recuperá-la. Mantenha um backup ' +
      'dos orçamentos.';
  el('acUsuario').value = naNuvem ? ((cloud.lerSessaoNuvem() || {}).email || '') : '';
  el('acSenha').value = '';
  el('acErro').hidden = true;
  setTimeout(() => el('acUsuario').focus(), 60);
}

function destrancar(){
  acesso.marcarDestrancado();
  document.body.classList.remove('trancado');
  el('tranca').hidden = true;
}

/* Na primeira entrada com nuvem, o que já existe no aparelho precisa
   subir; e o que já está na nuvem precisa descer. */
async function depoisDeEntrar(){
  if(!sync.podeSincronizar()) return;
  try{ await sync.sincronizar({silencioso:true}); }catch(e){}
}

let tentativas = 0;

async function tentarEntrar(evento){
  if(evento) evento.preventDefault();
  const botao = el('acEntrar');
  botao.disabled = true;
  botao.textContent = 'Conferindo…';
  try{
    const ok = await acesso.entradaConfere(el('acUsuario').value, el('acSenha').value);
    if(ok){
      tentativas = 0;
      destrancar();
      mostrarEstadoNuvem();
      depoisDeEntrar();
      return;
    }
    tentativas++;
    const comoChamar = cloud.nuvemConfigurada() ? 'E-mail' : 'Usuário';
    el('acErro').hidden = false;
    el('acErro').textContent = `${comoChamar} ou senha não confere.`;
    el('acSenha').value = '';
    el('acSenha').focus();
    /* espera crescente, para dificultar tentativa após tentativa */
    if(tentativas >= 3){
      const espera = Math.min(10, tentativas - 2) * 1000;
      el('acErro').textContent =
        `${comoChamar} ou senha não confere. Aguarde ${espera / 1000}s.`;
      await new Promise(r => setTimeout(r, espera));
    }
  }catch(erro){
    el('acErro').hidden = false;
    el('acErro').textContent = (erro && erro.mostrar)
      ? erro.message
      : 'Não consegui conferir a senha neste navegador.';
  }finally{
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
}

/* ---------- painel das mensagens ---------- */

function abrirMensagens(){
  el('msgAjuda').innerHTML = 'Escreva do seu jeito. Onde você puser um destes, ' +
    'o app troca pelos dados do orçamento:<br>' +
    orc.MARCADORES.map(([m, o]) => `<b>${m}</b> ${o}`).join(' · ');
  const m = orc.lerMensagens();
  el('msgD1').value = m.d1;
  el('msgD5').value = m.d5;
  el('msgD10').value = m.d10;
  el('msgVencido').value = m.vencido;
  el('painelMsg').hidden = false;
  document.body.style.overflow = 'hidden';
}

function fecharMensagens(){
  el('painelMsg').hidden = true;
  document.body.style.overflow = el('painelHist').hidden ? '' : 'hidden';
}

function salvarMensagens(){
  orc.gravarMensagens({
    d1: el('msgD1').value,
    d5: el('msgD5').value,
    d10: el('msgD10').value,
    vencido: el('msgVencido').value,
  });
  fecharMensagens();
}

function restaurarMensagensPadrao(){
  el('msgD1').value = orc.MENSAGENS_PADRAO.d1;
  el('msgD5').value = orc.MENSAGENS_PADRAO.d5;
  el('msgD10').value = orc.MENSAGENS_PADRAO.d10;
  el('msgVencido').value = orc.MENSAGENS_PADRAO.vencido;
}

function abrirConversa(numero, etapa){
  const e = orc.lerHistorico().find(x => x.orcNumero === numero);
  if(!e) return;
  const fone = orc.telefoneParaWhats(e.cliTelefone);
  if(!fone){
    alert('Esse orçamento não tem um WhatsApp válido guardado.\n\n' +
          'Abra o orçamento e preencha o campo "WhatsApp do cliente".');
    return;
  }
  const texto = orc.mensagemDeRetorno(e, etapa || 1);
  orc.marcarRetornoFeito(numero, etapa || 1);
  window.open(`https://wa.me/${fone}?text=${encodeURIComponent(texto)}`, '_blank');
  renderHistorico();
}

/* ---------- painel do histórico ---------- */

function abrirHistorico(){
  salvar();
  el('histBusca').value = '';
  renderHistorico();
  el('painelHist').hidden = false;
  document.body.style.overflow = 'hidden';
}

function fecharHistorico(){
  el('painelHist').hidden = true;
  document.body.style.overflow = '';
  /* mudar a situação de um orçamento muda os números do início */
  if(!el('secaoInicio').hidden) renderInicio();
}

let filtroSituacao = '';         /* vazio = todas */

/* Resumo por situação. Cada quadrinho também serve de filtro, então o
   mesmo lugar responde "quanto eu mandei?" e "me mostra só esses". */
function renderResumo(todos){
  const contas = {};
  for(const s of orc.SITUACOES) contas[s.chave] = {qtd: 0, valor: 0};
  for(const e of todos){
    const c = contas[orc.situacaoValida(e.situacao)];
    c.qtd++;
    c.valor += e.total || 0;
  }
  el('histResumo').innerHTML = orc.SITUACOES.map(s => `
    <button type="button" class="hist-chip sit-${s.chave}${
      filtroSituacao === s.chave ? ' ativo' : ''}" data-sit="${s.chave}">
      <span class="chip-rot">${s.rotulo}</span>
      <span class="chip-qtd">${contas[s.chave].qtd}</span>
      <span class="chip-val">${fmtMoeda(contas[s.chave].valor)}</span>
    </button>`).join('');

  el('histResumo').querySelectorAll('.hist-chip').forEach(b =>
    b.addEventListener('click', ev => {
      const s = ev.currentTarget.dataset.sit;
      filtroSituacao = (filtroSituacao === s) ? '' : s;
      renderHistorico();
    }));
}

/* Lista de cobrança: quem já pede um retorno e ainda não teve. */
function renderRetornos(){
  const pendentes = orc.orcamentosParaRetorno();
  const caixa = el('histRetornos');
  if(!pendentes.length){
    caixa.hidden = true;
    caixa.innerHTML = '';
    return;
  }
  caixa.hidden = false;
  caixa.innerHTML = `
    <div class="retorno-titulo">Para dar retorno
      <span class="retorno-qtd">${pendentes.length}</span></div>
    ${pendentes.map(({entrada: e, pendente: p}) => `
      <div class="retorno-item">
        <div class="retorno-quem">${escapeHtml(e.cliNome || 'Sem nome')}</div>
        <div class="retorno-quando">Nº ${escapeHtml(e.orcNumero)} ·
          enviado há ${p.dias} ${p.dias === 1 ? 'dia' : 'dias'} ·
          ${fmtMoeda(e.total || 0)}</div>
        <button type="button" class="retorno-btn"
                data-num="${escapeAttr(e.orcNumero)}"
                data-etapa="${p.etapa}">Mandar mensagem</button>
      </div>`).join('')}`;

  caixa.querySelectorAll('.retorno-btn').forEach(b =>
    b.addEventListener('click', ev => {
      abrirConversa(ev.currentTarget.dataset.num,
        Number(ev.currentTarget.dataset.etapa));
    }));
}

function renderHistorico(){
  const busca = el('histBusca').value.trim().toLowerCase();
  const atual = el('orcNumero').value;
  const todos = orc.lerHistorico();
  renderRetornos();
  renderResumo(todos);

  const lista = todos.filter(e => {
    if(filtroSituacao && orc.situacaoValida(e.situacao) !== filtroSituacao) return false;
    if(!busca) return true;
    return (e.cliNome || '').toLowerCase().includes(busca)
        || (e.orcNumero || '').toLowerCase().includes(busca)
        || (e.cliEndereco || '').toLowerCase().includes(busca);
  });

  const alvo = el('histLista');
  if(!lista.length){
    alvo.innerHTML = (busca || filtroSituacao)
      ? '<div class="hist-vazio">Nenhum orçamento nesse filtro.</div>'
      : '<div class="hist-vazio">Nenhum orçamento salvo ainda.<br>' +
        'Os orçamentos aparecem aqui automaticamente conforme você preenche.</div>';
    return;
  }

  alvo.innerHTML = lista.map(e => {
    const ehAtual = e.orcNumero === atual;
    const sit = orc.situacaoValida(e.situacao);
    const pend = orc.retornoPendente(e);
    const qtdServicos = (e.servicos || []).filter(
      s => (s.desc || '').trim() || parseNum(s.valor) > 0).length;
    return `
      <div class="hist-item${ehAtual ? ' atual' : ''}">
        <div class="hist-topo">
          <span class="hist-num">Nº ${escapeHtml(e.orcNumero || '—')} ·
            ${escapeHtml(fmtDataBR(e.orcData))}</span>
          <span class="hist-total">${fmtMoeda(e.total || 0)}</span>
        </div>
        ${ehAtual ? '<div class="hist-marca">Aberto agora</div>' : ''}
        <div class="hist-cliente">${escapeHtml(e.cliNome || 'Sem nome')}</div>
        <div class="hist-obra">${escapeHtml(e.cliEndereco || 'Sem endereço')}
          · ${qtdServicos} ${qtdServicos === 1 ? 'serviço' : 'serviços'}</div>
        <div class="hist-situacao">
          <label for="sit-${escapeAttr(e.orcNumero)}">Situação</label>
          <select class="hist-sit sit-${sit}" id="sit-${escapeAttr(e.orcNumero)}"
                  data-num="${escapeAttr(e.orcNumero)}">
            ${orc.SITUACOES.map(s => `<option value="${s.chave}"${
              s.chave === sit ? ' selected' : ''}>${s.rotulo}</option>`).join('')}
          </select>
        </div>
        <div class="hist-acoes">
          <button type="button" class="hist-abrir"
                  data-num="${escapeAttr(e.orcNumero)}">Abrir</button>
          <button type="button" class="hist-duplicar"
                  data-num="${escapeAttr(e.orcNumero)}">Duplicar</button>
          ${orc.telefoneParaWhats(e.cliTelefone) ? `
          <button type="button" class="hist-msg"
                  data-num="${escapeAttr(e.orcNumero)}"
                  data-etapa="${pend ? pend.etapa : 1}">Mensagem</button>` : ''}
          <button type="button" class="hist-excluir"
                  data-num="${escapeAttr(e.orcNumero)}">Excluir</button>
        </div>
      </div>`;
  }).join('');

  alvo.querySelectorAll('.hist-msg').forEach(b => b.addEventListener('click', ev => {
    abrirConversa(ev.currentTarget.dataset.num,
      Number(ev.currentTarget.dataset.etapa) || 1);
  }));

  alvo.querySelectorAll('.hist-sit').forEach(s => s.addEventListener('change', ev => {
    /* passa pela ponte em domain/index.js: se este orçamento tiver uma
       oportunidade vinculada e a situação virar "aprovado", a
       oportunidade pode avançar para "aprovada" (Etapa 3.1, item 12) */
    domain.marcarOrcamentoESituacao(ev.currentTarget.dataset.num, ev.currentTarget.value);
    renderHistorico();
  }));

  const achar = num => orc.lerHistorico().find(x => x.orcNumero === num);

  alvo.querySelectorAll('.hist-abrir').forEach(b => b.addEventListener('click', ev => {
    const e = achar(ev.currentTarget.dataset.num);
    if(e){ carregarOrcamento(e); fecharHistorico(); }
  }));

  alvo.querySelectorAll('.hist-duplicar').forEach(b => b.addEventListener('click', ev => {
    const e = achar(ev.currentTarget.dataset.num);
    if(!e) return;
    carregarOrcamento(Object.assign({}, e, {
      orcNumero: orc.proximoNumero(),
      orcData: hojeISO(),
    }));
    fecharHistorico();
  }));

  alvo.querySelectorAll('.hist-excluir').forEach(b => b.addEventListener('click', ev => {
    const num = ev.currentTarget.dataset.num;
    const e = achar(num);
    const quem = e && e.cliNome ? ` de ${e.cliNome}` : '';
    if(!confirm(`Excluir o orçamento nº ${num}${quem}? Isso não pode ser desfeito.`)) return;
    orc.gravarHistorico(orc.lerHistorico().filter(x => x.orcNumero !== num));
    sync.marcarRemovido('orcamentos', num);
    /* se era o que está na tela, começa um novo para não ser regravado */
    if(num === el('orcNumero').value) novoOrcamento();
    renderHistorico();
  }));
}

/* ---------- editor de serviços ---------- */

function renderServicosEditor(){
  const list = el('servicosList');
  list.innerHTML = '';
  servicos.forEach(s => {
    const row = document.createElement('div');
    row.className = 'service-row';
    row.innerHTML = `
      <button type="button" class="remove-btn" data-id="${s.id}"
              aria-label="Remover serviço">&times;</button>
      <label>Descrição</label>
      <input type="text" class="s-desc" data-id="${s.id}"
             value="${escapeAttr(s.desc)}" placeholder="Ex: Forro de gesso liso">
      <div class="row3">
        <div>
          <label>Qtd.</label>
          <input type="text" inputmode="decimal" class="s-qtd" data-id="${s.id}"
                 value="${escapeAttr(s.qtd)}">
        </div>
        <div>
          <label>Unidade</label>
          <select class="s-unidade" data-id="${s.id}" aria-label="Unidade de medida">
            ${UNIDADES.map(u => `<option value="${u.valor}"${
              u.valor === s.unidade ? ' selected' : ''}>${u.rotulo}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Valor unit. (R$)</label>
          <input type="text" inputmode="decimal" class="s-valor" data-id="${s.id}"
                 value="${escapeAttr(s.valor)}">
        </div>
      </div>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('.s-desc').forEach(x => x.addEventListener('input', e => {
    updateServico(e.target.dataset.id, 'desc', e.target.value);
  }));
  list.querySelectorAll('.s-qtd').forEach(x => x.addEventListener('input', e => {
    updateServico(e.target.dataset.id, 'qtd', parseNum(e.target.value));
  }));
  list.querySelectorAll('.s-valor').forEach(x => x.addEventListener('input', e => {
    updateServico(e.target.dataset.id, 'valor', parseNum(e.target.value));
  }));
  list.querySelectorAll('.s-unidade').forEach(x => x.addEventListener('change', e => {
    updateServico(e.target.dataset.id, 'unidade', e.target.value);
  }));
  list.querySelectorAll('.remove-btn').forEach(x => x.addEventListener('click', e => {
    const id = parseInt(e.currentTarget.dataset.id, 10);
    servicos = servicos.filter(s => s.id !== id);
    if(!servicos.length) servicos = [novoServico()];
    renderServicosEditor();
    renderDoc();
    agendarSalvar();
  }));
}

function updateServico(id, campo, valor){
  const s = servicos.find(s => s.id === parseInt(id, 10));
  if(s){ s[campo] = valor; renderDoc(); agendarSalvar(); }
}

/* ---------- documento ---------- */

function renderDoc(){
  const nome = el('cliNome').value.trim();
  const endereco = el('cliEndereco').value.trim();

  el('docCliNome').textContent = nome || '—';
  el('docCliEndereco').textContent = endereco || '—';

  const numero = el('orcNumero').value || '—';
  el('docNumero').textContent = numero;
  el('carimboNum').textContent = 'Nº ' + numero;

  const c = condicoes();
  const dataStr = el('orcData').value;
  el('docData').textContent = fmtDataBR(dataStr);
  el('docValidade').textContent = fmtDate(addDias(dataStr, c.validadeDias));
  el('carimboVal').textContent = `válido ${c.validadeDias} dias`;
  el('docFoot').textContent =
    `Este orçamento é válido por ${c.validadeDias} dias a partir da data de emissão.`;
  el('payTituloCartao').textContent = 'Cartão de crédito';
  el('payTituloAvista').textContent = `À vista (${fmtNumeroBR(c.descontoPct)}% de desconto)`;

  const r = calcularOrcamento(servicos, c);

  const tbody = el('docServicos');
  tbody.innerHTML = '';
  if(!r.itensPreenchidos.length){
    tbody.innerHTML = '<tr><td colspan="4" style="color:#a7adba;font-style:italic;">Nenhum serviço adicionado ainda</td></tr>';
  } else {
    r.itensPreenchidos.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(s.desc) || '<span style="color:#a7adba">—</span>'}</td>
        <td class="num">${s.qtd.toLocaleString('pt-BR')} ${escapeHtml(unidadeValida(s.unidade))}</td>
        <td class="num">${fmtMoeda(s.valor)}</td>
        <td class="num">${fmtMoeda(s.sub)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  el('totSubtotal').textContent = fmtMoeda(r.subtotal);
  el('linhaDesconto').hidden = r.abatimento <= 0;
  el('totDesconto').textContent = '− ' + fmtMoeda(r.abatimento);
  el('totTotal').textContent = fmtMoeda(r.total);
  el('payCartao').textContent = fmtMoeda(r.total);
  el('payParcela').textContent = fmtMoeda(r.parcela);
  el('payParcelaQtd').textContent = r.parcelas;
  el('payAvista').textContent = fmtMoeda(r.avista);

  el('docObs').textContent = el('obs').value || '';

  atualizarTituloDocumento();
}

function sanitizeFilePart(str){
  return String(str).trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/* O Safari usa o título da página como nome do PDF. */
function atualizarTituloDocumento(){
  const cliente = sanitizeFilePart(el('cliNome').value);
  const numero = sanitizeFilePart(el('orcNumero').value).replace('/', '-');
  const partes = ['Orcamento Becca Gesso'];
  if(numero) partes.push(numero);
  if(cliente) partes.push(cliente);
  document.title = partes.join(' - ');
}

/* ---------- envio do PDF ---------- */

function nomeDoArquivo(){
  const numero = sanitizeFilePart(el('orcNumero').value).replace('/', '-');
  const cliente = sanitizeFilePart(el('cliNome').value);
  return ['Orcamento', numero, cliente].filter(Boolean).join(' - ') + '.pdf';
}

function dadosParaPdf(){
  const c = condicoes();
  const r = calcularOrcamento(servicos, c);
  const dataStr = el('orcData').value;
  return {
    numero: el('orcNumero').value || '—',
    data: fmtDataBR(dataStr),
    validade: fmtDate(addDias(dataStr, c.validadeDias)),
    validadeDias: c.validadeDias,
    cliNome: el('cliNome').value.trim(),
    cliEndereco: el('cliEndereco').value.trim(),
    servicos: r.itens,
    subtotal: r.subtotal,
    abatimento: r.abatimento,
    total: r.total,
    parcelas: r.parcelas,
    parcela: r.parcela,
    descontoPct: r.descontoPct,
    avista: r.avista,
    obs: el('obs').value,
    titulo: nomeDoArquivo().replace(/\.pdf$/, ''),
    fmtMoeda: fmtMoeda,
    fmtNumero: fmtNumeroBR,
  };
}

function pdfDoOrcamento(){
  const bytes = window.gerarPdfDoOrcamento(dadosParaPdf());
  return new Blob([bytes], {type:'application/pdf'});
}

function baixarArquivo(blob, nome){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function resumoParaTexto(d){
  const linhas = [
    `*Orçamento nº ${d.numero}* — Becca Gesso`,
    d.cliNome ? `Cliente: ${d.cliNome}` : '',
    d.cliEndereco ? `Obra: ${d.cliEndereco}` : '',
    '',
    `Total: *${d.fmtMoeda(d.total)}*`,
    `Cartão: até ${d.parcelas}x sem juros de ${d.fmtMoeda(d.parcela)}`,
    `À vista (${d.descontoPct}% off): ${d.fmtMoeda(d.avista)}`,
    '',
    `Válido até ${d.validade}.`,
  ];
  return linhas.filter(x => x !== '').join('\n');
}

/* Mandar o orçamento já marca como enviado. Só sobe de rascunho: um
   orçamento já aprovado não volta a "enviado" por ser mandado de novo.

   Etapa 3.3: se este orçamento pertence a uma oportunidade, o
   compartilhamento também vira um evento — "compartilhado pelo
   WhatsApp", nunca "cliente recebeu" ou "cliente viu" (o app não tem
   como provar isso). Única chamada desta função por envio bem-sucedido
   (as duas rotas de `enviarPeloWhatsApp` convergem aqui), então o
   evento nunca duplica para uma única ação — e um reenvio mais tarde é
   um novo compartilhamento de verdade, não um duplicado do mesmo. */
function marcarComoEnviado(){
  const numero = el('orcNumero').value;
  const e = orc.lerHistorico().find(x => x.orcNumero === numero);
  if(!e) return;
  if(orc.situacaoValida(e.situacao) === 'rascunho'){
    orc.marcarSituacao(numero, 'enviado');
  }
  if(e.oportunidadeId){
    ativ.criar({
      oportunidadeId: e.oportunidadeId,
      tipo: 'orcamento_compartilhado',
      texto: `Orçamento ${numero} compartilhado pelo WhatsApp`,
      dados: {numero},
      automatica: true,
    });
  }
}

async function enviarPeloWhatsApp(){
  const botao = el('zapBtn');
  const rotulo = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'Gerando PDF…';
  try{
    salvar();
    const d = dadosParaPdf();
    const blob = pdfDoOrcamento();
    const nome = nomeDoArquivo();
    const arquivo = new File([blob], nome, {type:'application/pdf'});

    /* caminho normal no iPhone: abre o compartilhamento com o PDF
       anexado e você escolhe o WhatsApp e o contato */
    if(navigator.canShare && navigator.canShare({files:[arquivo]})){
      try{
        await navigator.share({files:[arquivo], title:`Orçamento ${d.numero}`});
        marcarComoEnviado();
        return;
      }catch(erro){
        if(erro && erro.name === 'AbortError') return;   /* você cancelou */
        /* qualquer outra falha cai no plano B abaixo */
      }
    }

    /* plano B: baixa o PDF e abre o WhatsApp com o resumo em texto,
       para você anexar o arquivo na conversa */
    baixarArquivo(blob, nome);
    marcarComoEnviado();
    window.open('https://wa.me/?text=' +
      encodeURIComponent(resumoParaTexto(d)), '_blank');
  }catch(erro){
    alert('Não consegui gerar o PDF: ' + (erro && erro.message ? erro.message : erro));
  }finally{
    botao.disabled = false;
    botao.textContent = rotulo;
  }
}

/* ---------- eventos ---------- */

el('addServico').addEventListener('click', () => {
  servicos.push(novoServico());
  renderServicosEditor();
  renderDoc();
  agendarSalvar();
});

['cliNome','cliEndereco','cliTelefone','orcData','obs',
 'condParcelas','condDesconto','condValidade','condAbatimento'].forEach(id =>
  el(id).addEventListener('input', () => { renderDoc(); agendarSalvar(); })
);

el('regenNumero').addEventListener('click', () => {
  el('orcNumero').value = orc.proximoNumero();
  renderDoc();
  agendarSalvar();
});

el('printBtn').addEventListener('click', () => {
  atualizarTituloDocumento();
  salvar();
  window.print();
});

el('zapBtn').addEventListener('click', enviarPeloWhatsApp);

/* O orçamento atual já está guardado no histórico, então "Novo" não
   apaga nada: só começa outro número. */
el('resetBtn').addEventListener('click', () => {
  salvar();
  novoOrcamento();
  salvar();
});

el('histBtn').addEventListener('click', abrirHistorico);
el('histFechar').addEventListener('click', fecharHistorico);
el('histBusca').addEventListener('input', renderHistorico);
el('trancaForm').addEventListener('submit', tentarEntrar);
el('acessoBtn').addEventListener('click', abrirAcesso);
el('acFechar').addEventListener('click', fecharAcesso);
el('acGravar').addEventListener('click', gravarAcesso);
el('acRemover').addEventListener('click', removerAcesso);
el('painelAcesso').addEventListener('click', e => {
  if(e.target === el('painelAcesso')) fecharAcesso();
});

el('nuvemBtn').addEventListener('click', abrirNuvem);
el('nvFechar').addEventListener('click', fecharNuvem);
el('nvSalvar').addEventListener('click', salvarNuvem);
el('nvSincronizar').addEventListener('click', sincronizarAgora);
el('nvSair').addEventListener('click', sairDaConta);
el('nvDesligar').addEventListener('click', desligarNuvem);
el('nvLigarPadrao').addEventListener('click', ligarPadrao);
el('nuvemEstado').addEventListener('click', abrirNuvem);
el('painelNuvem').addEventListener('click', e => {
  if(e.target === el('painelNuvem')) fecharNuvem();
});
/* o sinal voltou: sobe o que ficou esperando */
window.addEventListener('online', () => sync.sincronizar({silencioso:true}));
window.addEventListener('offline', () => mostrarEstadoNuvem('offline'));

el('msgBtn').addEventListener('click', abrirMensagens);
el('msgFechar').addEventListener('click', fecharMensagens);
el('msgSalvar').addEventListener('click', salvarMensagens);
el('msgPadrao').addEventListener('click', restaurarMensagensPadrao);
el('painelMsg').addEventListener('click', e => {
  if(e.target === el('painelMsg')) fecharMensagens();
});

el('backupBtn').addEventListener('click', fazerBackup);
el('restaurarBtn').addEventListener('click', escolherBackup);
el('restaurarArquivo').addEventListener('change', aoEscolherBackup);

document.querySelectorAll('.secao-btn').forEach(b =>
  b.addEventListener('click', () => abrirSecao(b.dataset.secao)));

el('ctSalvar').addEventListener('click', salvarConta);
el('ctCancelar').addEventListener('click', limparFormConta);
el('contasBusca').addEventListener('input', renderContas);

/* ---------- clientes ---------- */

el('cliBusca').addEventListener('input', clientesUi.renderClientes);
el('cliNovoBtn').addEventListener('click', () => clientesUi.abrirNovoCliente());
el('cliFechar').addEventListener('click', clientesUi.fecharPainelCliente);
el('painelCliente').addEventListener('click', e => {
  if(e.target === el('painelCliente')) clientesUi.fecharPainelCliente();
});
el('cliSalvar').addEventListener('click', () => {
  const cliente = clientesUi.salvarFormCliente();
  if(cliente && vindoDoOrcamento){
    vindoDoOrcamento = false;
    componentes.selecionarCliente(cliente);
  }
});
el('cliDesativar').addEventListener('click', () => {
  if(confirm('Desativar este cliente? Ele some das buscas, mas os orçamentos ' +
             'dele continuam intactos.')){
    clientesUi.desativarClienteAberto();
  }
});

/* ---------- comercial ---------- */

el('opoNovoBtn').addEventListener('click', () => comercialUi.abrirNovaOportunidade());
el('opoFechar').addEventListener('click', comercialUi.fecharPainelOportunidade);
el('painelOportunidade').addEventListener('click', e => {
  if(e.target === el('painelOportunidade')) comercialUi.fecharPainelOportunidade();
});
el('opoSalvar').addEventListener('click', () => comercialUi.salvarFormOportunidade());

el('opoDetFechar').addEventListener('click', comercialUi.fecharDetalheOportunidade);
el('painelOportunidadeDetalhe').addEventListener('click', e => {
  if(e.target === el('painelOportunidadeDetalhe')) comercialUi.fecharDetalheOportunidade();
});

/* ---------- Etapa 3.3: orçamento a partir de uma oportunidade ----------
   O Comercial não sabe como o editor de orçamento funciona por dentro
   (nem deveria) — só avisa "o usuário pediu um orçamento novo" ou
   "quer abrir este orçamento". Quem decide o que fazer é aqui. */

comercialUi.aoNovoOrcamento(oportunidade => {
  comercialUi.fecharDetalheOportunidade();
  abrirSecao('orcamentos');
  novoOrcamento();
  oportunidadeAtualId = oportunidade.id;
  const cliente = cli.buscarPorId(oportunidade.clienteId);
  if(cliente) componentes.selecionarCliente(cliente);
  aplicarBloqueioCliente(true);
  atualizarFaixaOportunidade();
});

comercialUi.aoAbrirOrcamentoVinculado(numero => {
  const entrada = orc.lerHistorico().find(x => x.orcNumero === numero);
  if(!entrada) return;
  comercialUi.fecharDetalheOportunidade();
  abrirSecao('orcamentos');
  carregarOrcamento(entrada);
});

el('voltarOportunidadeBtn').addEventListener('click', () => {
  const id = oportunidadeAtualId;
  if(!id) return;
  salvar();
  abrirSecao('comercial');
  comercialUi.abrirOportunidade(id);
});

/* os cartões do início levam à seção certa já filtrada */
el('secaoInicio').addEventListener('click', ev => {
  const cartaoTocado = ev.target.closest('[data-acao]');
  if(cartaoTocado){
    const [onde, filtro] = cartaoTocado.dataset.acao.split(':');
    if(onde === 'hist'){ filtroSituacao = filtro || ''; abrirHistorico(); }
    else { filtroContas = filtro || ''; abrirSecao('contas'); }
    return;
  }
  const atalho = ev.target.closest('[data-vai]');
  if(atalho) abrirSecao(atalho.dataset.vai);
});


/* fecha ao tocar fora da caixa ou com Esc */
el('painelHist').addEventListener('click', e => {
  if(e.target === el('painelHist')) fecharHistorico();
});
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  if(!el('painelNuvem').hidden) return fecharNuvem();
  if(!el('painelAcesso').hidden) return fecharAcesso();
  if(!el('painelMsg').hidden) return fecharMensagens();
  if(!el('painelCliente').hidden) return clientesUi.fecharPainelCliente();
  if(!el('painelOportunidadeDetalhe').hidden) return comercialUi.fecharDetalheOportunidade();
  if(!el('painelOportunidade').hidden) return comercialUi.fecharPainelOportunidade();
  if(!el('painelHist').hidden) fecharHistorico();
});

/* salva ao sair / ao mandar o app para segundo plano */
window.addEventListener('beforeunload', salvar);
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'hidden'){ salvar(); return; }
  /* voltou para o app: se o prazo venceu, tranca de novo */
  if(acesso.exigeEntrada() && !acesso.estaDestrancado() && el('tranca').hidden) trancar();
  else if(acesso.exigeEntrada() && !el('tranca').hidden) return;
  else if(acesso.exigeEntrada()) acesso.marcarDestrancado();
  /* voltou para o app: boa hora para conferir se há novidade na nuvem */
  if(el('tranca').hidden) sync.sincronizar({silencioso:true});
});

/* ---------- ponte para os testes automatizados ----------
   As baterias em build/testar-*.js chamam algumas funções internas
   direto pelo `page.evaluate`. Antes desta etapa isso funcionava porque
   tudo era `function` de escopo global; com módulos ES essas funções
   deixaram de existir em `window` — o que é o comportamento certo (é
   exatamente o encapsulamento que a modularização deveria trazer).

   Em vez de reabrir esse encapsulamento função por função, expõe-se um
   único objeto, nomeado para deixar claro que é só para teste, com as
   funções que os testes efetivamente precisam chamar diretamente
   (semear dados, checar um cálculo isolado). A interface do usuário
   nunca lê `window.__beccaTeste`. */
window.__beccaTeste = {
  dadosParaPdf,
  resumoParaTexto,
  nomeDoArquivo,
  conteudoDoBackup,
  restaurarDoTexto,
  pdfDoOrcamento,
  gravarMensagens: orc.gravarMensagens,
  lerMensagens: orc.lerMensagens,
  restaurarMensagensPadrao,
  MENSAGENS_PADRAO: orc.MENSAGENS_PADRAO,
  iniciaisDoNome: cli.iniciaisDoNome,
  filtroContas: () => filtroContas,
  filtroSituacao: () => filtroSituacao,
  proximoNumero: orc.proximoNumero,
  telefoneParaWhats: orc.telefoneParaWhats,
  marcarSituacao: orc.marcarSituacao,
  limparFormConta,
  repetirNoProximoMes,
  gravarHistorico: orc.gravarHistorico,
  gravarContas: cta.gravarContas,
  lerHistorico: orc.lerHistorico,
  lerContas: cta.lerContas,
  renderInicio,
  renderHistorico,
  renderContas,
  nuvemConfigurada: cloud.nuvemConfigurada,
  limparEndereco: cloud.limparEndereco,
  limparChave: cloud.limparChave,
  pendentesDe: sync.pendentesDe,
  sincronizar: sync.sincronizar,
  esquecerNuvem: sync.esquecerNuvem,
  mostrarEstadoNuvem,
};

/* ---------- início ---------- */

/* Dados antigos (orçamentos e contas de antes desta etapa) ganham,
   aqui, uma única vez, um cliente/fornecedor/categoria de verdade em
   vez de texto solto — ver src/domain/index.js. Roda antes de
   qualquer tela desenhar, e não faz nada se já tiver rodado (é
   reexecutável com segurança: só processa o que ainda não tem o
   vínculo novo). */
try{ domain.migrarDadosLegados(); }catch(e){ /* nunca trava a abertura do app */ }

/* mostra a tela de acesso quando há senha e a sessão ainda não foi liberada */
if(document.body.classList.contains('trancado')) trancar();
else if(acesso.exigeEntrada() && !acesso.estaDestrancado()) trancar();

if(!restaurar()){
  el('orcData').value = hojeISO();
  el('orcNumero').value = orc.proximoNumero();
  aplicarCondicoes(null);
  servicos = [novoServico()];
}
renderServicosEditor();
renderDoc();

preencherOpcoesCategoria();
limparFormConta();
abrirSecao(secaoGuardada());

mostrarEstadoNuvem();
if(el('tranca').hidden) sync.sincronizar({silencioso:true});

/* ---------- funcionamento offline ---------- */
if('serviceWorker' in navigator && location.protocol.indexOf('http') === 0){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* sem service worker o app continua funcionando, só não fica offline */
    });
  });
}
