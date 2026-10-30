# Template Supabase Edge Functions (Deno)

Sem SDK: `fetch` direto + `crypto.subtle`. Roda em Supabase, e o `_shared/mercadopago.ts` é portável para Deno Deploy/Cloudflare Workers.

## Passo a passo

```bash
# 1. Tabelas
psql ... -f ../sql/schema.sql      # ou cole no SQL Editor do Supabase

# 2. Secrets (use `supabase secrets set`, nunca commit)
supabase secrets set MERCADOPAGO_ACCESS_TOKEN=... MERCADOPAGO_WEBHOOK_SECRET=...
#   marketplace: MERCADOPAGO_CLIENT_ID, MERCADOPAGO_CLIENT_SECRET, MP_OAUTH_REDIRECT_URI, APP_RETURN_URL

# 3. Deploy
supabase functions deploy mp-webhook --no-verify-jwt        # o MP não manda JWT
supabase functions deploy mp-create-payment
supabase functions deploy mp-create-subscription
supabase functions deploy mp-oauth-connect                  # só marketplace
supabase functions deploy mp-oauth-callback --no-verify-jwt # só marketplace
```

URL do webhook no painel: `https://<project-ref>.supabase.co/functions/v1/mp-webhook`

## Arquivos

| Arquivo | Papel |
|---|---|
| `_shared/mercadopago.ts` | `mpRequest`, validação de assinatura (falha fechada, tempo constante), OAuth |
| `_shared/empresa-token.ts` | marketplace: token por empresa + refresh + `user_id` → empresa |
| `mp-webhook/` | valida, reivindica, responde, processa (reducer sobre o recurso) |
| `mp-create-payment/` | Pix ou cartão avulso, idempotência determinística |
| `mp-create-subscription/` | assinatura sem plano, trial via `start_date`, atualização de valor |
| `mp-oauth-connect/` + `mp-oauth-callback/` | conexão de contas de vendedores |

## O que adaptar

- tabelas `itens`, `accounts`, `pagamentos`, `assinaturas`: nomes do **seu** domínio;
- `is_empresa_admin`: sua regra de permissão;
- `BASE_PRICE` em `mp-create-subscription`: leia de catálogo/tabela;
- CORS `*`: restrinja ao seu domínio;
- cada função repete o bloco de autenticação: extraia para `_shared/auth.ts` se preferir.

> Cada Edge Function pode ter limite de tempo/CPU. O webhook usa `EdgeRuntime.waitUntil` para responder 200 antes de processar.
