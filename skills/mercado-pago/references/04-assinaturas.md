# 04 — Assinaturas recorrentes (preapproval)

✅ = usamos em produção · 📖 = da documentação, não exercitado.

## Conceitos

| Recurso | Endpoint | O que é |
|---|---|---|
| `preapproval_plan` | `/preapproval_plan` | **catálogo**: preço + frequência. Criado uma vez |
| `preapproval` | `/preapproval` | a **assinatura** de um cliente (com ou sem plano) |
| `authorized_payment` | `/authorized_payments/{id}` | cada **cobrança recorrente** dentro de uma assinatura |

Status do preapproval: `pending` → `authorized` → (`paused` | `cancelled`).

## Dois modos

### A) Com plano ✅ (preço fixo)

1. **Fora do runtime** (script de uso único), crie o plano e guarde o `id` em env/banco.
   Template: [templates/nextjs/scripts/mp-plan.ts](../templates/nextjs/scripts/mp-plan.ts).
2. No checkout, crie a assinatura já autorizada com o token do cartão:

```ts
preApproval.create({ body: {
  preapproval_plan_id: PLAN_ID,
  payer_email,
  card_token_id,                 // do Card Payment Brick
  external_reference: `app:${accountId}`,
  back_url,                      // só se for domínio público
  status: 'authorized',
}})
```

O **valor vem do plano**; o `card_token_id` só autoriza a cobrança, então não há superfície para adulterar preço.

### B) Sem plano ✅ (preço calculado por cliente)

```
POST /preapproval
{
  "reason": "Premium + 2 grupos extras",          // texto que aparece na fatura do cartão
  "external_reference": "<id do usuário/empresa>",
  "payer_email": "...",
  "card_token_id": "...",
  "status": "authorized",
  "notification_url": "https://SEU-DOMINIO/api/mercadopago/webhook",
  "auto_recurring": { "frequency": 1, "frequency_type": "months", "transaction_amount": 99.7, "currency_id": "BRL" }
}
```

Recalcule `transaction_amount` no servidor (ex.: preço base × quantidade) e valide `quantidade` como inteiro ≥ 1.

## Regras de frequência ⚠️

- `frequency_type` aceita **só** `days` ou `months`. **`years` não existe.** Plano anual = `frequency: 12, frequency_type: "months"`.
  O SDK tipa o campo como `string`, então o TypeScript não avisa: quebra só em runtime contra a API.
- `back_url` precisa ser URL pública. O MP **rejeita `localhost`**. Em dev, omita o campo.

## Checkout transparente: o que acontece na resposta ✅

Com `card_token_id` + `status: "authorized"`, o MP tenta ativar e cobrar na mesma chamada e devolve o resultado síncrono
(sem `init_point`, sem redirect). Trate:

- `authorized` → libere já (e o webhook reaplica o mesmo estado: seja idempotente);
- `pending` → grave `pendente`, o webhook resolve depois;
- `rejected`/`cancelled` → mostre "pagamento não autorizado, confira o cartão ou use outro" e libere cupom/reserva.

Sem `card_token_id` (modo redirect), o status nasce `pending` e a resposta traz `init_point` para mandar o cliente ao MP.

## Trial ✅

Primeira cobrança no futuro: `auto_recurring.start_date` com data futura (ISO).
O MP exige data futura: se faltar menos de ~1h de trial, cobre na hora (omita `start_date`).
📖 Planos também aceitam `free_trial` no `auto_recurring` do plano.

## Alterar valor de assinatura ativa ✅

`PUT /preapproval/{id}` com `{ "auto_recurring": { "transaction_amount": X, "currency_id": "BRL" } }`.
Vale a partir da **próxima** cobrança. Se o usuário já tem assinatura ativa, **atualize**: não crie uma segunda
(cobra em dobro).

⚠️ Se você codifica dados no `external_reference` (ex.: `empresa:modulo:quantidade`), ele **não é atualizado** quando você muda só o valor.
O webhook que "re-deriva" quantidade do `external_reference` vai sobrescrever o valor novo pelo antigo.
Solução: marque no banco "quantidade atualizada manualmente" e pare de derivar do `external_reference` a partir daí.

## Trocar de plano ✅

O MP **não troca o plano** de um preapproval existente. Trocar tier = **cancelar o antigo e criar outro**.
O valor do ciclo em curso não é devolvido: avise isso na tela e nos Termos antes de confirmar.
Cancele o antigo **antes** de criar o novo, e se o cancelamento falhar, aborte (senão cobra dois).

## Cancelar ✅

`PUT /preapproval/{id}` com `{ "status": "cancelled" }`. O estado local só vira `cancelada` de forma definitiva quando o webhook
`subscription_preapproval` confirmar. O **acesso continua até o fim do período já pago** (campo `periodo_fim`): quem decide
acesso é a data, não o status.

## Cobranças recorrentes: como o período avança ✅

Cada ciclo chega como webhook `subscription_authorized_payment`. Ele traz só um id. Fluxo:

1. `GET /authorized_payments/{id}` → pega `preapproval_id` (⚠️ o SDK `mercadopago` não tem cliente para esse recurso: use `fetch`);
2. `GET /preapproval/{preapproval_id}` → estado atual, com `next_payment_date` já avançado;
3. reaplique o estado na tabela local (`periodo_fim = next_payment_date + folga`).

É assim que o acesso avança mês a mês, não só na autorização inicial.

- **Folga de 3 dias** sobre `next_payment_date` ✅: o MP tenta de novo antes de desistir; sem folga você bloqueia cliente adimplente.
- Cobrança falhou (`authorized_payment.status != processed`): marque `inadimplente`, mantenha o acesso durante uma carência
  (usamos 5 dias) e deixe um job (cron) cortar quando `prazo_final_acesso` passar. `cancelada` é estado final: não reabra a partir de evento de cobrança.

## Status local sugerido

`pendente | autorizada | pausada | inadimplente | cancelada`. Mapeamento: `authorized→autorizada`, `paused→pausada`,
`cancelled→cancelada`, resto→`pendente`. Modelagem completa em [09-banco-de-dados.md](09-banco-de-dados.md).
