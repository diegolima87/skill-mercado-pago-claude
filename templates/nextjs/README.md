# Template Next.js (App Router) + Supabase

Copie para o projeto adaptando caminhos. Dependências:

```bash
npm i mercadopago            # SDK oficial (servidor)  — testado com ^3.6
npm i -D tsx dotenv          # para rodar scripts/mp-plan.ts
```

Variáveis (`.env.local`; só a Public Key é pública):

```
MERCADOPAGO_ACCESS_TOKEN=
NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY=
MERCADOPAGO_WEBHOOK_SECRET=
NEXT_PUBLIC_SITE_URL=https://seu-dominio.com.br   # sem localhost: o MP rejeita em back_url
MERCADOPAGO_PLAN_ID_BASIC=                         # preenchido pelo scripts/mp-plan.ts
```

## Placeholders que você precisa ligar ao seu projeto

| Placeholder | O que é |
|---|---|
| `@/lib/supabase/admin` → `createAdminClient()` | cliente Supabase com **service role** (só servidor) |
| `@/lib/auth` → `requireUser()` | devolve `{ user, accountId }` ou lança/retorna 401 |
| `applySubscriptionState` | grava na sua tabela `assinaturas` (já implementado para o schema em `../sql/schema.sql`) |

## Arquivos

| Arquivo | Papel |
|---|---|
| `lib/mercadopago/client.ts` | singleton do SDK; único lugar que lê o Access Token |
| `lib/mercadopago/plans.ts` | **catálogo único** de preços/planos |
| `lib/mercadopago/reference.ts` | codifica/decodifica `external_reference` |
| `lib/mercadopago/payments.ts` | Pix e cartão avulsos (idempotentes) |
| `lib/mercadopago/subscription.ts` | criar/buscar/cancelar preapproval + `authorized_payments` |
| `lib/mercadopago/apply-subscription.ts` | reducer: aplica o estado atual do preapproval no banco |
| `lib/mercadopago/webhook.ts` | validação de assinatura (falha fechada) |
| `app/api/mercadopago/webhook/route.ts` | webhook: valida, reivindica, responde, processa |
| `app/api/mercadopago/subscribe/route.ts` | cria/cancela assinatura |
| `app/api/mercadopago/pix/route.ts` | cria cobrança Pix |
| `components/mercadopago-sdk.ts` | tipos do SDK JS, `CardPaymentFormData`, Public Key |
| `components/CardPaymentBrick.tsx` | formulário de cartão (checkout transparente) |
| `components/StatusScreenBrick.tsx` | desafio 3DS |
| `scripts/mp-plan.ts` | cria os planos **uma vez**, fora do runtime |

Rota do webhook no painel: `https://SEU-DOMINIO/api/mercadopago/webhook`
