# Gerador de Orçamentos — Becca Gesso

Aplicativo de orçamentos da Becca Gesso. Funciona no navegador, instala na tela
de início do iPhone e continua funcionando sem internet.

## Colocar o app no ar (uma vez só)

O GitHub publica o app de graça, mas essa chave precisa ser ligada à mão —
nem o Actions tem permissão para ligá-la sozinho. São quatro cliques:

1. Abra <https://github.com/beccagesso/Teste/settings/pages>
2. Em **Source**, escolha **Deploy from a branch**
3. Em **Branch**, escolha `claude/becca-gesso-iphone-app-yuxcjz` e a pasta `/ (root)`
4. Clique em **Save**

Em um ou dois minutos o app fica no ar em:

**<https://beccagesso.github.io/Teste/>**

Depois disso, todo commit nesse branch atualiza o app sozinho.

## Como usar no iPhone

1. Abra o endereço do app no **Safari** (precisa ser o Safari, não o Chrome).
2. Toque no botão de compartilhar (o quadrado com a seta para cima).
3. Escolha **Adicionar à Tela de Início**.
4. Confirme. O ícone da Becca Gesso aparece junto com os outros apps.

A partir daí ele abre em tela cheia, sem a barra de endereço, e funciona mesmo
sem sinal. Para gerar o PDF, toque em **Imprimir / Salvar PDF** e depois em
**Compartilhar → Salvar em Arquivos** (ou envie direto pelo WhatsApp).

## O que o app faz sozinho

- **Salva enquanto você digita.** Se fechar sem querer, ao reabrir o orçamento
  está lá do jeito que estava.
- **Numera em sequência**: 0001/2026, 0002/2026, e assim por diante. A contagem
  recomeça do 0001 a cada ano.
- **Calcula o pagamento**: cartão em até 5x sem juros e à vista com 6% de
  desconto.
- **Calcula a validade**: 15 dias a partir da data do orçamento.

O botão **Novo** limpa tudo e já pega o próximo número. O botão **↻** ao lado do
número serve para pular para o próximo sem apagar o resto.

> Os dados ficam guardados **dentro do aparelho**, não em um servidor. Se você
> usar o app no iPhone e no computador, cada um terá a sua própria numeração.

## Arquivos do projeto

| Arquivo | Para que serve |
|---|---|
| `index.html` | O app inteiro num arquivo só. É o que abre no navegador. |
| `manifest.json` | Diz ao iPhone o nome, o ícone e as cores do app. |
| `sw.js` | Faz o app funcionar sem internet. |
| `icone-180.png`, `icone-512.png` | Ícones da tela de início. |
| `build/` | Os arquivos de origem usados para montar o `index.html`. |
| `gerador-orcamento-becca-gesso.html` | A versão original, guardada para consulta. |

O `index.html` **não é editado à mão** — ele é montado a partir do
`build/template.html`. Se editar direto no `index.html`, a mudança se perde na
próxima vez que o arquivo for gerado.

## Como alterar o app

As mudanças do dia a dia ficam todas no `build/template.html`:

- **Preço, desconto, parcelas e validade**: no início do bloco `<script>`, nas
  linhas `VALIDADE_DIAS`, `PARCELAS` e `DESCONTO_AVISTA`.
- **Telefone, e-mail, CNPJ**: aparecem duas vezes no arquivo — uma no bloco
  `brand-strip` (o cabeçalho do editor) e outra no bloco `doc-head` (o
  documento em si).
- **Cores**: no começo do `<style>`, no bloco `:root`.

Depois de editar, monte o arquivo final:

```bash
python3 build/gerar.py
```

Isso regrava o `index.html` com as fontes e o logo embutidos.

### Ao publicar uma versão nova

Abra o `sw.js` e mude o número da versão:

```js
const VERSAO = 'becca-orcamentos-v1';   // troque para v2, v3...
```

Sem isso o iPhone continua usando a versão antiga que já tinha guardado.

## Detalhes técnicos

O `index.html` não depende de nada externo: as três fontes (Space Grotesk, IBM
Plex Mono e Inter) e o logo estão embutidos no próprio arquivo. As fontes foram
reduzidas apenas aos caracteres usados em português, o que derrubou 568 KB para
41 KB sem mudar nada na aparência.

Para regenerar as fontes ou reprocessar o logo a partir do original, use
`python3 build/preparar-ativos.py`. Isso só é necessário se você trocar o logo
ou usar um caractere que não estava previsto.

Há uma bateria de testes automatizados em `build/testar.js`, que confere os
cálculos, o salvamento, o layout de impressão em A4, o comportamento no iPhone
e o funcionamento sem internet:

```bash
npm install playwright
node build/testar.js
```
