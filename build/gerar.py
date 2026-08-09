#!/usr/bin/env python3
"""Monta o index.html embutindo fontes e logo dentro do template.

Uso:  python3 build/gerar.py

Gera o index.html na raiz do projeto: um arquivo único, sem nenhuma
dependência externa, que funciona offline e aberto direto do disco.
"""
import base64
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
BUILD = RAIZ / 'build'
FONTES = BUILD / 'fontes'

# nome da família, arquivo, faixa de pesos (fonte variável) ou peso único
PACOTE_FONTES = [
    ('Inter',         'inter.woff2',             '400 700'),
    ('Space Grotesk', 'space-grotesk.woff2',     '400 700'),
    ('IBM Plex Mono', 'ibm-plex-mono-400.woff2', '400'),
    ('IBM Plex Mono', 'ibm-plex-mono-600.woff2', '600'),
]


def b64(caminho: Path) -> str:
    return base64.b64encode(caminho.read_bytes()).decode('ascii')


def css_das_fontes() -> str:
    regras = []
    for familia, arquivo, peso in PACOTE_FONTES:
        origem = FONTES / arquivo
        if not origem.exists():
            sys.exit(f"ERRO: fonte não encontrada: {origem}")
        regras.append(
            f"  @font-face{{font-family:'{familia}';font-style:normal;"
            f"font-weight:{peso};font-display:swap;"
            f"src:url(data:font/woff2;base64,{b64(origem)}) format('woff2');}}"
        )
    return "\n".join(regras)


def main() -> None:
    template = BUILD / 'template.html'
    logo = BUILD / 'logo.png'
    for obrigatorio in (template, logo):
        if not obrigatorio.exists():
            sys.exit(f"ERRO: arquivo não encontrado: {obrigatorio}")

    html = template.read_text(encoding='utf-8')

    for marcador in ('/*__FONTES__*/', '__LOGO_B64__'):
        if marcador not in html:
            sys.exit(f"ERRO: marcador {marcador} sumiu do template.")

    html = html.replace('/*__FONTES__*/', css_das_fontes())
    html = html.replace('__LOGO_B64__',
                        'data:image/png;base64,' + b64(logo))

    destino = RAIZ / 'index.html'
    destino.write_text(html, encoding='utf-8')

    tam = destino.stat().st_size
    print(f"index.html gerado: {tam/1024:.1f} KB")
    print(f"  fontes embutidas: {len(PACOTE_FONTES)} arquivos")
    print(f"  logo embutido:    {logo.stat().st_size/1024:.1f} KB")


if __name__ == '__main__':
    main()
