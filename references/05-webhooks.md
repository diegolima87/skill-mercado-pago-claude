# 05 — Webhooks

O webhook é a **fonte da verdade** do estado do pagamento. Tudo abaixo vem de implementações em produção.

## Configuração no painel (o usuário faz)

Aplicação → **Webhooks** (ou *Notificações*):

1. Há configuração **separada** para **modo teste** e **modo produção**. Cadastre a URL nos dois, quando chegar a hora.
2. **URL**: pública, HTTPS, rota sem sessão de usuário (ex.: `https://SEU-DOMINIO/api/mercadopago/webhook`).
   O MP **não alcança `localhost`**: em dev use túnel (ngrok / cloudflared) ou preview deployado.
3. **Eventos** a assinar, conforme o fluxo:

| Fluxo | Eventos (tópicos) |
|---|---|
| Pix / cartão / Checkout Pro | `payment` |
| Assinaturas | `subscription_preapproval`, `subscription_authorized_payment` (e `subscription_preapproval_plan` se quiser reagir a mudanças de plano) |
| Marketplace | os mesmos, mais o `user_id` do vendedor no corpo (veja [06](06-marketplace-oauth.md)) |

4. Revele a **chave secreta (assinatura)** e grave em `MERCADOPAGO_WEBHOOK_SECRET`. O usuário faz isso direto, sem colar no chat.
5. Use o **simulador** do painel para enviar uma notificação de teste e veja `200` no seu log.

## Anatomia da requisição

```
POST /api/mercadopago/webhook?data.id=123456789&type=payment
x-signature: ts=1704908010,v1=618c85345248dd820d5fd456117c2ab2ef8eda45a0282ff693eac24131a5e839
x-request-id: 4b1f...
{ "action": "payment.updated", "type": "payment", "data": { "id": "123456789" }, "user_id": 998877 }
```

- O corpo **só traz um id**, não o estado. Sempre busque o recurso por `GET`.
- `data.id` vem na **query string** para pagamentos e no **corpo** para assinaturas na prática: leia `query['data.id'] || body.data.id`.
- `user_id` (no corpo) identifica a conta MP que originou o evento: é a chave para achar o token do vendedor em marketplace.

## Validar a assinatura ✅

Manifesto assinado:

```
id:<data.id em minúsculas>;request-id:<x-request-id>;ts:<ts>;
```

`HMAC-SHA256(secret, manifesto)` em hex deve ser igual a `v1`. Regras:

1. `data.id` em **minúsculas** (relevante quando é alfanumérico).
2. Comparação em **tempo constante** (`timingSafeEqual`), nunca `===`. (Um dos nossos usava `!==`; corrija.)
3. **Falha fechada**: se `MERCADOPAGO_WEBHOOK_SECRET` não existe, **rejeite** (401). Já tivemos webhook com
   `if (secret) { validar }` que, sem o secret, aceitava qualquer notificação forjada.
4. Rejeite `ts` muito antigo (tolerância ~5 min) para mitigar replay.
5. Quebrou a assinatura → **401 e não processe**. Grave a tentativa para auditoria.

Preferência: use o validador oficial do SDK Node (`WebhookSignatureValidator.validate({ xSignature, xRequestId, dataId, secret, toleranceSeconds })`
no pacote `mercadopago` ≥ 2.x/3.x; usamos `^3.6.1`). Evita reimplementar HMAC em código de segurança. Fora do Node (Deno, edge), implemente
com `crypto.subtle` conforme [templates/supabase-edge/_shared/mercadopago.ts](../templates/supabase-edge/_shared/mercadopago.ts).

## Idempotência: reivindicar o evento no banco ✅

O MP reenvia a notificação (timeout, 5xx, ou por política). E duas entregas podem chegar **ao mesmo tempo**.
Não resolva com `select` + `insert` em memória: a corrida existe por construção. Use um **índice único parcial** no Postgres:

```sql
create table mercadopago_eventos (
  id uuid primary key default gen_random_uuid(),
  topico text not null, action text, resource_id text not null,
  x_request_id text, assinatura_valida boolean not null default true,
  payload jsonb, status text not null default 'recebido' check (status in ('recebido','processado','erro')),
  erro text, processado_em timestamptz, created_at timestamptz not null default now()
);
-- Lock de PROCESSAMENTO: só UM evento "em andamento" por (topico, resource_id).
-- Linhas 'processado' e 'erro' ficam fora de propósito (veja o aviso abaixo).
create unique index mercadopago_eventos_claim_uniq
  on mercadopago_eventos (topico, resource_id) where status = 'recebido';
```

Fluxo:

1. valida assinatura (senão 401);
2. `insert` do evento com `status = 'recebido'`. Erro `23505` (unique) → outra entrega está processando agora: **responda 200** e pare;
3. responda 200 **rápido**;
4. processe depois da resposta (`after()` no Next, `EdgeRuntime.waitUntil` no Supabase) e marque `processado` ou `erro`
   (sai do índice nos dois casos, liberando o próximo evento daquele recurso).

> ⚠️ **Não bloqueie `(topico, resource_id)` para sempre.** Um mesmo recurso muda de estado várias vezes com o **mesmo id**:
> um `payment` vai de `pending` a `approved`; um `preapproval` vai de `authorized` a `paused`/`cancelled`. Se o índice cobrir também
> as linhas `processado` (ex.: `where status <> 'erro'`), o 2º evento do mesmo recurso bate em `23505` e é **descartado sem processar**.
> Já tivemos esse bug latente: pausas/cancelamentos feitos pelo Mercado Pago nunca eram aplicados.
> O lock serve só contra **concorrência**; a correção vem do *reducer* idempotente abaixo.
>
> Evento que morreu no meio (processo caiu com a linha em `recebido`) trava aquele recurso: tenha um job que mova `recebido`
> com mais de alguns minutos para `erro`.

## Reducer sobre o recurso, não sobre o evento ✅

Nunca atualize o banco com base no que veio no payload do webhook. Faça:

```
evento chega → GET do recurso (payment / preapproval / authorized_payment) → aplica o ESTADO ATUAL no banco
```

Vantagens: notificação fora de ordem se resolve sozinha (quem chegar por último, o GET devolve o estado real);
reprocessar é seguro (aplicar o mesmo estado duas vezes dá o mesmo resultado).

Proteja contra evento velho: guarde o `last_modified` do recurso já aplicado (`mp_atualizado_em`) e ignore se o novo for ≤.
⚠️ **Compare por epoch** (`new Date(x).getTime()`), não por string: o MP devolve com offset local (`-04:00`) e o PostgREST normaliza para
UTC (`+00:00`). Comparar como texto descarta eventos novos achando que são velhos.
(O campo se chama `last_modified` em preapproval e `date_last_updated` em payments.)

Escreva com `upsert ... onConflict`, **não** `update`: um `update` numa linha que ainda não existe afeta zero linhas e retorna sucesso,
o webhook "funciona" sem gravar nada.

## Resolver "de quem é este pagamento"

Ordem de preferência:

1. `external_reference` do recurso → id da sua linha local ✅ (codifique tipo+id: `app:<accountId>`, `curso:<pagamentoId>`);
2. `mp_payment_id` / `mp_preapproval_id` gravados na criação (fallback);
3. marketplace: `user_id` do corpo → `mercadopago_conexoes.mp_user_id` → token daquela empresa.

❌ Evite: iterar sobre os tokens de **todos** os clientes até algum conseguir ler o pagamento (já fizemos; é O(n), vaza tentativas
e quebra com muitos tenants).

`external_reference` não deve carregar dado sensível (telefone, CPF): ele aparece nos painéis e logs do MP.

## Resposta HTTP

- Responda `200/201` em poucos segundos (a doc oficial fala em ~22 s antes de considerar falha e reenviar).
- Assinatura inválida → `401`.
- Erro **transitório seu** (banco fora do ar) → pode devolver `5xx` para o MP reentregar. Se prefere sempre `200` para evitar tempestade de retries,
  então **registre o erro** na tabela de eventos e tenha um job de reprocessamento; senão você perde pagamentos silenciosamente.
- Nunca devolva stack trace.

## Logs

Não logue e-mail, CPF ou payload completo do pagador. Logue id, status, valor.

## Checklist do webhook

- [ ] rota pública, sem sessão, `runtime nodejs` (precisa de `crypto`) / service role no banco
- [ ] assinatura validada, falha fechada, tolerância de `ts`
- [ ] evento reivindicado por índice único
- [ ] processamento depois do 200
- [ ] `GET` do recurso + upsert idempotente
- [ ] proteção contra evento fora de ordem (epoch)
- [ ] testado com o simulador **e** com pagamento de teste real
