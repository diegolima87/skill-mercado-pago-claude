-- Mercado Pago — esquema base (Postgres / Supabase)
-- Adapte nomes de tabela/coluna ao seu domínio. Leia references/09-banco-de-dados.md.
--
-- Pressupõe uma tabela `accounts` (a "conta" que paga) e uma função
-- `is_account_member(uuid)` que diz se auth.uid() pertence à conta.
-- Se você não usa multi-conta, troque account_id por user_id.

-- ---------------------------------------------------------------------------
-- Estado do plano na conta
-- ---------------------------------------------------------------------------
alter table public.accounts
  add column if not exists trial_termina_em timestamptz,      -- sem default de propósito: quem cria a conta seta
  add column if not exists plano_isento boolean not null default false;

-- ---------------------------------------------------------------------------
-- Pagamentos únicos (Pix / cartão / Checkout Pro)
-- Crie a linha ANTES de chamar o Mercado Pago: o id vira external_reference
-- e X-Idempotency-Key.
-- ---------------------------------------------------------------------------
create table if not exists public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  item_id uuid not null,                               -- o que está sendo comprado (curso, pedido...)
  valor numeric(14,2) not null check (valor >= 0),     -- calculado no SERVIDOR
  status text not null default 'pendente'
    check (status in ('pendente', 'aprovado', 'rejeitado', 'cancelado')),
  mp_payment_id text unique,
  metodo text,                                         -- 'pix' | 'card' | 'checkout_pro'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uma tentativa pendente por usuário/item: dá idempotência de clique no banco.
create unique index if not exists pagamentos_pendente_uniq
  on public.pagamentos (user_id, item_id) where status = 'pendente';

alter table public.pagamentos enable row level security;
create policy "dono le" on public.pagamentos for select using (user_id = auth.uid());
-- Sem policy de insert/update/delete: só service role (rotas de API e webhook) escreve.

-- ---------------------------------------------------------------------------
-- Assinaturas (preapproval)
-- ---------------------------------------------------------------------------
create table if not exists public.assinaturas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.accounts(id) on delete cascade,
  tier text,                                           -- plano escolhido (chave do catálogo)
  mp_preapproval_id text unique,
  mp_preapproval_plan_id text,
  mp_payer_email text,
  status text not null default 'pendente'
    check (status in ('pendente', 'autorizada', 'pausada', 'inadimplente', 'cancelada')),
  valor numeric(14,2) not null default 0,
  moeda text not null default 'BRL',
  -- Fonte da verdade do acesso: enquanto now() < periodo_fim a conta funciona,
  -- mesmo com status = 'cancelada' (o período já foi pago).
  periodo_fim timestamptz,
  proxima_cobranca_em timestamptz,
  ultimo_pagamento_em timestamptz,
  cancelada_em timestamptz,
  prazo_final_acesso timestamptz,                      -- fim da carência em inadimplência
  mp_atualizado_em timestamptz,                        -- last_modified já aplicado (comparar por epoch)
  criado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.assinaturas enable row level security;
create policy "membros leem" on public.assinaturas for select
  using (public.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- Trilha + lock de processamento dos webhooks
-- ---------------------------------------------------------------------------
create table if not exists public.mercadopago_eventos (
  id uuid primary key default gen_random_uuid(),
  topico text not null,
  action text,
  resource_id text not null,
  x_request_id text,
  assinatura_valida boolean not null default true,
  payload jsonb,
  status text not null default 'recebido'
    check (status in ('recebido', 'processado', 'erro')),
  erro text,
  processado_em timestamptz,
  created_at timestamptz not null default now()
);

-- Lock de PROCESSAMENTO, não de histórico: só um evento "em andamento" por recurso.
-- NÃO cubra 'processado' aqui: o mesmo resource_id muda de estado várias vezes
-- (authorized -> cancelled) e o 2º evento seria descartado.
create unique index if not exists mercadopago_eventos_claim_uniq
  on public.mercadopago_eventos (topico, resource_id) where status = 'recebido';

create index if not exists mercadopago_eventos_resource_idx
  on public.mercadopago_eventos (topico, resource_id);

alter table public.mercadopago_eventos enable row level security;
-- Sem policies: nenhum cliente lê/escreve. Só service role.

-- ---------------------------------------------------------------------------
-- O portão de acesso (vive no banco, não só na UI)
-- ---------------------------------------------------------------------------
create or replace function public.is_account_active(target_account uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.accounts a
    left join public.assinaturas s on s.account_id = a.id
    where a.id = target_account
      and (
        a.plano_isento
        or coalesce(a.trial_termina_em, 'epoch'::timestamptz) > now()
        or (s.id is not null and (
              s.status = 'autorizada'
              or coalesce(s.periodo_fim, 'epoch'::timestamptz) > now()))
      )
  );
$$;

-- Exemplo de aplicação em uma tabela de negócio (repita por tabela).
-- Três policies RESTRICTIVE separadas: `for all` restringiria o SELECT também.
-- Antes de ligar o portão, marque as contas existentes: update accounts set plano_isento = true;
--
-- create policy "plano ativo para inserir" on public.minha_tabela
--   as restrictive for insert with check (public.is_account_active(account_id));
-- create policy "plano ativo para atualizar" on public.minha_tabela
--   as restrictive for update using (public.is_account_active(account_id))
--                          with check (public.is_account_active(account_id));
-- create policy "plano ativo para excluir" on public.minha_tabela
--   as restrictive for delete using (public.is_account_active(account_id));

-- ---------------------------------------------------------------------------
-- Marketplace (OAuth) — só se for cobrar em nome de terceiros
-- ---------------------------------------------------------------------------
create table if not exists public.mp_oauth_states (
  state text primary key,                              -- crypto.randomUUID()
  empresa_id uuid not null,
  usuario_id uuid not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table public.mp_oauth_states enable row level security;   -- sem policies: só service role

create table if not exists public.mercadopago_conexoes (
  empresa_id uuid primary key,
  mp_user_id text unique not null,                     -- chave para achar o token a partir do webhook
  access_token text not null,                          -- idealmente criptografado (Vault/KMS)
  refresh_token text not null,
  public_key text,
  email text,
  token_expires_at timestamptz not null,
  status text not null default 'conectado' check (status in ('conectado', 'reautorizar')),
  conectado_por uuid,
  updated_at timestamptz not null default now()
);
alter table public.mercadopago_conexoes enable row level security;  -- sem policies: nunca exponha tokens
