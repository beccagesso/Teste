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
sem sinal.

## Enviar o orçamento

O botão **Enviar pelo WhatsApp** monta o PDF e abre a tela de compartilhamento
do iPhone com o arquivo pronto — é só escolher o WhatsApp e o contato. O mesmo
menu serve para salvar em Arquivos ou mandar por e-mail.

Se o aparelho não souber compartilhar arquivos, o app baixa o PDF e abre o
WhatsApp com um resumo em texto, para você anexar o arquivo na conversa.

O botão **Imprimir** continua ali para imprimir em papel ou salvar o PDF pela
impressão do próprio navegador.

## O que o app faz sozinho

- **Guarda todos os orçamentos.** Cada um é salvo enquanto você digita, e o
  botão **Histórico** mostra a lista completa.
- **Numera em sequência**: 0001/2026, 0002/2026, e assim por diante. A contagem
  recomeça do 0001 a cada ano.
- **Calcula o pagamento**: cartão em até 5x sem juros e à vista com 6% de
  desconto.
- **Calcula a validade**: 15 dias a partir da data do orçamento.
- **Monta o PDF sozinho**, com as fontes e o logo da marca, e quebra em várias
  páginas quando o orçamento é longo — repetindo o cabeçalho da empresa em
  cada folha.

O botão **Novo** começa outro orçamento — o anterior não se perde, fica no
histórico. O botão **↻** ao lado do número pula para o próximo número sem
apagar o resto.

### Histórico

O botão **Histórico** abre a lista de tudo que você já orçou, do mais recente
para o mais antigo, com busca por nome do cliente, número ou endereço. Em cada
orçamento você pode:

- **Abrir** — carrega de volta para editar, mantendo o número original.
- **Duplicar** — cria uma cópia com número novo, útil para um serviço parecido.
- **Excluir** — apaga de vez (pergunta antes).

Um orçamento entra na lista assim que tem nome de cliente ou algum serviço
preenchido, então não fica lixo de tela em branco guardado.

### Unidade de medida

Cada serviço tem a sua unidade: **m²** (metro quadrado), **m.l.** (metro
linear) ou **un.** (unidade). Ela aparece junto da quantidade no orçamento —
"38,5 m²" em vez de só "38,5". O padrão é m².

> Os dados ficam guardados **dentro do aparelho**, não em um servidor. Se você
> usar o app no iPhone e no computador, cada um terá o seu próprio histórico e
> a sua própria numeração.

## Arquivos do projeto

| Arquivo | Para que serve |
|---|---|
| `index.html` | O app inteiro num arquivo só. É o que abre no navegador. |
| `manifest.json` | Diz ao iPhone o nome, o ícone e as cores do app. |
| `sw.js` | Faz o app funcionar sem internet. |
| `icone-180.png`, `icone-512.png` | Ícones da tela de início. |
| `build/` | Os arquivos de origem usados para montar o `index.html`. |
| `build/pdf.js` | O gerador de PDF, escrito à mão para não depender de biblioteca. |
| `gerador-orcamento-becca-gesso.html` | A versão original, guardada para consulta. |

O `index.html` **não é editado à mão** — ele é montado a partir do
`build/template.html`. Se editar direto no `index.html`, a mudança se perde na
próxima vez que o arquivo for gerado.

## O fecho do documento

O orçamento não tem área de assinatura: é uma proposta, não um contrato. Ele
fecha com os dados da Becca Gesso — nome, CNPJ, telefone e e-mail — e a nota de
validade de 15 dias.

## Como alterar o app

As mudanças do dia a dia ficam todas no `build/template.html`:

- **Preço, desconto, parcelas e validade**: no início do bloco `<script>`, nas
  linhas `VALIDADE_DIAS`, `PARCELAS` e `DESCONTO_AVISTA`.
- **Telefone, e-mail, CNPJ**: aparecem em três lugares — no bloco
  `brand-strip` (cabeçalho do editor), no `doc-head` (topo do documento) e no
  `fecho` (rodapé do documento). Mude nos três.
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

O PDF é montado dentro do navegador, por `build/pdf.js`, sem biblioteca
externa. Isso é o que permite mandar o arquivo pelo WhatsApp: o
compartilhamento do iPhone precisa de um arquivo, e a impressão do navegador
não devolve nenhum. As fontes vão embutidas no PDF, então o documento sai igual
em qualquer aparelho, e o texto pode ser copiado e buscado.

Se você trocar o logo, ou usar um caractere que não estava previsto, rode os
dois scripts nesta ordem:

```bash
python3 build/preparar-ativos.py    # fontes da tela, logo e ícones
python3 build/preparar-pdf.py       # fontes e logo do PDF
python3 build/gerar.py              # monta o index.html
```

O `preparar-pdf.py` confere se as fontes cobrem todos os caracteres do
orçamento e para com erro se faltar algum — foi assim que apareceu o caso do
`²` de m², que sumia do PDF sem avisar.

Há uma bateria de testes automatizados em `build/testar.js`, que confere os
cálculos, o salvamento, o layout de impressão em A4, o comportamento no iPhone
e o funcionamento sem internet:

```bash
npm install playwright
node build/testar.js
node build/testar-historico.js
node build/testar-pdf.js
node build/testar-subcaminho.js
```

O segundo confere o que o GitHub Pages faz na prática: servir o app em
`/Teste/` em vez da raiz do endereço, o que quebraria o ícone e o modo offline
se algum caminho estivesse escrito de forma absoluta.
