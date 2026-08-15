-- ---------------------------------------------------------------------
-- Banco da Becca Gesso no Supabase
--
-- Rode este arquivo UMA VEZ, no painel do Supabase:
--   SQL Editor  ->  New query  ->  cole tudo  ->  Run
--
-- Ele pode ser rodado de novo sem estragar nada: tudo aqui é
-- "se não existir, crie".
--
-- Etapa 2 (Becca OS): além de orçamentos e contas, entraram clientes,
-- fornecedores e categorias financeiras. São tabelas novas, no mesmo
-- padrão das duas primeiras — nada nas duas antigas mudou.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- 1. As tabelas
--
-- O conteúdo de cada registro fica em `dados`, um campo JSON. É de
-- propósito: o app muda de campo com o tempo (unidade de medida,
-- situação, retornos, e agora nome/telefone/endereço de cliente...), e
-- assim uma novidade no app não obriga a mexer no banco. As colunas de
-- fora são só as que o banco precisa para saber de quem é, o que é
-- mais novo e o que foi apagado.
-- ---------------------------------------------------------------------

create table if not exists public.orcamentos (
  id             uuid primary key default gen_random_uuid(),
  dono           uuid not null references auth.users(id) on delete cascade
                 default auth.uid(),

  -- o número do orçamento (0001/2026). É o que identifica o orçamento
  -- para o app, e não pode repetir dentro da mesma conta.
  numero         text not null,

  dados          jsonb not null,

  -- relógio do APARELHO que gravou. Serve para decidir quem vence
  -- quando o mesmo orçamento foi mexido em dois lugares.
  atualizado_em  bigint not null,

  -- relógio do SERVIDOR. Serve para o aparelho saber o que chegou
  -- depois da última vez que ele baixou. Os dois relógios são
  -- necessários: o do aparelho pode estar errado, e o do servidor não
  -- sabe qual das duas versões é a mais recente para o usuário.
  gravado_em     timestamptz not null default now(),

  -- apagar de verdade faria o registro voltar do outro aparelho na
  -- sincronização seguinte; então some marcado, não sumindo.
  removido       boolean not null default false,

  unique (dono, numero)
);

create table if not exists public.contas (
  id             uuid primary key default gen_random_uuid(),
  dono           uuid not null references auth.users(id) on delete cascade
                 default auth.uid(),

  -- o identificador que o próprio app gera ("conta_…"). Mesmo papel do
  -- número do orçamento.
  chave          text not null,

  dados          jsonb not null,
  atualizado_em  bigint not null,
  gravado_em     timestamptz not null default now(),
  removido       boolean not null default false,

  unique (dono, chave)
);

-- Clientes, fornecedores e categorias financeiras: mesmo formato de
-- `contas` (uma `chave` gerada pelo app, um `dados` jsonb) — é o mesmo
-- papel para três cadastros novos, então a tabela é a mesma receita.

create table if not exists public.clientes (
  id             uuid primary key default gen_random_uuid(),
  dono           uuid not null references auth.users(id) on delete cascade
                 default auth.uid(),
  chave          text not null,
  dados          jsonb not null,
  atualizado_em  bigint not null,
  gravado_em     timestamptz not null default now(),
  removido       boolean not null default false,

  unique (dono, chave)
);

create table if not exists public.fornecedores (
  id             uuid primary key default gen_random_uuid(),
  dono           uuid not null references auth.users(id) on delete cascade
                 default auth.uid(),
  chave          text not null,
  dados          jsonb not null,
  atualizado_em  bigint not null,
  gravado_em     timestamptz not null default now(),
  removido       boolean not null default false,

  unique (dono, chave)
);

create table if not exists public.categorias_financeiras (
  id             uuid primary key default gen_random_uuid(),
  dono           uuid not null references auth.users(id) on delete cascade
                 default auth.uid(),
  chave          text not null,
  dados          jsonb not null,
  atualizado_em  bigint not null,
  gravado_em     timestamptz not null default now(),
  removido       boolean not null default false,

  unique (dono, chave)
);


-- ---------------------------------------------------------------------
-- 2. Índices
--
-- Toda busca do app é "o que é meu e mudou depois de tal hora".
-- ---------------------------------------------------------------------

create index if not exists orcamentos_dono_gravado
  on public.orcamentos (dono, gravado_em);

create index if not exists contas_dono_gravado
  on public.contas (dono, gravado_em);

create index if not exists clientes_dono_gravado
  on public.clientes (dono, gravado_em);

create index if not exists fornecedores_dono_gravado
  on public.fornecedores (dono, gravado_em);

create index if not exists categorias_financeiras_dono_gravado
  on public.categorias_financeiras (dono, gravado_em);


-- ---------------------------------------------------------------------
-- 3. O carimbo do servidor, e quem ganha quando os dois mexeram
--
-- Duas coisas neste gatilho:
--
-- a) `gravado_em` passa a ser sempre a hora de agora. Sem isso, uma
--    alteração manteria o carimbo antigo e o outro aparelho nunca
--    saberia que houve mudança.
--
-- b) uma versão mais VELHA não derruba uma mais nova. Sem isso, o
--    aparelho que sincronizasse por último venceria, mesmo que a
--    alteração dele fosse a mais antiga das duas — e a edição boa se
--    perderia sem ninguém notar.
--
-- A mesma função serve para as cinco tabelas: a regra não muda de uma
-- entidade para outra.
-- ---------------------------------------------------------------------

create or replace function public.marcar_gravado_em()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE' and new.atualizado_em < old.atualizado_em then
    return old;              -- o que já está aqui é mais novo: fica
  end if;
  new.gravado_em := now();
  return new;
end;
$$;

drop trigger if exists orcamentos_gravado_em on public.orcamentos;
create trigger orcamentos_gravado_em
  before insert or update on public.orcamentos
  for each row execute function public.marcar_gravado_em();

drop trigger if exists contas_gravado_em on public.contas;
create trigger contas_gravado_em
  before insert or update on public.contas
  for each row execute function public.marcar_gravado_em();

drop trigger if exists clientes_gravado_em on public.clientes;
create trigger clientes_gravado_em
  before insert or update on public.clientes
  for each row execute function public.marcar_gravado_em();

drop trigger if exists fornecedores_gravado_em on public.fornecedores;
create trigger fornecedores_gravado_em
  before insert or update on public.fornecedores
  for each row execute function public.marcar_gravado_em();

drop trigger if exists categorias_financeiras_gravado_em on public.categorias_financeiras;
create trigger categorias_financeiras_gravado_em
  before insert or update on public.categorias_financeiras
  for each row execute function public.marcar_gravado_em();


-- ---------------------------------------------------------------------
-- 4. Quem pode ver o quê  (a parte que realmente protege)
--
-- O app fica num endereço público, e a chave "anon" que ele carrega
-- pode ser lida por qualquer um que abra o código da página. Isso é
-- normal e não é problema DESDE QUE estas regras estejam ligadas: com
-- elas, a chave sozinha não mostra nem grava nada. Só depois de entrar
-- com e-mail e senha o banco passa a enxergar as linhas do dono.
--
-- Se estas linhas não rodarem, os dados de todas as cinco tabelas
-- ficam abertos para quem descobrir o endereço do site — inclusive
-- clientes, fornecedores e categorias, que são dados tão sensíveis
-- quanto os orçamentos e as contas.
-- ---------------------------------------------------------------------

alter table public.orcamentos             enable row level security;
alter table public.contas                 enable row level security;
alter table public.clientes               enable row level security;
alter table public.fornecedores           enable row level security;
alter table public.categorias_financeiras enable row level security;

drop policy if exists orcamentos_do_dono on public.orcamentos;
create policy orcamentos_do_dono
  on public.orcamentos
  for all
  to authenticated
  using      (dono = auth.uid())     -- o que ele pode enxergar
  with check (dono = auth.uid());    -- e o que ele pode gravar

drop policy if exists contas_do_dono on public.contas;
create policy contas_do_dono
  on public.contas
  for all
  to authenticated
  using      (dono = auth.uid())
  with check (dono = auth.uid());

drop policy if exists clientes_do_dono on public.clientes;
create policy clientes_do_dono
  on public.clientes
  for all
  to authenticated
  using      (dono = auth.uid())
  with check (dono = auth.uid());

drop policy if exists fornecedores_do_dono on public.fornecedores;
create policy fornecedores_do_dono
  on public.fornecedores
  for all
  to authenticated
  using      (dono = auth.uid())
  with check (dono = auth.uid());

drop policy if exists categorias_financeiras_do_dono on public.categorias_financeiras;
create policy categorias_financeiras_do_dono
  on public.categorias_financeiras
  for all
  to authenticated
  using      (dono = auth.uid())
  with check (dono = auth.uid());


-- ---------------------------------------------------------------------
-- 5. Conferência
--
-- Depois de rodar, esta consulta tem de devolver as cinco tabelas com
-- rowsecurity = true. Se vier false em alguma, as regras acima não
-- passaram e os dados dela NÃO estão protegidos.
-- ---------------------------------------------------------------------

select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
   and tablename in ('orcamentos', 'contas', 'clientes', 'fornecedores',
                      'categorias_financeiras');
