/* ============================================================
   Gerador de PDF do orçamento

   O PDF é montado aqui dentro, pelo próprio navegador, em vez de sair
   da impressão do sistema. É isso que permite mandar o arquivo direto
   pelo WhatsApp: o compartilhamento do iPhone precisa de um arquivo, e
   a impressão não devolve nenhum.

   As fontes e o logo vêm prontos de build/preparar-pdf.py.
   ============================================================ */

const PDF_ATIVOS = /*__PDF_ATIVOS__*/null;

const PT = 0.75;                 /* 1px de CSS = 0,75pt no PDF */
const A4 = {largura: 595.28, altura: 841.89};
const MARGEM = {lados: 16 * 2.8346, topo: 14 * 2.8346};   /* 16mm e 14mm */
const LARGURA_UTIL = A4.largura - 2 * MARGEM.lados;

/* cores da marca, em 0–1 como o PDF espera */
const COR = {
  ink:      [0.200, 0.282, 0.416],   /* #33486a */
  inkSoft:  [0.357, 0.439, 0.573],   /* #5b7092 */
  regua:    [0.851, 0.878, 0.918],   /* #d9e0ea */
  acento:   [0.333, 0.675, 0.894],   /* #55ace4 */
  ouro:     [0.710, 0.510, 0.165],   /* #b5822a */
  ouroFraco:[0.957, 0.918, 0.831],   /* #f4ead4 */
  branco:   [1, 1, 1],
  cinza:    [0.533, 0.569, 0.639],   /* #8891a3 */
  zebra:    [0.980, 0.980, 0.988],   /* #fafafc */
  cartao:   [0.984, 0.984, 0.988],   /* #fbfbfc */
};

/* ---------- bytes ---------- */

function bytesDeBase64(b64){
  const bin = atob(b64);
  const saida = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) saida[i] = bin.charCodeAt(i);
  return saida;
}

function bytesDeTexto(txt){
  const saida = new Uint8Array(txt.length);
  for(let i = 0; i < txt.length; i++) saida[i] = txt.charCodeAt(i) & 0xFF;
  return saida;
}

function juntarBytes(partes){
  let total = 0;
  for(const p of partes) total += p.length;
  const saida = new Uint8Array(total);
  let pos = 0;
  for(const p of partes){ saida.set(p, pos); pos += p.length; }
  return saida;
}

function num(v){
  return (Math.round(v * 1000) / 1000).toString();
}

/* ---------- medidas de texto ---------- */

function glifoDe(fonte, ch){
  const g = fonte.cmap[ch.codePointAt(0)];
  return g === undefined ? fonte.cmap[32] : g;   /* desconhecido vira espaço */
}

function larguraTexto(fonte, texto, tamanho, espacamento){
  let unidades = 0;
  let letras = 0;
  for(const ch of texto){
    const g = glifoDe(fonte, ch);
    unidades += (g === undefined ? 500 : (fonte.larguras[g] || 0));
    letras++;
  }
  return unidades * tamanho / 1000 + letras * (espacamento || 0);
}

function paraHex(fonte, texto){
  let hex = '';
  for(const ch of texto){
    const g = glifoDe(fonte, ch);
    hex += (g === undefined ? 0 : g).toString(16).padStart(4, '0');
  }
  return hex;
}

/* Quebra o texto em linhas que caibam na largura dada. */
function quebrarTexto(fonte, texto, tamanho, larguraMax, espacamento){
  const palavras = String(texto).split(/\s+/).filter(Boolean);
  if(!palavras.length) return [''];
  const linhas = [];
  let atual = '';
  for(const palavra of palavras){
    const tentativa = atual ? atual + ' ' + palavra : palavra;
    if(larguraTexto(fonte, tentativa, tamanho, espacamento) <= larguraMax || !atual){
      atual = tentativa;
    }else{
      linhas.push(atual);
      atual = palavra;
    }
  }
  if(atual) linhas.push(atual);
  return linhas;
}

/* ---------- página ---------- */

class Pagina {
  constructor(){
    this.ops = [];
    this.corAtual = null;
  }
  usarCor(c){
    const chave = c.join(',');
    if(this.corAtual !== chave){
      this.ops.push(`${num(c[0])} ${num(c[1])} ${num(c[2])} rg`);
      this.corAtual = chave;
    }
  }
  retangulo(x, y, largura, altura, cor){
    this.usarCor(cor);
    this.ops.push(`${num(x)} ${num(A4.altura - y - altura)} ${num(largura)} ${num(altura)} re f`);
  }
  contorno(x, y, largura, altura, cor, espessura){
    const e = espessura || 1;
    this.ops.push('q');
    this.ops.push(`${num(cor[0])} ${num(cor[1])} ${num(cor[2])} RG ${num(e)} w`);
    this.ops.push(`${num(x + e / 2)} ${num(A4.altura - y - altura + e / 2)} ` +
                  `${num(largura - e)} ${num(altura - e)} re S`);
    this.ops.push('Q');
    this.corAtual = null;
  }
  linha(x1, y1, x2, y2, cor, espessura){
    this.ops.push('q');
    this.ops.push(`${num(cor[0])} ${num(cor[1])} ${num(cor[2])} RG ${num(espessura || 1)} w`);
    this.ops.push(`${num(x1)} ${num(A4.altura - y1)} m ${num(x2)} ${num(A4.altura - y2)} l S`);
    this.ops.push('Q');
    this.corAtual = null;
  }
  /* y é a linha de base do texto, medida a partir do topo da página */
  texto(conteudo, x, y, opcoes){
    const o = opcoes || {};
    const fonte = o.fonte;
    const tamanho = o.tamanho || 10;
    const esp = o.espacamento || 0;
    const largura = larguraTexto(fonte.dados, conteudo, tamanho, esp);
    let posX = x;
    if(o.alinhamento === 'direita') posX = x - largura;
    else if(o.alinhamento === 'centro') posX = x - largura / 2;

    this.usarCor(o.cor || COR.ink);
    this.ops.push('BT');
    this.ops.push(`/${fonte.apelido} ${num(tamanho)} Tf`);
    if(esp) this.ops.push(`${num(esp)} Tc`);
    this.ops.push(`${num(posX)} ${num(A4.altura - y)} Td`);
    this.ops.push(`<${paraHex(fonte.dados, conteudo)}> Tj`);
    if(esp) this.ops.push('0 Tc');
    this.ops.push('ET');
    return largura;
  }
  /* Carimbo redondo tracejado, inclinado, com as linhas centralizadas.
     Tudo é desenhado dentro de um sistema girado em torno do centro. */
  carimbo(cx, cy, raio, linhas, graus, cor){
    const rad = graus * Math.PI / 180;
    const cos = Math.cos(rad), sen = Math.sin(rad);
    const k = 0.5523 * raio;
    const yPdf = A4.altura - cy;

    this.ops.push('q');
    this.ops.push(`${num(cos)} ${num(sen)} ${num(-sen)} ${num(cos)} ` +
                  `${num(cx)} ${num(yPdf)} cm`);

    this.ops.push(`${num(cor[0])} ${num(cor[1])} ${num(cor[2])} RG`);
    this.ops.push('1.5 w [2.5 2.5] 0 d');
    this.ops.push(`${num(raio)} 0 m`);
    this.ops.push(`${num(raio)} ${num(k)} ${num(k)} ${num(raio)} 0 ${num(raio)} c`);
    this.ops.push(`${num(-k)} ${num(raio)} ${num(-raio)} ${num(k)} ${num(-raio)} 0 c`);
    this.ops.push(`${num(-raio)} ${num(-k)} ${num(-k)} ${num(-raio)} 0 ${num(-raio)} c`);
    this.ops.push(`${num(k)} ${num(-raio)} ${num(raio)} ${num(-k)} ${num(raio)} 0 c`);
    this.ops.push('S');
    this.ops.push('[] 0 d');

    this.ops.push(`${num(cor[0])} ${num(cor[1])} ${num(cor[2])} rg`);
    let yLinha = 0;
    for(const l of linhas) yLinha += l.tamanho + (l.antes || 0);
    yLinha = yLinha / 2 - linhas[0].tamanho;     /* começa acima do centro */

    for(const l of linhas){
      yLinha -= (l.antes || 0) + l.tamanho;
      const larg = larguraTexto(l.fonte.dados, l.texto, l.tamanho, l.espacamento || 0);
      this.ops.push('BT');
      this.ops.push(`/${l.fonte.apelido} ${num(l.tamanho)} Tf`);
      if(l.espacamento) this.ops.push(`${num(l.espacamento)} Tc`);
      this.ops.push(`${num(-larg / 2)} ${num(yLinha)} Td`);
      this.ops.push(`<${paraHex(l.fonte.dados, l.texto)}> Tj`);
      if(l.espacamento) this.ops.push('0 Tc');
      this.ops.push('ET');
    }

    this.ops.push('Q');
    this.corAtual = null;
  }
  imagem(apelido, x, y, largura, altura){
    this.ops.push('q');
    this.ops.push(`${num(largura)} 0 0 ${num(altura)} ${num(x)} ` +
                  `${num(A4.altura - y - altura)} cm`);
    this.ops.push(`/${apelido} Do`);
    this.ops.push('Q');
    this.corAtual = null;
  }
  paraBytes(){
    return bytesDeTexto(this.ops.join('\n'));
  }
}

/* ---------- montagem do arquivo ---------- */

function montarArquivoPDF(paginas, fontesUsadas, temLogo, titulo){
  const objetos = [];
  const reservar = () => { objetos.push(null); return objetos.length; };
  const definir = (n, c) => {
    objetos[n - 1] = typeof c === 'string' ? bytesDeTexto(c) : c;
  };
  const fluxo = (dic, dados) => juntarBytes([
    bytesDeTexto(`<< ${dic} /Length ${dados.length} >>\nstream\n`),
    dados,
    bytesDeTexto('\nendstream'),
  ]);

  const nCatalogo = reservar();
  const nPaginas = reservar();

  /* Sem este mapa o PDF mostra o texto certo, mas copiar ou buscar
     devolve garrancho: o arquivo guarda números de glifo, não letras. */
  function mapaUnicode(dadosFonte){
    const pares = Object.entries(dadosFonte.cmap)
      .map(([codigo, gid]) => [gid, Number(codigo)])
      .sort((a, b) => a[0] - b[0]);
    let corpo = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
      '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
      '1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n';
    for(let i = 0; i < pares.length; i += 100){
      const bloco = pares.slice(i, i + 100);
      corpo += `${bloco.length} beginbfchar\n`;
      for(const [gid, codigo] of bloco){
        corpo += `<${gid.toString(16).padStart(4, '0')}> ` +
                 `<${codigo.toString(16).padStart(4, '0')}>\n`;
      }
      corpo += 'endbfchar\n';
    }
    corpo += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
    return corpo;
  }

  /* fontes */
  const refFontes = {};
  for(const [apelido, f] of Object.entries(fontesUsadas)){
    const ttf = bytesDeBase64(f.dados.ttf);
    const nArquivo = reservar();
    definir(nArquivo, fluxo(`/Length1 ${ttf.length}`, ttf));

    const nUnicode = reservar();
    definir(nUnicode, fluxo('', bytesDeTexto(mapaUnicode(f.dados))));

    const nDescritor = reservar();
    definir(nDescritor,
      `<< /Type /FontDescriptor /FontName /F${apelido} /Flags 32 ` +
      `/FontBBox [${f.dados.bbox.join(' ')}] /ItalicAngle ${f.dados.inclinacao} ` +
      `/Ascent ${f.dados.subida} /Descent ${f.dados.descida} ` +
      `/CapHeight ${f.dados.maiuscula} /StemV 80 /FontFile2 ${nArquivo} 0 R >>`);

    /* larguras por id de glifo, no formato [gid [w] gid [w] ...] */
    const larguras = Object.keys(f.dados.larguras)
      .map(Number).sort((a, b) => a - b)
      .map(g => `${g}[${f.dados.larguras[g]}]`).join(' ');

    const nCid = reservar();
    definir(nCid,
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /F${apelido} ` +
      `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
      `/FontDescriptor ${nDescritor} 0 R /DW 1000 /W [${larguras}] ` +
      `/CIDToGIDMap /Identity >>`);

    const nFonte = reservar();
    definir(nFonte,
      `<< /Type /Font /Subtype /Type0 /BaseFont /F${apelido} ` +
      `/Encoding /Identity-H /DescendantFonts [${nCid} 0 R] ` +
      `/ToUnicode ${nUnicode} 0 R >>`);
    refFontes[apelido] = nFonte;
  }

  /* logo */
  let nLogo = null;
  if(temLogo){
    const logo = PDF_ATIVOS.logo;
    const paleta = bytesDeBase64(logo.paleta);
    let hexPaleta = '';
    for(const b of paleta) hexPaleta += b.toString(16).padStart(2, '0');
    nLogo = reservar();
    definir(nLogo, fluxo(
      `/Type /XObject /Subtype /Image /Width ${logo.largura} ` +
      `/Height ${logo.altura} /BitsPerComponent 8 ` +
      `/ColorSpace [/Indexed /DeviceRGB ${logo.cores - 1} <${hexPaleta}>] ` +
      `/Filter /FlateDecode`,
      bytesDeBase64(logo.flate)));
  }

  const recursos =
    `<< /Font << ${Object.entries(refFontes)
      .map(([a, n]) => `/${a} ${n} 0 R`).join(' ')} >>` +
    (nLogo ? ` /XObject << /Logo ${nLogo} 0 R >>` : '') + ' >>';

  /* páginas */
  const refPaginas = [];
  for(const pagina of paginas){
    const nConteudo = reservar();
    definir(nConteudo, fluxo('', pagina.paraBytes()));
    const nPagina = reservar();
    definir(nPagina,
      `<< /Type /Page /Parent ${nPaginas} 0 R ` +
      `/MediaBox [0 0 ${num(A4.largura)} ${num(A4.altura)}] ` +
      `/Resources ${recursos} /Contents ${nConteudo} 0 R >>`);
    refPaginas.push(nPagina);
  }

  definir(nPaginas,
    `<< /Type /Pages /Count ${refPaginas.length} ` +
    `/Kids [${refPaginas.map(n => `${n} 0 R`).join(' ')}] >>`);

  const nInfo = reservar();
  const agora = new Date();
  const doisDig = v => String(v).padStart(2, '0');
  const dataPdf = `D:${agora.getFullYear()}${doisDig(agora.getMonth() + 1)}` +
    `${doisDig(agora.getDate())}${doisDig(agora.getHours())}` +
    `${doisDig(agora.getMinutes())}${doisDig(agora.getSeconds())}`;
  definir(nInfo,
    `<< /Title (${titulo.replace(/[()\\]/g, '')}) /Producer (Becca Gesso) ` +
    `/CreationDate (${dataPdf}) >>`);

  definir(nCatalogo, `<< /Type /Catalog /Pages ${nPaginas} 0 R >>`);

  /* junta tudo e monta a tabela de referências */
  const partes = [bytesDeTexto('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  let posicao = partes[0].length;
  const offsets = [];
  objetos.forEach((corpo, i) => {
    offsets[i] = posicao;
    const cabeca = bytesDeTexto(`${i + 1} 0 obj\n`);
    const rabo = bytesDeTexto('\nendobj\n');
    const bloco = juntarBytes([cabeca, corpo, rabo]);
    partes.push(bloco);
    posicao += bloco.length;
  });

  let xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for(const off of offsets){
    xref += String(off).padStart(10, '0') + ' 00000 n \n';
  }
  xref += `trailer\n<< /Size ${objetos.length + 1} /Root ${nCatalogo} 0 R ` +
          `/Info ${nInfo} 0 R >>\nstartxref\n${posicao}\n%%EOF\n`;
  partes.push(bytesDeTexto(xref));

  return juntarBytes(partes);
}

/* ---------- desenho do orçamento ---------- */

function fontesDoPdf(){
  const usadas = {};
  for(const [apelido, dados] of Object.entries(PDF_ATIVOS.fontes)){
    usadas[apelido] = {apelido, dados};
  }
  return usadas;
}

function gerarPdfDoOrcamento(d){
  const F = fontesDoPdf();
  const paginas = [];
  let p = null;
  let y = 0;

  const X0 = MARGEM.lados;
  const X1 = A4.largura - MARGEM.lados;

  /* cabeçalho da empresa: vai em todas as páginas, para uma folha
     solta nunca virar um papel sem identificação */
  function novaPagina(){
    p = new Pagina();
    paginas.push(p);
    y = MARGEM.topo;

    const logoLargura = 190 * PT;
    const logoAltura = logoLargura * PDF_ATIVOS.logo.altura / PDF_ATIVOS.logo.largura;
    p.imagem('Logo', X0, y, logoLargura, logoAltura);

    let yEmpresa = y + logoAltura + 12 * PT;
    p.texto('CNPJ 60.655.817/0001-20', X0, yEmpresa + 8.6,
      {fonte: F.inter, tamanho: 11.5 * PT, cor: COR.inkSoft});
    yEmpresa += 17.25 * PT;
    p.texto('(14) 99757-7371 · beccagesso@gmail.com', X0, yEmpresa + 8.6,
      {fonte: F.inter, tamanho: 11.5 * PT, cor: COR.inkSoft});

    /* etiqueta ORÇAMENTO e os dados do documento, à direita */
    const rotulo = 'ORÇAMENTO';
    const tamRotulo = 12 * PT;
    const espRotulo = 0.12 * tamRotulo;
    const largRotulo = larguraTexto(F.titulo.dados, rotulo, tamRotulo, espRotulo);
    const caixaLarg = largRotulo + 20 * PT;
    const caixaAlt = 22 * PT;
    p.contorno(X1 - caixaLarg, y, caixaLarg, caixaAlt, COR.ink, 1.5 * PT);
    p.texto(rotulo, X1 - caixaLarg + 10 * PT, y + 15 * PT,
      {fonte: F.titulo, tamanho: tamRotulo, cor: COR.ink, espacamento: espRotulo});

    let yMeta = y + caixaAlt + 8 * PT;
    const linhasMeta = [
      ['Nº', d.numero],
      ['Data', d.data],
      ['Válido até', d.validade],
    ];
    for(const [rot, valor] of linhasMeta){
      yMeta += 11.5 * PT;
      const largValor = larguraTexto(F.mono.dados, ' ' + valor, 11.5 * PT, 0);
      p.texto(valor, X1, yMeta, {fonte: F.mono, tamanho: 11.5 * PT,
        cor: COR.inkSoft, alinhamento: 'direita'});
      p.texto(rot, X1 - largValor, yMeta, {fonte: F.monoBold, tamanho: 11.5 * PT,
        cor: COR.ink, alinhamento: 'direita'});
      yMeta += 3 * PT;
    }

    y = Math.max(yEmpresa + 10 * PT, yMeta) + 22 * PT;
    p.linha(X0, y, X1, y, COR.ink, 2 * PT);
    y += 24 * PT;
  }

  novaPagina();

  /* ----- cliente e carimbo ----- */
  const yPartes = y;
  p.texto('CLIENTE', X0, y + 7.5,
    {fonte: F.interBold, tamanho: 10 * PT, cor: COR.acento, espacamento: 0.1 * 10 * PT});
  y += 14 * PT;
  p.texto(d.cliNome || '—', X0, y + 11,
    {fonte: F.interBold, tamanho: 14.5 * PT, cor: COR.ink});
  y += 20 * PT;
  p.texto('ENDEREÇO DA OBRA', X0, y + 7,
    {fonte: F.interBold, tamanho: 9.5 * PT, cor: COR.inkSoft, espacamento: 0.08 * 9.5 * PT});
  y += 12 * PT;
  for(const linha of quebrarTexto(F.inter.dados, d.cliEndereco || '—',
        12 * PT, LARGURA_UTIL * 0.62, 0)){
    p.texto(linha, X0, y + 9, {fonte: F.inter, tamanho: 12 * PT, cor: COR.inkSoft});
    y += 18 * PT;
  }

  /* carimbo, à direita do bloco do cliente */
  const raioCarimbo = 52 * PT;
  p.carimbo(X1 - raioCarimbo, yPartes + raioCarimbo, raioCarimbo, [
    {texto: 'ORÇAMENTO', fonte: F.titulo, tamanho: 10 * PT,
     espacamento: 0.08 * 10 * PT},
    {texto: `Nº ${d.numero}`, fonte: F.mono, tamanho: 9.5 * PT, antes: 3 * PT},
    {texto: `válido ${d.validadeDias} dias`, fonte: F.mono, tamanho: 9 * PT,
     antes: 2 * PT},
  ], -9, COR.ink);

  y = Math.max(y, yPartes + 2 * raioCarimbo) + 26 * PT;

  /* ----- tabela de serviços ----- */
  const colunas = [
    {larg: 0.50, alinha: 'esquerda', titulo: 'DESCRIÇÃO'},
    {larg: 0.14, alinha: 'direita',  titulo: 'QTD.'},
    {larg: 0.18, alinha: 'direita',  titulo: 'VALOR UNIT.'},
    {larg: 0.18, alinha: 'direita',  titulo: 'SUBTOTAL'},
  ];
  let acumulado = X0;
  for(const c of colunas){
    c.x = acumulado;
    c.largura = c.larg * LARGURA_UTIL;
    acumulado += c.largura;
  }
  const PAD = 10 * PT;

  function cabecalhoTabela(){
    const alturaCab = 27 * PT;
    p.retangulo(X0, y, LARGURA_UTIL, alturaCab, COR.ink);
    for(const c of colunas){
      const x = c.alinha === 'direita' ? c.x + c.largura - PAD : c.x + PAD;
      p.texto(c.titulo, x, y + 17.5 * PT, {
        fonte: F.interBold, tamanho: 10 * PT, cor: COR.branco,
        espacamento: 0.08 * 10 * PT,
        alinhamento: c.alinha === 'direita' ? 'direita' : 'esquerda',
      });
    }
    y += alturaCab;
  }

  cabecalhoTabela();

  const LIMITE = A4.altura - MARGEM.topo - 40 * PT;
  let zebra = false;
  const linhasServico = d.servicos.filter(
    s => (s.desc || '').trim() || s.valor > 0);

  if(!linhasServico.length){
    p.texto('Nenhum serviço adicionado ainda', X0 + PAD, y + 17 * PT,
      {fonte: F.inter, tamanho: 12.5 * PT, cor: COR.cinza});
    y += 27 * PT;
  }

  for(const s of linhasServico){
    const linhasDesc = quebrarTexto(F.inter.dados, s.desc || '—',
      12.5 * PT, colunas[0].largura - 2 * PAD, 0);
    const alturaLinha = Math.max(1, linhasDesc.length) * 15 * PT + 12 * PT;

    if(y + alturaLinha > LIMITE){
      novaPagina();
      cabecalhoTabela();
      zebra = false;
    }

    if(zebra) p.retangulo(X0, y, LARGURA_UTIL, alturaLinha, COR.zebra);
    zebra = !zebra;

    let yTexto = y + 9 * PT + 9.4;
    linhasDesc.forEach((linha, i) => {
      p.texto(linha, colunas[0].x + PAD, yTexto + i * 15 * PT,
        {fonte: F.inter, tamanho: 12.5 * PT, cor: COR.ink});
    });

    const celulas = [
      {c: colunas[1], txt: `${d.fmtNumero(s.qtd)} ${s.unidade}`},
      {c: colunas[2], txt: d.fmtMoeda(s.valor)},
      {c: colunas[3], txt: d.fmtMoeda(s.qtd * s.valor)},
    ];
    for(const {c, txt} of celulas){
      p.texto(txt, c.x + c.largura - PAD, yTexto,
        {fonte: F.mono, tamanho: 12.5 * PT, cor: COR.ink, alinhamento: 'direita'});
    }

    y += alturaLinha;
    p.linha(X0, y, X1, y, COR.regua, 1 * PT);
  }

  /* ----- totais ----- */
  y += 6 * PT;
  const larguraTotais = 200 * PT;
  const xRotulo = X1 - larguraTotais;
  y += 16 * PT;
  p.texto('Subtotal', xRotulo, y, {fonte: F.mono, tamanho: 13 * PT, cor: COR.inkSoft});
  p.texto(d.fmtMoeda(d.subtotal), X1, y,
    {fonte: F.monoBold, tamanho: 13 * PT, cor: COR.ink, alinhamento: 'direita'});

  /* a linha de desconto só existe quando há desconto */
  if(d.abatimento > 0){
    y += 19 * PT;
    p.texto('Desconto', xRotulo, y, {fonte: F.mono, tamanho: 13 * PT, cor: COR.inkSoft});
    p.texto('− ' + d.fmtMoeda(d.abatimento), X1, y,
      {fonte: F.monoBold, tamanho: 13 * PT, cor: COR.ink, alinhamento: 'direita'});
  }

  y += 12 * PT;
  p.linha(xRotulo - 6 * PT, y, X1, y, COR.ink, 2 * PT);
  y += 20 * PT;
  p.texto('Total', xRotulo, y, {fonte: F.mono, tamanho: 16 * PT, cor: COR.inkSoft});
  p.texto(d.fmtMoeda(d.total), X1, y,
    {fonte: F.monoBold, tamanho: 16 * PT, cor: COR.ink, alinhamento: 'direita'});

  /* ----- formas de pagamento ----- */
  y += 30 * PT;
  const alturaCartao = 74 * PT;
  if(y + alturaCartao > LIMITE) novaPagina();
  const larguraCartao = (LARGURA_UTIL - 16 * PT) / 2;

  function cartao(x, titulo, valor, sub, destaque){
    p.retangulo(x, y, larguraCartao, alturaCartao,
      destaque ? COR.ouroFraco : COR.cartao);
    p.contorno(x, y, larguraCartao, alturaCartao,
      destaque ? COR.ouro : COR.regua, 1 * PT);
    p.texto(titulo, x + 16 * PT, y + 14 * PT + 7.7, {
      fonte: F.interBold, tamanho: 10.5 * PT,
      cor: destaque ? COR.ouro : COR.inkSoft, espacamento: 0.07 * 10.5 * PT,
    });
    p.texto(valor, x + 16 * PT, y + 44 * PT,
      {fonte: F.monoBold, tamanho: 19 * PT, cor: COR.ink});
    p.texto(sub, x + 16 * PT, y + 60 * PT,
      {fonte: F.inter, tamanho: 11 * PT, cor: COR.inkSoft});
  }

  cartao(X0, 'CARTÃO DE CRÉDITO', d.fmtMoeda(d.total),
    `em até ${d.parcelas}x sem juros de ${d.fmtMoeda(d.parcela)}`, false);
  cartao(X0 + larguraCartao + 16 * PT,
    `À VISTA (${d.fmtNumero(d.descontoPct)}% DE DESCONTO)`, d.fmtMoeda(d.avista),
    'Pix, dinheiro ou transferência', true);
  y += alturaCartao;

  /* ----- observações ----- */
  if((d.obs || '').trim()){
    y += 24 * PT;
    for(const paragrafo of d.obs.split('\n')){
      const linhas = paragrafo.trim()
        ? quebrarTexto(F.inter.dados, paragrafo, 11.5 * PT, LARGURA_UTIL, 0)
        : [''];
      for(const linha of linhas){
        if(y > LIMITE) novaPagina();
        p.texto(linha, X0, y + 8.6, {fonte: F.inter, tamanho: 11.5 * PT, cor: COR.inkSoft});
        y += 18 * PT;
      }
    }
  }

  /* ----- fecho com os dados da empresa -----
     A altura tem de contar o bloco inteiro: régua, três linhas, régua e
     a nota de validade. Reservar menos faz o rodapé sair cortado no pé
     da folha em orçamentos de tamanho intermediário. */
  const alturaFecho = (44 + 18 + 20 + 19.5 + 30 + 14 + 12) * PT;
  if(y + alturaFecho > LIMITE){
    novaPagina();               /* já começa logo abaixo do cabeçalho */
  }else{
    y += 44 * PT;
  }
  p.linha(X0, y, X1, y, COR.ink, 2 * PT);
  y += 18 * PT;
  const meio = X0 + LARGURA_UTIL / 2;
  p.texto('Becca Gesso', meio, y + 11, {
    fonte: F.titulo, tamanho: 15 * PT, cor: COR.ink, alinhamento: 'centro'});
  y += 20 * PT;
  p.texto('CNPJ 60.655.817/0001-20', meio, y + 8.6,
    {fonte: F.inter, tamanho: 11.5 * PT, cor: COR.inkSoft, alinhamento: 'centro'});
  y += 19.5 * PT;
  p.texto('(14) 99757-7371 · beccagesso@gmail.com', meio, y + 8.6,
    {fonte: F.inter, tamanho: 11.5 * PT, cor: COR.inkSoft, alinhamento: 'centro'});

  y += 30 * PT;
  p.linha(X0, y, X1, y, COR.regua, 1 * PT);
  y += 14 * PT;
  p.texto(`Este orçamento é válido por ${d.validadeDias} dias a partir da data de emissão.`,
    meio, y + 7.9, {fonte: F.inter, tamanho: 10.5 * PT, cor: COR.cinza, alinhamento: 'centro'});

  return montarArquivoPDF(paginas, F, true, d.titulo);
}
