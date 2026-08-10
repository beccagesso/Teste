#!/usr/bin/env python3
"""Prepara o que o gerador de PDF do app precisa embutir.

O PDF é montado dentro do navegador (é assim que dá para mandar o arquivo
pelo WhatsApp). Para o documento sair com as fontes da marca, o PDF precisa
carregar as fontes em formato TTF e saber a largura de cada letra.

Gera build/pdf-ativos.json, que o build/gerar.py embute no index.html.

Uso:
    python3 build/preparar-pdf.py
"""
import base64
import io
import json
import subprocess
import sys
import zlib
from pathlib import Path

from fontTools.ttLib import TTFont
from PIL import Image

BUILD = Path(__file__).resolve().parent
FONTES = BUILD / 'fontes'

# apelido no PDF -> (arquivo do subset, peso a fixar se a fonte for variável)
PACOTE = {
    'inter':      ('inter.woff2', 400),
    'interBold':  ('inter.woff2', 600),
    'titulo':     ('space-grotesk.woff2', 700),
    'mono':       ('ibm-plex-mono-400.woff2', None),
    'monoBold':   ('ibm-plex-mono-600.woff2', None),
}


def como_ttf(arquivo: str, peso) -> TTFont:
    """Devolve a fonte em TTF, fixando o peso quando ela é variável."""
    origem = FONTES / arquivo
    fonte = TTFont(origem)
    if peso is not None and 'fvar' in fonte:
        temp = BUILD / '_inst.ttf'
        subprocess.run([
            sys.executable, '-m', 'fontTools.varLib.instancer', str(origem),
            f'wght={peso}', '--output', str(temp),
        ], check=True, capture_output=True)
        fonte = TTFont(temp)
        temp.unlink()
    fonte.flavor = None
    return fonte


def dados_da_fonte(arquivo: str, peso):
    fonte = como_ttf(arquivo, peso)
    upm = fonte['head'].unitsPerEm
    ordem = fonte.getGlyphOrder()
    indice = {nome: i for i, nome in enumerate(ordem)}
    hmtx = fonte['hmtx']

    # caractere -> id do glifo, e id do glifo -> largura de avanço
    cmap, larguras = {}, {}
    for codigo, nome in fonte.getBestCmap().items():
        gid = indice[nome]
        cmap[codigo] = gid
        larguras[gid] = round(hmtx[nome][0] * 1000 / upm)

    buf = io.BytesIO()
    fonte.save(buf)
    bruto = buf.getvalue()

    # o PDF exige estas medidas na descrição da fonte, em milésimos de em
    def mil(v):
        return round(v * 1000 / upm)

    cabeca, hhea = fonte['head'], fonte['hhea']
    os2 = fonte['OS/2'] if 'OS/2' in fonte else None
    altura_maiuscula = getattr(os2, 'sCapHeight', 0) or hhea.ascent

    return {
        'upm': upm,
        'cmap': cmap,
        'larguras': larguras,
        'bbox': [mil(cabeca.xMin), mil(cabeca.yMin),
                 mil(cabeca.xMax), mil(cabeca.yMax)],
        'subida': mil(hhea.ascent),
        'descida': mil(hhea.descent),
        'maiuscula': mil(altura_maiuscula),
        'inclinacao': round(fonte['post'].italicAngle),
        'ttf': base64.b64encode(bruto).decode('ascii'),
        'bytes': len(bruto),
    }


def dados_do_logo():
    """O logo vai para o PDF como imagem de paleta comprimida com Flate.

    Flate é a compressão que todo leitor de PDF entende. A alternativa
    RunLengthDecode parecia atraente por ser simples, mas nem todos os
    leitores a implementam — no iPhone o logo simplesmente sumia — e
    ainda por cima comprime menos: 15 KB contra 8 KB.

    Como o logo é fixo, a compressão é feita aqui e o navegador só
    embute os bytes prontos, sem precisar comprimir nada.
    """
    origem = BUILD / 'logo.png'
    im = Image.open(origem).convert('RGBA')
    fundo = Image.new('RGB', im.size, (255, 255, 255))
    fundo.paste(im, (0, 0), im)

    q = fundo.quantize(colors=64, method=Image.MEDIANCUT)
    indices = q.tobytes()

    # getpalette() devolve só as cores que sobraram, que costumam ser menos
    # do que as 64 pedidas. O PDF exige que o número declarado bata com o
    # tamanho da tabela: declarar 64 com 55 cores faz leitores rigorosos
    # (como o do iPhone) descartarem a imagem inteira, sem aviso.
    paleta = bytes(q.getpalette())
    cores = len(paleta) // 3
    maior = max(indices)
    if len(paleta) != cores * 3 or maior >= cores:
        sys.exit(f"ERRO: paleta do logo inconsistente — {len(paleta)} bytes, "
                 f"{cores} cores, maior índice {maior}.")

    comprimido = zlib.compress(indices, 9)
    return {
        'largura': im.size[0],
        'altura': im.size[1],
        'cores': cores,
        'paleta': base64.b64encode(paleta).decode('ascii'),
        'flate': base64.b64encode(comprimido).decode('ascii'),
        'bytes': len(comprimido) + len(paleta),
    }


# Caracteres que o documento usa sempre. Se algum faltar na fonte, ele
# some do PDF sem avisar — foi o que aconteceu com o "²" de m².
OBRIGATORIOS = "²ºª·×–—$%()/.,:0123456789ÁÂÃÉÊÍÓÔÕÚÇáâãéêíóôõúç"


def conferir_cobertura(fontes):
    faltando = {}
    for apelido, d in fontes.items():
        ausentes = [c for c in OBRIGATORIOS if ord(c) not in
                    {int(k) for k in d['cmap']}]
        if ausentes:
            faltando[apelido] = ''.join(ausentes)
    if faltando:
        for apelido, chars in faltando.items():
            print(f"  ERRO: {apelido} não tem: {chars}")
        sys.exit("\nAlgum caractere do orçamento sumiria do PDF.\n"
                 "Acrescente-o em CARACTERES de build/preparar-ativos.py "
                 "e rode esse script antes deste.")
    print(f"  cobertura conferida: {len(OBRIGATORIOS)} caracteres em "
          f"{len(fontes)} fontes")


def main():
    saida = {'fontes': {}, 'logo': dados_do_logo()}
    total = saida['logo']['bytes']
    print(f"  logo (flate)     {saida['logo']['bytes']/1024:6.1f} KB")

    for apelido, (arquivo, peso) in PACOTE.items():
        d = dados_da_fonte(arquivo, peso)
        total += d['bytes']
        print(f"  {apelido:16} {d['bytes']/1024:6.1f} KB  "
              f"({len(d['cmap'])} caracteres)")
        saida['fontes'][apelido] = d

    conferir_cobertura(saida['fontes'])

    destino = BUILD / 'pdf-ativos.json'
    destino.write_text(json.dumps(saida, separators=(',', ':')), encoding='utf-8')
    print(f"\n  bruto somado: {total/1024:.1f} KB")
    print(f"  pdf-ativos.json: {destino.stat().st_size/1024:.1f} KB "
          f"(base64 infla ~33%)")


if __name__ == '__main__':
    main()
