# Gerador de Orçamentos — Becca Gesso

Aplicativo da Becca Gesso. Funciona no navegador, instala na tela de início do
iPhone e continua funcionando sem internet.

O app tem quatro seções, trocadas pelos botões abaixo do cabeçalho:

- **Início** — o resumo do mês: quanto foi orçado, o que está aprovado, o
  que vence agora e quem está esperando resposta.
- **Orçamentos** — montar, imprimir e mandar orçamento pelo WhatsApp.
- **Contas a pagar** — o que a empresa deve, com vencimento e situação.
- **Clientes** — quem já foi atendido: nome, telefone, endereço e o
  histórico de orçamentos de cada um.

Ele abre no início e, depois, sempre na última seção que você usou.

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

## Nuvem (Supabase)

Os orçamentos e as contas ficam guardados fora do celular e aparecem em
qualquer lugar onde você entrar — o celular na obra e o computador em casa
vendo a mesma coisa. **O app já sai pronto**, ligado ao projeto da Becca
Gesso: não precisa colar endereço nem chave em lugar nenhum. Quem abrir o
link já cai direto na tela de entrar com e-mail e senha, e quem já entrou
antes num aparelho cai direto nos dados salvos.

O app **continua funcionando sem internet**. O celular segue sendo a fonte
imediata: você lança normalmente na obra sem sinal, e o que foi lançado sobe
quando a internet volta. A nuvem entra ao lado, não no lugar.

### O que já está pronto

O projeto no Supabase já tem as tabelas criadas, as regras de acesso ligadas
(`build/supabase.sql`, rodado uma vez) e o seu usuário cadastrado em
**Authentication → Users**. Não sobra nenhum passo manual — nem para você,
nem para quem for usar o app depois.

### Usar em outro projeto do Supabase (avançado)

Isto só é preciso se um dia você quiser trocar de projeto. Em
**Histórico → Nuvem**, cole o endereço e a chave pública do novo projeto
(ficam em **Project Settings → API** — pode colar os blocos inteiros, o app
acha o que interessa) e toque em **Salvar e conectar**. Feche e abra o app
para entrar com o e-mail e a senha desse projeto.

**Desligar** tira a nuvem deste aparelho específico (por exemplo, para usar
o app totalmente offline nele). **Ligar de novo** volta para o projeto da
Becca Gesso, sem precisar colar nada de novo.

### Por que a senha passou a importar

O app fica num endereço público, e a chave que ele carrega pode ser lida por
qualquer um que abra o código da página. Isso é normal e é assim que o
Supabase foi feito para funcionar — **desde que as regras de acesso estejam
ligadas**, que é o que o `build/supabase.sql` faz. Com elas, a chave sozinha
não mostra nem grava nada: só depois de entrar com e-mail e senha o banco
passa a enxergar as suas linhas.

Por isso a tranca deixou de ser decorativa. Antes ela só escondia a tela de
quem pegasse o celular destravado. Agora é ela que separa os seus dados do
resto do mundo.

> Se você rodar o app sem ter rodado o SQL, o próprio app avisa que as
> tabelas não existem.

### Sem internet

- **Já entrou alguma vez neste aparelho:** o app abre e você entra com a
  mesma senha. Ele guarda o embaralhamento dela aqui justamente para isso.
- **Aparelho novo que nunca entrou:** aí não dá, e o app explica. A primeira
  entrada precisa de internet.

O aviso no alto da tela diz em que pé está: *Tudo salvo na nuvem*,
*N itens para subir*, *Sem internet* ou *Nuvem com problema*. Tocar nele abre
a tela da nuvem.

### Quando os dois aparelhos mexeram na mesma coisa

Vence a alteração mais recente — a mesma regra do backup em arquivo. Isso vale
dos dois lados: o aparelho que sincroniza por último não ganha por isso, e o
banco recusa uma versão mais velha que chegue atrasada.

Excluir também atravessa: um orçamento apagado no celular some do computador
na sincronização seguinte, e não volta.

## Senha de acesso

No pé do histórico, o botão **Senha** define um usuário e uma senha. A partir
daí o app pede os dois ao abrir.

**Do que ela protege:** de quem pega o seu iPhone destravado e abre o app. Num
app instalado na tela de início não existe "ver código-fonte" nem inspetor,
então a tranca funciona de verdade nesse caso.

**Do que ela não protege:** de quem liga o iPhone a um computador com as
ferramentas de desenvolvedor. Também não substitui a senha do próprio iPhone —
com o celular travado, ninguém chega ao app de qualquer forma.

**O endereço do app é público, mas isso não expõe nada seu:** os orçamentos
ficam guardados dentro do aparelho, não em servidor. Quem abrir o endereço em
outro celular vê um app vazio.

A senha **não fica guardada em texto**. O que fica é o resultado de um PBKDF2
com 250 mil voltas e um sal sorteado, do qual não dá para voltar à senha
original.

Depois de entrar, o app fica liberado por **30 minutos** de uso. Passado esse
tempo, ou ao fechar e abrir o app, ele pede a senha de novo.

> **Se você esquecer a senha, não há como recuperá-la.** A saída seria
> reinstalar o app, o que apaga os orçamentos do aparelho. Por isso, com senha
> definida, o backup deixa de ser opcional.

O botão **Tirar a senha** remove a tranca (pedindo a senha atual antes) e não
apaga nenhum orçamento.

## O que o app faz sozinho

- **Guarda todos os orçamentos.** Cada um é salvo enquanto você digita, e o
  botão **Histórico** mostra a lista completa.
- **Numera em sequência**: 0001/2026, 0002/2026, e assim por diante. A contagem
  recomeça do 0001 a cada ano.
- **Calcula o pagamento**: cartão sem juros e à vista com desconto, nas
  condições que você escolher (5x e 6% vêm predefinidos).
- **Calcula a validade** a partir da data do orçamento.
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

### Situação de cada orçamento

Cada um pode ser marcado como **rascunho**, **enviado**, **aprovado** ou
**recusado**. Mandar pelo WhatsApp já marca como enviado sozinho — e um
orçamento já aprovado não volta para enviado se você mandar de novo.

Os quatro quadrinhos no topo do histórico mostram quantos e quanto em cada
situação, e servem de filtro: toque em **Aprovado** para ver só os aprovados,
toque de novo para ver todos. É por ali que você acompanha quanto mandou no
mês e quanto fechou.

### Dar retorno ao cliente

Se você preencher o **WhatsApp do cliente** no orçamento, o histórico passa a
mostrar um bloco **Para dar retorno** no topo, com os orçamentos enviados que
já pedem uma cobrança: **1 dia**, **5 dias** e **10 dias** depois do envio.

O botão **Mandar mensagem** abre direto a conversa daquele cliente no WhatsApp,
com um texto já escrito — diferente em cada etapa: no primeiro dia pergunta se
ele conseguiu ver, no quinto se ficou dúvida, no décimo lembra da validade (ou
oferece atualizar os valores, se já venceu).

Depois de mandar, o orçamento sai da lista até a próxima etapa. Aprovado ou
recusado sai de vez — só o que está **enviado** é cobrado.

> **O app não avisa sozinho.** Um app web no iPhone precisaria de um servidor
> para disparar aviso no dia certo, e este não tem nenhum — é o que o mantém
> gratuito e funcionando sem internet. A lista aparece quando você abre o
> histórico, funcionando como uma lista de cobrança, não como um despertador.

O telefone também é sugerido junto com o nome e o endereço quando o cliente já
está no histórico.

#### Escrever as mensagens do seu jeito

No pé do histórico, o botão **Mensagens** abre os quatro textos — 1 dia, 5
dias, 10 dias e "já venceu" — para você editar. Onde você puser um destes
marcadores, o app troca pelos dados do orçamento:

| Marcador | Vira |
|---|---|
| `{cliente}` | nome do cliente como você digitou |
| `{primeiro}` | só o primeiro nome |
| `{numero}` | número do orçamento |
| `{valor}` | valor total |
| `{validade}` | data até quando o orçamento vale |

**Voltar ao padrão** devolve os textos originais. Um texto apagado volta ao
padrão sozinho, para nunca sair uma mensagem em branco. Os textos vão junto no
backup.

### Backup

No pé do histórico, **Fazer backup** gera um arquivo com todos os orçamentos,
as contas a pagar, as mensagens e a numeração, e abre a mesma tela de
compartilhamento do orçamento — dá para mandar para um grupo do WhatsApp e
deixar guardado lá.

**Restaurar** lê esse arquivo de volta. Ele **junta** com o que já existe em
vez de trocar tudo: orçamento que só está neste aparelho não se perde, e entre
duas versões do mesmo número fica a mais recente. A numeração acompanha o maior
número restaurado, para não repetir.

> Vale fazer backup de vez em quando. Sem ele, trocar de celular ou limpar os
> dados do Safari apaga o histórico inteiro.

### Condições de pagamento

Parcelas, desconto à vista e validade vêm com **5x**, **6%** e **15 dias**, e
podem ser mudados em cada orçamento. Há também um campo de desconto em reais,
que aparece como uma linha entre o subtotal e o total — quando fica vazio, a
linha não existe.

Cada orçamento guarda as condições que tinha, então reabrir um antigo traz as
condições daquele orçamento, não as de hoje.

### Cliente já atendido

O campo de cliente do orçamento é uma busca: ao digitar, aparecem os clientes
já cadastrados (nome e telefone) para escolher, com a opção **+ Novo
cliente** para cadastrar sem sair do orçamento. Ao escolher um cliente, o
telefone e o endereço vêm junto — mas só preenchem o que estiver vazio, para
nunca apagar o que você já tinha digitado para aquele orçamento específico.

Cada cliente também tem sua própria seção (**Clientes**, no menu), com busca
por nome, telefone ou documento, e o histórico de orçamentos de cada um. Veja
mais em [Clientes](#clientes).

### Unidade de medida

Cada serviço tem a sua unidade: **m²** (metro quadrado), **m.l.** (metro
linear) ou **un.** (unidade). Ela aparece junto da quantidade no orçamento —
"38,5 m²" em vez de só "38,5". O padrão é m².

> Os dados ficam guardados dentro do aparelho. Com a nuvem ligada (é o
> padrão — veja [Nuvem](#nuvem-supabase)), eles também aparecem em qualquer
> outro aparelho onde você entrar com o mesmo e-mail e senha.

## A tela de início

A primeira coisa que aparece ao abrir o app é um resumo pessoal do mês. Ela
não guarda nada próprio: é tudo lido dos orçamentos e das contas na hora de
mostrar.

No topo, uma saudação que muda com a hora do dia (Bom dia / Boa tarde / Boa
noite) e a data por extenso.

### O cartão de destaque

Logo abaixo vem o total orçado no mês, em destaque. Quando há orçamento no
mês anterior para comparar, aparece a variação — "↑ 18% que julho" em verde
numa alta, "↓ 12% que julho" em vermelho numa queda. Sem mês anterior para
comparar, o cartão não inventa uma tendência, só mostra o total.

Por baixo do número, uma linha fina traça os últimos 6 meses de orçamento,
para dar de imediato uma ideia de para onde o negócio está indo.

### Os outros cinco números

Logo abaixo do cartão de destaque, dois indicadores dos orçamentos:

- **Aprovados** — o que já virou serviço neste mês.
- **Aguardando** — tudo que está marcado como enviado e ainda não teve
  resposta, de qualquer mês. Um orçamento de abril que ninguém respondeu
  continua contando aqui.

E três das contas a pagar:

- **Vencidas** — o que já passou do prazo.
- **Vence em 7 dias** — o que vence de hoje até daqui a uma semana. O que já
  venceu não aparece de novo aqui: fica só em "vencidas".
- **Pagas no mês** — quanto já saiu neste mês.

Cada indicador é um atalho: tocar em **Vencidas** abre as contas já
filtradas pelas vencidas, tocar em **Aprovados** abre o histórico filtrado
pelos aprovados. Abaixo de cada grupo, uma linha traz o total do ano (nos
orçamentos) e o total em aberto (nas contas).

### As três listas

- **Vencendo agora** — o que já venceu ou vence dentro de sete dias, da mais
  atrasada para a mais distante, cada uma com um ícone que muda de cor
  conforme a urgência e um botão redondo para marcar paga sem sair da tela.
  Mostra até cinco e avisa quantas ficaram de fora.
- **Para dar retorno** — os orçamentos enviados que já passaram de 1, 5 ou 10
  dias sem resposta, cada cliente com um círculo com as iniciais do nome (a
  razão social não conta — "Construtora Alvorada Ltda" vira **CA**, não
  **CL**) e o botão verde que abre a conversa no WhatsApp.
- **Últimos orçamentos** — os cinco mais recentes, cada um com uma bolinha
  colorida conforme a situação; tocar em qualquer um já abre para editar.

No pé fica **Histórico, backup e ajustes**, que é por onde se chega ao
backup, às mensagens de retorno e à senha de acesso.

> A tela de início não vai para o papel: imprimir continua saindo só com o
> orçamento.

## Contas a pagar

A segunda seção do app é o controle do que a empresa tem a pagar: material,
aluguel, ajudante, combustível, imposto. Fica no mesmo aparelho e no mesmo
backup dos orçamentos.

### Lançar uma conta

O formulário da esquerda pede **descrição**, **valor** e **vencimento** — só
esses três são obrigatórios. **Fornecedor**, **categoria** e **observação**
são opcionais. O campo de fornecedor sugere os que você já usou antes, então
não precisa digitar "Gessos Bauru" de novo toda vez.

O valor aceita vírgula do jeito que o teclado do iPhone escreve: `1.480,50`.

### Como o app mostra a situação

Cada conta ganha uma tarja e uma cor conforme o vencimento:

| Situação | Quando | Cor |
|---|---|---|
| **Vencida** | o vencimento já passou | vermelho |
| **Vence hoje** | vence hoje | dourado |
| **A vencer** | ainda vai vencer | cinza |
| **Paga** | você marcou como paga | verde |

Uma conta que vence hoje **não** entra como vencida — só no dia seguinte. As
contas em aberto ficam no topo da lista, da mais próxima de vencer para a mais
distante, e as pagas descem para o fim.

### Os três totais do topo

- **Vencidas** — quanto está atrasado.
- **A vencer** — quanto ainda vai vencer.
- **Pagas no mês** — quanto já saiu neste mês.

Cada um é também um filtro: toque para ver só aquelas contas, toque de novo
para ver todas. A busca ao lado procura por descrição, fornecedor, categoria
ou observação.

### Os botões de cada conta

- **Marcar paga** — registra o pagamento com a data de hoje. **Desfazer**
  volta atrás.
- **Editar** — abre a conta no formulário. **Cancelar edição** desiste sem
  mudar nada.
- **Próximo mês** — cria a mesma conta com vencimento no mês seguinte, para
  aluguel, internet e contador, que voltam sempre. Uma conta do dia 31 cai no
  último dia do mês seguinte, nunca no mês errado, e o app avisa em vez de
  duplicar se a conta do próximo mês já existir.
- **Excluir** — apaga de vez (pergunta antes).

> As contas entram no backup junto com os orçamentos, com a mesma regra: o
> arquivo **junta** com o que já existe, e entre duas versões da mesma conta
> fica a que foi mexida por último.

## Clientes

A terceira seção é o cadastro de clientes: nome, telefone, e-mail, CPF/CNPJ,
endereço, cidade e bairro. Cada cliente mostra também há quantos orçamentos
ele tem e qual foi o último.

- **Buscar** — a caixa no topo procura por nome, telefone ou documento.
- **+ Novo cliente** — abre um cadastro em branco. Só o nome é obrigatório;
  o resto pode ser preenchido depois.
- **Abrir** — mostra os dados do cliente (já editáveis) e a lista dos
  orçamentos dele.
- **Desativar** — some da busca e das sugestões, mas não apaga nada: os
  orçamentos que já apontam para aquele cliente continuam intactos.

Alterar o endereço ou o telefone de um cliente **não muda** os orçamentos já
emitidos para ele — cada orçamento guarda a sua própria cópia desses dados,
tirada no momento em que foi salvo, exatamente para o documento que o
cliente recebeu nunca mudar sozinho depois.

## Arquivos do projeto

| Arquivo | Para que serve |
|---|---|
| `index.html` | A casca do app (HTML e estilo) — o que abre no navegador. |
| `src/` | A lógica do app, em módulos JavaScript comuns (sem framework). |
| `manifest.json` | Diz ao iPhone o nome, o ícone e as cores do app. |
| `sw.js` | Faz o app funcionar sem internet — guarda `index.html` e todo `src/`. |
| `icone-180.png`, `icone-512.png` | Ícones da tela de início. |
| `build/` | Os arquivos de origem usados para montar o `index.html`. |
| `build/pdf.js` | O gerador de PDF, escrito à mão para não depender de biblioteca. |
| `build/supabase.sql` | As tabelas e as regras de acesso. Rode uma vez no Supabase. |
| `build/falso-supabase.js` | Um Supabase de mentira, usado só pelos testes. |
| `gerador-orcamento-becca-gesso.html` | A versão original, guardada para consulta. |

O `index.html` **não é editado à mão** — ele é montado a partir do
`build/template.html` (fontes, logo e o gerador de PDF entram embutidos). Se
editar direto no `index.html`, a mudança se perde na próxima vez que o
arquivo for gerado. Já os arquivos dentro de `src/` são editados direto: eles
são carregados pelo navegador tal como estão, sem passar pelo `gerar.py`.

### Como o `src/` é organizado

```
src/
├── core/          armazenamento, nuvem, sincronização, dinheiro, datas, ids
├── domain/        cliente, fornecedor, categoria, orçamento, conta
├── calculations/  as contas de um orçamento e os resumos financeiros
├── ui/            a tela de Clientes e a busca de cliente do orçamento
└── app.js         liga tudo isso à tela — início, orçamentos e contas
```

`app.js` ainda concentra o desenho das telas de Início, Orçamentos e Contas a
pagar (o que existia antes desta etapa); só a Etapa seguinte deve terminar de
separar cada uma no seu próprio arquivo dentro de `ui/`.

## O fecho do documento

O orçamento não tem área de assinatura: é uma proposta, não um contrato. Ele
fecha com os dados da Becca Gesso — nome, CNPJ, telefone e e-mail — e a nota de
validade.

## Como alterar o app

As mudanças do dia a dia ficam todas no `build/template.html`:

- **Padrão de parcelas, desconto e validade**: no início do bloco `<script>`,
  no bloco `PADRAO`. São só os valores iniciais — cada orçamento pode ter os
  seus.
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
externa. O logo entra como imagem de paleta comprimida com **Flate** — a
compressão que todo leitor de PDF entende. RunLengthDecode, que parecia mais
simples, nem sempre é implementada: o leitor do iPhone descartava a imagem
inteira e o logo sumia do orçamento, sem erro nenhum. Isso é o que permite mandar o arquivo pelo WhatsApp: o
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
node build/testar-backup.js
node build/testar-retorno.js
node build/testar-acesso.js
node build/testar-contas.js
node build/testar-inicio.js
node build/testar-nuvem.js
node build/testar-subcaminho.js
node build/testar-clientes.js
```

O `testar-nuvem.js` roda contra um Supabase de mentira (`build/falso-supabase.js`),
que imita o login, a leitura, a gravação e as regras de acesso. Assim os
testes de sincronia rodam sem chave de verdade e sem tocar no projeto real.

O `testar-subcaminho.js` confere o que o GitHub Pages faz na prática: servir o app em
`/Teste/` em vez da raiz do endereço, o que quebraria o ícone e o modo offline
se algum caminho estivesse escrito de forma absoluta.
