# 03 — Pagamento único: Pix, cartão (Brick) e Checkout Pro

Legenda: ✅ = padrão que usamos em produção · 📖 = vem da documentação oficial, não exercitado nos nossos projetos (confirme antes de usar).

## Ordem canônica (vale para os três)

1. O usuário inicia a compra → você **cria a linha local** (`pagamentos`, status `pendente`).
2. Você chama o Mercado Pago passando `external_reference = <id da linha local>`.
3. O front mostra o resultado (QR, Brick, redirect).
4. O **webhook** busca o pagamento (`GET /v1/payments/{id}`) e atualiza a linha local.
5. O front consulta o estado local (polling leve) até mudar.

Por que criar a linha antes: o `id` dela é seu `external_reference`, sua chave de idempotência, e permite
reaproveitar uma tentativa `pendente` em vez de criar uma por clique.

## Valor: sempre do servidor ✅

O Brick devolve `transaction_amount` no `formData`. **Ignore.** Busque o preço no banco/catálogo/plano
e use esse. Senão qualquer um altera o valor no DevTools.

## Pix direto ✅

```
POST https://api.mercadopago.com/v1/payments
Authorization: Bearer <ACCESS_TOKEN>
X-Idempotency-Key: <chave determinística, ver abaixo>
Content-Type: application/json

{
  "transaction_amount": 49.9,
  "description": "Descrição curta",
  "payment_method_id": "pix",
  "payer": { "email": "cliente@exemplo.com", "first_name": "Ana", "last_name": "Silva" },
  "external_reference": "<id da linha local>",
  "date_of_expiration": "2026-12-31T23:59:59.000-03:00"   // opcional; padrão é 24h
}
```

Resposta, o que interessa:

```
id                                                  → guarde (mp_payment_id)
status                                              → "pending"
point_of_interaction.transaction_data.qr_code       → copia-e-cola
point_of_interaction.transaction_data.qr_code_base64→ imagem do QR (data:image/png;base64,...)
point_of_interaction.transaction_data.ticket_url    → página de pagamento hospedada pelo MP
date_of_expiration
```

No front: mostre o QR + botão "copiar código" + estado "Aguardando pagamento" que consulta **seu** backend
(`check-payment-status` ou a própria linha local) a cada ~3–5 s, com limite de tempo.
Quando o webhook marcar `aprovado`, a tela libera.

Em sandbox o MP **não conclui a transferência** do Pix. O que dá para validar: QR gera, tela de espera faz polling
sem travar. A aprovação real só é testável com Pix real (valor baixo, em produção).

## Cartão com Card Payment Brick ✅

### Front

Carregue o SDK `https://sdk.mercadopago.com/js/v2` e crie o Brick `cardPayment` com a **Public Key**.
O cartão é digitado num iframe do MP: número e CVV **nunca** passam pelo seu servidor nem pelo seu DOM.
O `onSubmit` entrega só o token e metadados:

```ts
interface CardPaymentFormData {
  token: string;
  issuer_id?: string | number;
  payment_method_id: string;
  transaction_amount: number;   // ← NÃO confie
  installments: number;
  payer: { email: string; identification?: { type?: string; number?: string } };
}
```

Template React/Next: [templates/nextjs/components/CardPaymentBrick.tsx](../templates/nextjs/components/CardPaymentBrick.tsx).

Pontos que importam no componente:

- desmonte o Brick no cleanup (`controller.unmount()`) e trate o caso de o efeito ser cancelado antes de o `create` resolver;
- `onSubmit` deve **retornar a Promise** do seu backend; se rejeitar, o Brick mostra o erro e deixa tentar de novo;
- `maxInstallments: 1` se cobrar assinatura/avulso sem parcelamento;
- ID do container único por instância (`useId`), senão dois Bricks na mesma página colidem.

### Back

```
POST /v1/payments
{
  "transaction_amount": <do servidor>,
  "token": "<formData.token>",
  "payment_method_id": "<formData.payment_method_id>",
  "issuer_id": "<formData.issuer_id>",
  "installments": 1,
  "payer": { "email": "...", "identification": { "type": "CPF", "number": "..." } },
  "description": "...",
  "external_reference": "<id local>"
}
```

Interprete `status` + `status_detail`:

| status | Significado | Ação |
|---|---|---|
| `approved` | pago | pode liberar na hora, o webhook reaplica |
| `in_process` / `pending` | em análise | mostre "processando"; o webhook decide |
| `rejected` | recusado | mostre mensagem a partir de `status_detail` (ex.: `cc_rejected_insufficient_amount`); permita nova tentativa |
| `cancelled` | cancelado/expirado | libere reservas (cupom, estoque) |

Erro HTTP da API (4xx) não é "recusado": é request inválido (token expirado, campo faltando). Trate separado.

### 3D Secure 📖

Alguns pagamentos voltam com `status_detail: "pending_challenge"` e `three_ds_info` (`external_resource_url`, `creq`).
O Card Payment Brick **só tokeniza**; o desafio do emissor é renderizado pelo **Status Screen Brick**
([templates/nextjs/components/StatusScreenBrick.tsx](../templates/nextjs/components/StatusScreenBrick.tsx)),
inicializado com `paymentId` + `additionalInfo: { externalResourceURL, creq }`.
Para o MP oferecer o desafio, a doc oficial pede `three_d_secure_mode: "optional"` no body do pagamento.
Esse campo **não** foi exercitado nos nossos projetos: confirme em https://www.mercadopago.com.br/developers/pt/docs.

## Checkout Pro (redirect) ✅

```
POST https://api.mercadopago.com/checkout/preferences
{
  "items": [{ "id": "<id>", "title": "Produto", "quantity": 1, "currency_id": "BRL", "unit_price": 49.9 }],
  "payer": { "email": "..." },
  "external_reference": "<id local>",
  "back_urls": { "success": "https://.../sucesso", "failure": "https://.../falha", "pending": "https://.../pendente" },
  "auto_return": "approved",
  "notification_url": "https://SEU-DOMINIO/api/mercadopago/webhook",
  "binary_mode": true,
  "statement_descriptor": "NOMEFATURA",
  "payment_methods": { "excluded_payment_types": [{ "id": "ticket" }], "installments": 12 }
}
```

Redirecione para `init_point` (produção) ou `sandbox_init_point` (teste).

- `binary_mode: true`: o pagamento só pode ser aprovado ou recusado (sem "em análise"). Simplifica a lógica de acesso; avalie o impacto na aprovação de cartões.
- `back_urls` com `auto_return` exigem HTTPS público, **não** `localhost`.
- A volta do usuário para `back_urls` **não prova pagamento**: confie só no webhook / `GET /v1/payments`.
- `notification_url` na preferência vale para aquele pagamento; combine com a URL cadastrada no painel e evite duplicar (veja [05-webhooks.md](05-webhooks.md)).

## Idempotência ✅ (e a armadilha)

Todo `POST /v1/payments` precisa de `X-Idempotency-Key`. Reenviar a mesma chave devolve o **mesmo** pagamento em vez de cobrar duas vezes.

- ✅ Certo: chave **determinística por intenção de cobrança**, ex. o `id` da linha local (`pagamento.id`).
- ❌ Errado (já erramos): `` `pix-${id}-${Date.now()}` `` ou `crypto.randomUUID()` por request. Cada retry gera chave nova e
  a idempotência deixa de existir; um duplo clique ou retry de rede vira cobrança dupla.

Se o usuário altera algo (valor, cartão) numa nova tentativa legítima, então gere uma **nova intenção** (nova linha ou
sufixo de tentativa), não reutilize a chave com corpo diferente.

## Cupons / reservas

Se houver cupom, reserve na criação, confirme no `approved`, libere em `rejected`/`cancelled`. O webhook precisa
ser o único que confirma. Cupom de 100% (valor final 0): **não chame o MP**, não há o que cobrar. Aprove localmente
(usamos `status_detail: "cupom_gratuito"`) e confirme o cupom no mesmo ponto.
