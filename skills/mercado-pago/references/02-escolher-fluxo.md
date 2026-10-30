# 02 — Escolher o fluxo

## Árvore de decisão

```
O cliente paga uma vez ou todo período?
├── Uma vez
│   ├── Quer a tela de pagamento dentro do seu site?
│   │   ├── Sim → Pix direto (API /v1/payments) + Card Payment Brick       → 03
│   │   └── Não, aceito redirecionar → Checkout Pro (preferência + init_point) → 03
│   └── Vários vendedores recebendo → mesmo fluxo, mas com token OAuth do vendedor → 06
└── Todo período (mensal, anual)
    ├── Preço fixo conhecido de antemão → Plano (preapproval_plan) + preapproval com card_token → 04
    └── Preço varia por cliente (qtd. de licenças, extras)    → preapproval sem plano, auto_recurring no body → 04
```

## Comparativo

| Fluxo | Esforço | Controle de UI | Cartão toca seu servidor? | Quando usar |
|---|---|---|---|---|
| **Checkout Pro** | baixo | nenhum (página do MP) | não | MVP, venda simples, pouca equipe |
| **Pix direto** | médio | total | n/a | Pix com QR/copia-e-cola na sua tela, polling + webhook |
| **Card Payment Brick** | médio | alto | **não** (token do iframe do MP) | cartão dentro do app |
| **Assinatura com plano** | médio | alto | não | planos de preço fixo (Essencial/Completo, anual/mensal) |
| **Assinatura sem plano** | médio | alto | não | preço calculado por cliente |
| **Marketplace (OAuth)** | alto | alto | não | você cobra em nome de terceiros |

## Pix: duas opções

1. **Pix puro**: `POST /v1/payments` com `payment_method_id: "pix"`; o QR volta em `point_of_interaction.transaction_data`.
   Mais simples e o que usamos.
2. **Pix dentro do Payment Brick**: o Brick gera tudo. Menos código, menos controle.

## Perguntas finais antes de implementar

- Quem é o "dono" do dinheiro? (só você = token seu; terceiros = OAuth)
- O acesso do cliente depende do pagamento? Então defina **onde** vive o estado (tabela de assinatura/pagamento)
  e **quem** libera acesso (webhook). Veja [09-banco-de-dados.md](09-banco-de-dados.md).
- Precisa de cupom, trial, upgrade/downgrade? Isso muda a modelagem (e trial/troca de plano têm armadilhas,
  veja [04-assinaturas.md](04-assinaturas.md)).
