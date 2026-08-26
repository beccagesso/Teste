/* Ponto de entrada do domínio: reexporta cada entidade e guarda a
   migração dos dados antigos — a única peça que precisa conhecer mais
   de uma entidade ao mesmo tempo (ler orçamentos para criar clientes,
   ler contas para criar fornecedores...). Nenhum dos módulos de
   entidade importa este arquivo, só o contrário, para não criar um
   ciclo de import. */
import { gravarJson, lerJson } from '../core/storage.js';
import { gerarId } from '../core/ids.js';
import * as clientes from './clientes.js';
import * as fornecedores from './fornecedores.js';
import * as categorias from './categorias.js';
import * as orcamentos from './orcamentos.js';
import * as contas from './contas.js';
import * as oportunidades from './oportunidades.js';
import * as atividadesComerciais from './atividadesComerciais.js';
import * as origens from './origens.js';
import * as motivosPerda from './motivosPerda.js';

export {
  clientes, fornecedores, categorias, orcamentos, contas,
  oportunidades, atividadesComerciais, origens, motivosPerda,
};

/* Aprovar um orçamento pode aprovar a Oportunidade vinculada a ele —
   por isso mora aqui, não em `orcamentos.js`: é o único arquivo que já
   conhece mais de uma entidade ao mesmo tempo. Sem cascata para
   orçamentos-irmãos: só o orçamento passado como argumento é tocado. */
export function marcarOrcamentoESituacao(numero, situacao){
  orcamentos.marcarSituacao(numero, situacao);
  if(situacao === 'aprovado'){
    const e = orcamentos.lerHistorico().find(x => x.orcNumero === numero);
    if(e && e.oportunidadeId) oportunidades.alterarStatus(e.oportunidadeId, 'aprovada');
  }
}

/* Quantos orçamentos um cliente já teve, e qual foi o mais recente —
   usado na lista e na ficha do cliente. */
export function estatisticasCliente(clienteId){
  const doCliente = orcamentos.lerHistorico()
    .filter(e => e.clienteId === clienteId)
    .sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0));
  return {
    quantidade: doCliente.length,
    ultimo: doCliente[0] || null,
    orcamentos: doCliente,
  };
}

/* Os orçamentos vinculados a uma oportunidade (Etapa 3.2, exibição
   só-leitura) — mesma receita de `estatisticasCliente()`, agora
   filtrando por `oportunidadeId` em vez de `clienteId`. */
export function orcamentosDaOportunidade(oportunidadeId){
  return orcamentos.lerHistorico()
    .filter(e => e.oportunidadeId === oportunidadeId)
    .sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0));
}

/* Etapa 3.3: única fonte do evento `orcamento_criado`. `app.js` chama
   isto em vez de `orcamentos.arquivar()` direto (mesma ideia de
   `marcarOrcamentoESituacao` — coordenar duas entidades só pode
   acontecer aqui, nunca dentro de um arquivo de entidade).

   `arquivar()` roda a cada autosave (a cada 400ms de digitação); só
   registra o evento da PRIMEIRA vez que este número passa a existir —
   por isso o "já existia?" é calculado ANTES de gravar, e não depois
   (depois, o registro já estaria lá de qualquer jeito). Todo autosave
   seguinte encontra `jaExistia = true` e não gera evento nenhum. */
export function arquivarOrcamento(estado){
  const jaExistia = !!orcamentos.lerHistorico().find(x => x.orcNumero === estado.orcNumero);
  const salvo = orcamentos.arquivar(estado);
  if(salvo && !jaExistia && salvo.oportunidadeId){
    atividadesComerciais.criar({
      oportunidadeId: salvo.oportunidadeId,
      tipo: 'orcamento_criado',
      texto: `Orçamento ${salvo.orcNumero} criado`,
      dados: {numero: salvo.orcNumero, valor: salvo.total},
      automatica: true,
    });
  }
  return salvo;
}

/* ---------- normalização, para comparar sem falso positivo ---------- */

/* U+0300–U+036F: marcas diacríticas combinantes (acento, til, cedilha
   separados da letra pelo normalize('NFD')) */
const MARCAS_DIACRITICAS = /[̀-ͯ]/g;

function normalizarNome(nome){
  return String(nome || '').trim().replace(/\s+/g, ' ')
    .normalize('NFD').replace(MARCAS_DIACRITICAS, '')
    .toLowerCase();
}

function normalizarTelefone(tel){
  let d = String(tel || '').replace(/\D/g, '');
  if(d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return d;
}

/* Estratégia conservadora, na ordem pedida: telefone normalizado decide
   primeiro (é o sinal mais confiável — dois clientes diferentes
   raramente compartilham o mesmo WhatsApp); documento entraria aqui,
   mas o histórico de orçamentos nunca teve esse campo, então não há o
   que comparar; por fim nome normalizado, só quando não há ambiguidade.
   Qualquer caso onde a confiança não é alta cai em `revisao` e NÃO é
   mesclado — melhor um cliente repetido do que dois clientes diferentes
   virando um só. */
export function acharClienteCorrespondente(nomeOriginal, telefoneOriginal, listaClientes, revisao){
  const nome = normalizarNome(nomeOriginal);
  const tel = normalizarTelefone(telefoneOriginal);
  if(!nome) return null;

  if(tel){
    const porTelefone = listaClientes.find(c => normalizarTelefone(c.telefone) === tel);
    if(porTelefone) return porTelefone;
  }

  const mesmoNome = listaClientes.filter(c => normalizarNome(c.nome) === nome);
  if(!mesmoNome.length) return null;

  if(!tel){
    if(mesmoNome.length === 1) return mesmoNome[0];
    (revisao || []).push({nome: nomeOriginal, telefone: telefoneOriginal,
      motivo: 'nome repetido em mais de um cliente cadastrado, sem telefone para desempatar'});
    return null;
  }

  /* nome bate e este orçamento tem telefone, mas nenhum cliente com esse
     nome tinha esse telefone — só aceita se for o único com o nome E
     ele ainda não tinha telefone nenhum (está sendo completado) */
  const semTelefone = mesmoNome.filter(c => !normalizarTelefone(c.telefone));
  if(mesmoNome.length === 1 && semTelefone.length === 1) return semTelefone[0];

  (revisao || []).push({nome: nomeOriginal, telefone: telefoneOriginal,
    motivo: 'nome igual a um cliente já cadastrado com telefone diferente'});
  return null;
}

/* ---------- migração ----------
   Idempotente por construção: só mexe no que ainda não tem o vínculo
   novo (`clienteId`, `fornecedorId`, `categoriaId`, ou `id` técnico).
   Rodar de novo depois de já ter rodado não recria nem duplica nada —
   os testes de migração cobrem justamente isso, chamando a função duas
   vezes seguidas. */

const CHAVE_BACKUP_PRE_MIGRACAO = 'beccaGesso.backupPreMigracao.v1';
const CHAVE_REVISAO_CLIENTES = 'beccaGesso.migracaoRevisao.v1';

function fazerBackupPreMigracao(){
  if(lerJson(CHAVE_BACKUP_PRE_MIGRACAO, null)) return; /* já existe um: não sobrescreve */
  const historico = orcamentos.lerHistorico();
  const contasAtuais = contas.lerContas();
  /* nada para proteger ainda (aparelho de fábrica, sem nenhum dado) —
     esperar evita guardar um backup vazio que nunca mais seria
     atualizado, deixando um backup de verdade sem acontecer quando os
     dados chegarem depois (por sincronização ou restauração) */
  if(!historico.length && !contasAtuais.length) return;
  gravarJson(CHAVE_BACKUP_PRE_MIGRACAO, {
    quando: Date.now(),
    historico,
    contas: contasAtuais,
  });
}

export function lerBackupPreMigracao(){
  return lerJson(CHAVE_BACKUP_PRE_MIGRACAO, null);
}

export function lerCasosParaRevisao(){
  return lerJson(CHAVE_REVISAO_CLIENTES, []);
}

export function migrarDadosLegados(){
  const resultado = {
    ok: true,
    categoriasSemeadas: false,
    origensSemeadas: false,
    motivosPerdaSemeados: false,
    clientesCriados: 0,
    orcamentosVinculados: 0,
    orcamentosComIdNovo: 0,
    fornecedoresCriados: 0,
    contasVinculadas: 0,
    casosParaRevisao: [],
    erro: null,
  };

  try{
    /* 1. backup lógico antes de mexer em qualquer coisa */
    fazerBackupPreMigracao();

    /* 2. categorias padrão — só na primeira vez */
    const semCategoriasAntes = categorias.lerCategorias().length === 0;
    categorias.semearPadrao();
    resultado.categoriasSemeadas = semCategoriasAntes && categorias.lerCategorias().length > 0;

    /* 3. clientes a partir do histórico de orçamentos */
    const historico = orcamentos.lerHistorico();
    const listaClientes = clientes.lerClientes();
    const revisao = [];
    let mudouHistorico = false;

    for(const entrada of historico){
      if(!entrada.id){
        entrada.id = gerarId('orc');
        mudouHistorico = true;
        resultado.orcamentosComIdNovo++;
      }
      if(entrada.clienteId) continue;
      const nome = (entrada.cliNome || '').trim();
      if(!nome) continue;

      let correspondente = acharClienteCorrespondente(
        nome, entrada.cliTelefone, listaClientes, revisao);
      if(!correspondente){
        correspondente = clientes.criar({
          nome,
          telefone: entrada.cliTelefone || '',
          endereco: entrada.cliEndereco || '',
        });
        listaClientes.push(correspondente);
        resultado.clientesCriados++;
      }
      entrada.clienteId = correspondente.id;
      mudouHistorico = true;
      resultado.orcamentosVinculados++;
    }
    if(mudouHistorico) orcamentos.gravarHistorico(historico);
    resultado.casosParaRevisao = revisao;
    if(revisao.length) gravarJson(CHAVE_REVISAO_CLIENTES, revisao);

    /* 4. fornecedores e categorias a partir das contas a pagar */
    const fornecedoresAntes = fornecedores.lerFornecedores().length;
    const listaContas = contas.lerContas();
    let mudouContas = false;

    for(const conta of listaContas){
      if(!conta.fornecedorId && (conta.fornecedor || '').trim()){
        const f = fornecedores.buscarOuCriarPorNome(conta.fornecedor);
        if(f){ conta.fornecedorId = f.id; mudouContas = true; }
      }
      if(!conta.categoriaId && (conta.categoria || '').trim()){
        const cat = categorias.buscarPorNome(conta.categoria);
        if(cat){ conta.categoriaId = cat.id; mudouContas = true; }
      }
      if(conta.fornecedorId || conta.categoriaId) resultado.contasVinculadas++;
    }
    if(mudouContas) contas.gravarContas(listaContas);
    resultado.fornecedoresCriados = fornecedores.lerFornecedores().length - fornecedoresAntes;

    /* 5. origens de lead e motivos de perda padrão — só na primeira vez,
       mesmo padrão das categorias no passo 2 */
    const semOrigensAntes = origens.lerOrigens().length === 0;
    origens.semearPadrao();
    resultado.origensSemeadas = semOrigensAntes && origens.lerOrigens().length > 0;

    const semMotivosAntes = motivosPerda.lerMotivosPerda().length === 0;
    motivosPerda.semearPadrao();
    resultado.motivosPerdaSemeados = semMotivosAntes && motivosPerda.lerMotivosPerda().length > 0;

  }catch(erro){
    resultado.ok = false;
    resultado.erro = String((erro && erro.message) || erro);
  }

  return resultado;
}
