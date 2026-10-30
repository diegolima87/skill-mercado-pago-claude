# 09 — Modelagem do banco

Esquema completo executável: [templates/sql/schema.sql](../templates/sql/schema.sql) (Postgres/Supabase).

## Tabelas

| Tabela | Para quê |
|---|---|
| `pagamentos` | uma linha por intenção de cobrança única (Pix/cartão/Checkout Pro). Criada **antes** de chamar o MP |
| `assinaturas` | uma linha por conta/empresa com o estado atual da assinatura |
| `mercadopago_eventos` | trilha + lock de processamento dos webhooks |
| `mercadopago_conexoes` | (marketplace) tokens OAuth por empresa |
| `mp_oauth_states` | (marketplace) `state` de uso único |

## `pagamentos`

- `id` (uuid) → vira `external_reference` **e** `X-Idempotency-Key`;
- `status`: `pendente | aprovado | rejeitado | cancelado`;
- `mp_payment_id` guardado quando o MP responde;
- índice único **parcial** `(user_id, item_id) where status = 'pendente'` garante uma tentativa pendente por item e dá idempotência de clique.

## `assinaturas`

Campos que importam:

| Campo | Observação |
|---|---|
| `account_id` **unique** | uma assinatura viva por conta; `upsert onConflict` |
| `mp_preapproval_id` unique, `mp_preapproval_plan_id`, `mp_payer_email` | rastreio |
| `status` | `pendente \| autorizada \| pausada \| inadimplente \| cancelada` |
| `periodo_fim` | **fonte da verdade do acesso** pago. Cancelada com `periodo_fim` futuro ainda dá acesso |
| `proxima_cobranca_em`, `ultimo_pagamento_em`, `cancelada_em` | histórico |
| `mp_atualizado_em` | `last_modified` do recurso já aplicado (descarta evento velho, comparar por epoch) |
| `valor`, `moeda` | espelho do que o MP cobra; **não** é entrada do usuário |

## O portão de acesso mora no banco

Não apenas na UI. A chave `anon` é pública por design; quem fala direto com a API contorna qualquer redirecionamento do front.

```sql
create function is_account_active(target uuid) returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from accounts a left join assinaturas s on s.account_id = a.id
    where a.id = target and (
      a.plano_isento
      or coalesce(a.trial_termina_em, 'epoch') > now()
      or (s.id is not null and (s.status = 'autorizada' or coalesce(s.periodo_fim, 'epoch') > now()))
    )
  );
$$;
```

Aplique com policies **RESTRICTIVE** separadas para `INSERT`/`UPDATE`/`DELETE`, deixando `SELECT` livre:
quem não renovou perde a escrita, mas os dados continuam lá e voltam inteiros quando pagar.
Por que `restrictive`: policies permissivas combinam com `OR` (uma segunda permissiva daria mais acesso, não menos);
as restritivas fazem `AND` com o resultado. Não use `for all restrictive`, que restringiria o `SELECT` também.

Espelhe a regra em TypeScript (tela "ativa até DD/MM") e **comente nos dois lados** que mudou aqui, muda lá.

Ao criar a migração que liga o portão, marque contas **já existentes** como isentas (`plano_isento = true`) senão todas ficam
somente-leitura no instante do deploy. Estado de trial: sem `default` no banco, todo caminho de criação de conta seta explicitamente.

## Escrita só pelo servidor

`assinaturas`, `pagamentos` (colunas de status) e `mercadopago_eventos`: **sem policy de escrita** para o usuário.
Só service role (webhook e rotas de API) escreve, pois só eles sabem o que o MP confirmou. Leitura: membros da conta.
