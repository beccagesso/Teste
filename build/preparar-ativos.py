#!/usr/bin/env python3
"""Regenera as fontes reduzidas e o logo otimizado.

Só é preciso rodar isto se o logo mudar ou se o orçamento passar a usar
algum caractere fora da lista CARACTERES abaixo. No dia a dia, basta
`python3 build/gerar.py`.

Precisa de internet e das bibliotecas:
    pip install Pillow fonttools brotli

Uso:
    python3 build/preparar-ativos.py
"""
import base64
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

from PIL import Image

BUILD = Path(__file__).resolve().parent
FONTES = BUILD / 'fontes'
RAIZ = BUILD.parent

CSS_GOOGLE = (
    "https://fonts.googleapis.com/css2"
    "?family=Space+Grotesk:wght@500;600;700"
    "&family=IBM+Plex+Mono:wght@400;500;600"
    "&family=Inter:wght@400;500;600&display=swap"
)
UA_NAVEGADOR = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36")

# Todo caractere que pode aparecer num orçamento. O subset 'latin' do Google
# já cobre os acentos do português; latin-ext seria desperdício.
CARACTERES = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    "ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ"
    " .,;:!?'\"()[]{}/\\|-_+=*&%#@$^~`<>ºª°·×–—‘’“”…€"
    "²³"                       # m² e m³: sem isto a unidade some no PDF
    "−"                        # sinal de menos da linha de desconto
)
UNICODES = ",".join(f"U+{ord(c):04X}" for c in sorted(set(CARACTERES)))
FEATURES = "kern,liga,tnum,ccmp,locl,mark,mkmk"

# Inter e Space Grotesk são fontes variáveis: um arquivo cobre a faixa toda e
# fica bem menor que instâncias separadas. IBM Plex Mono é estática.
VARIAVEIS = [('Inter', 'inter', 400, 700), ('Space Grotesk', 'space-grotesk', 400, 700)]
ESTATICAS = [('IBM Plex Mono', 'ibm-plex-mono', 400), ('IBM Plex Mono', 'ibm-plex-mono', 600)]

INK, ACENTO, BRANCO = (51, 72, 106), (84, 172, 228), (255, 255, 255)


def baixar_css() -> str:
    req = urllib.request.Request(CSS_GOOGLE, headers={'User-Agent': UA_NAVEGADOR})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode('utf-8')


def urls_latin(css: str) -> dict:
    """Mapeia (familia, peso) -> url do arquivo woff2 do subset 'latin'."""
    achados = {}
    for m in re.finditer(r"/\*\s*([\w-]+)\s*\*/\s*@font-face\s*\{(.*?)\}", css, re.S):
        subset, corpo = m.group(1), m.group(2)
        if subset != 'latin':
            continue
        fam = re.search(r"font-family:\s*'([^']+)'", corpo).group(1)
        peso = int(re.search(r"font-weight:\s*(\d+)", corpo).group(1))
        achados[(fam, peso)] = re.search(r"url\((https://[^)]+)\)", corpo).group(1)
    return achados


def baixar(url: str, destino: Path) -> None:
    req = urllib.request.Request(url, headers={'User-Agent': UA_NAVEGADOR})
    with urllib.request.urlopen(req, timeout=60) as r:
        destino.write_bytes(r.read())


def reduzir(origem: Path, destino: Path) -> int:
    subprocess.run([
        sys.executable, '-m', 'fontTools.subset', str(origem),
        f'--unicodes={UNICODES}', '--flavor=woff2',
        f'--layout-features={FEATURES}', '--no-hinting',
        f'--output-file={destino}',
    ], check=True, capture_output=True)
    return destino.stat().st_size


def preparar_fontes() -> None:
    print("Baixando a lista de fontes do Google...")
    urls = urls_latin(baixar_css())
    FONTES.mkdir(parents=True, exist_ok=True)
    temp = BUILD / '_tmp'
    temp.mkdir(exist_ok=True)
    antes = depois = 0

    for familia, slug, minimo, maximo in VARIAVEIS:
        origem = next((urls[(familia, p)] for p in (400, 500, 600, 700)
                       if (familia, p) in urls), None)
        if not origem:
            sys.exit(f"ERRO: não achei {familia} no CSS do Google.")
        bruto = temp / f'{slug}-origem.woff2'
        baixar(origem, bruto)
        antes += bruto.stat().st_size
        # limita a faixa de pesos antes de reduzir os caracteres
        fatiado = temp / f'{slug}-faixa.ttf'
        subprocess.run([
            sys.executable, '-m', 'fontTools.varLib.instancer', str(bruto),
            f'wght={minimo}:{maximo}', '--output', str(fatiado),
        ], check=True, capture_output=True)
        tam = reduzir(fatiado, FONTES / f'{slug}.woff2')
        depois += tam
        print(f"  {familia:15} variável {minimo}-{maximo}  {tam/1024:5.1f} KB")

    for familia, slug, peso in ESTATICAS:
        if (familia, peso) not in urls:
            sys.exit(f"ERRO: não achei {familia} peso {peso} no CSS do Google.")
        bruto = temp / f'{slug}-{peso}-origem.woff2'
        baixar(urls[(familia, peso)], bruto)
        antes += bruto.stat().st_size
        tam = reduzir(bruto, FONTES / f'{slug}-{peso}.woff2')
        depois += tam
        print(f"  {familia:15} peso {peso}          {tam/1024:5.1f} KB")

    for f in temp.iterdir():
        f.unlink()
    temp.rmdir()
    print(f"  total: {antes/1024:.1f} KB -> {depois/1024:.1f} KB")


def recorte_do_conteudo(im: Image.Image) -> Image.Image:
    """O PNG original traz uma moldura preta de 3px e muito espaço vazio."""
    largura, altura = im.size
    dentro = im.crop((4, 4, largura - 4, altura - 4))
    alfa = dentro.getchannel('A').load()
    w, h = dentro.size
    xs = [x for x in range(w) if any(alfa[x, y] > 16 for y in range(0, h, 2))]
    ys = [y for y in range(h) if any(alfa[x, y] > 16 for x in range(0, w, 2))]
    return dentro.crop((xs[0], ys[0], xs[-1] + 1, ys[-1] + 1))


def distancia(a, b) -> float:
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def recolorir(im: Image.Image, nova_cor) -> Image.Image:
    """Troca o azul-marinho por outra cor, preservando o azul-claro."""
    saida = im.copy()
    px = saida.load()
    w, h = saida.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a and distancia((r, g, b), INK) <= distancia((r, g, b), ACENTO):
                px[x, y] = (*nova_cor, a)
    return saida


def preparar_logo() -> None:
    original = BUILD / 'logo-original.png'
    if not original.exists():
        sys.exit(f"ERRO: não achei {original}")
    conteudo = recorte_do_conteudo(Image.open(original).convert('RGBA'))
    print(f"  conteúdo do logo: {conteudo.size[0]}x{conteudo.size[1]}")

    # 600px de largura cobre tela retina 3x e impressão a 300 dpi.
    # 64 cores mantêm as bordas suaves; abaixo disso o contorno serrilha.
    largura = 600
    altura = round(largura * conteudo.size[1] / conteudo.size[0])
    logo = conteudo.resize((largura, altura), Image.LANCZOS)
    logo.quantize(colors=64, method=Image.FASTOCTREE).save(
        BUILD / 'logo.png', optimize=True)
    print(f"  logo.png: {largura}x{altura}  "
          f"{(BUILD / 'logo.png').stat().st_size/1024:.1f} KB")

    # Ícone: fundo azul-marinho com o logo em branco lê melhor que o
    # contrário quando fica do tamanho de um ícone na tela de início.
    branco = recolorir(conteudo, BRANCO)
    for lado in (180, 512):
        icone = Image.new('RGB', (lado, lado), INK)
        larg = int(lado * 0.86)
        alt = round(larg * conteudo.size[1] / conteudo.size[0])
        r = branco.resize((larg, alt), Image.LANCZOS)
        icone.paste(r, ((lado - larg) // 2, (lado - alt) // 2), r)
        destino = RAIZ / f'icone-{lado}.png'
        icone.save(destino, optimize=True)
        print(f"  icone-{lado}.png: {destino.stat().st_size/1024:.1f} KB")


if __name__ == '__main__':
    print("== Fontes ==")
    preparar_fontes()
    print("== Logo e ícones ==")
    preparar_logo()
    print("\nPronto. Agora rode: python3 build/gerar.py")
