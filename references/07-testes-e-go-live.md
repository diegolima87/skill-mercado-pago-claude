# 07 — Testes e go-live

## Testes (sandbox)

### Pré-requisitos

- credenciais **de teste** da aplicação (Public Key + Access Token) no ambiente;
- conta de teste **Vendedor** (dona das credenciais) e **Comprador** (veja [01](01-conta-e-credenciais.md));
- webhook de **modo teste** apontando para uma URL pública (túnel ou preview).

### Cartão de teste

O **nome do titular** decide o resultado. Usamos estes (validade `11/30`, CVV `123`):

| Resultado | Nome do titular | Cartão |
|---|---|---|
| ✅ Aprovado | `APRO` | Visa `4235 6477 2802 5682` ou Mastercard `5480 8328 0103 3311` |
| ❌ Recusado (erro genérico) | `OTHE` | mesmos números |
| 💰 Saldo insuficiente | `FUND` | mesmos números |
| ⏳ Pendente | `CONT` | mesmos números |

Documento do titular: CPF de teste `12345678909`. E-mail: o do **comprador de teste** (`test_user_...@testuser.com`).

> Os números de cartão de teste e os códigos de nome (`APRO`, `OTHE`, ...) são publicados e mudam de vez em quando.
> Se um cartão deixar de funcionar, consulte a lista atual na documentação oficial em *Cartões de teste*.

### Pix em sandbox

O Mercado Pago **não completa a transferência** em sandbox. Dá para validar: o QR/copia-e-cola é gerado e a tela de espera
faz polling sem travar. A aprovação real só se testa com um Pix real de valor baixo, em produção (Etapa go-live).
Procure no painel da aplicação de teste por opção de "simular pagamento"; se existir, use.

### Cenários mínimos

| # | Cenário | Esperado |
|---|---|---|
| 1 | Cartão `APRO` | linha local `aprovado`; acesso liberado; webhook reaplica sem duplicar |
| 2 | Cartão `OTHE` | tela mostra erro compreensível; nada liberado; cupom/reserva devolvidos |
| 3 | Cartão `CONT` | "processando"; depois resolve via webhook |
| 4 | Pix gerado | QR aparece; polling não trava; expira sem quebrar a UI |
| 5 | Webhook duplicado (reenviar do painel) | nenhum efeito duplicado |
| 6 | Webhook com assinatura errada (curl manual) | `401`, nada processado, tentativa auditada |
| 7 | Webhook sem `MERCADOPAGO_WEBHOOK_SECRET` configurado | `401` (falha fechada) |
| 8 | Valor adulterado no front | servidor cobra o valor correto |
| 9 | Assinatura: autorizar → cobrança recorrente → cancelar | `periodo_fim` avança; cancelamento mantém acesso até o fim do período |
| 10 | Duas abas / duplo clique em "pagar" | uma cobrança só (idempotência) |

### Simular o webhook na mão

```bash
# assinatura inválida: precisa dar 401
curl -i -X POST "https://SEU-DOMINIO/api/mercadopago/webhook?data.id=123" \
  -H "x-signature: ts=1,v1=deadbeef" -H "x-request-id: teste" \
  -H "content-type: application/json" -d '{"type":"payment","data":{"id":"123"}}'
```

Para um `200` real use o **simulador do painel** (ele assina com a sua chave).

### Conferir no banco

Depois do teste, consulte a linha local e a tabela de eventos: status, `mp_payment_id`, e se há exatamente **um** evento `processado`
por mudança de estado.

## Go-live

Faça nesta ordem. **Só** quando o produto real estiver pronto para vender.

1. **Ativar credenciais de produção** no painel (formulário de segmento/site). Aguarde aprovação.
2. **Conta**: identidade validada, dados bancários/Pix de saque configurados.
3. **Variáveis de produção**, no ambiente de produção (Vercel/Supabase secrets/etc.), nunca no repositório:
   `MERCADOPAGO_ACCESS_TOKEN`, `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY`, `MERCADOPAGO_WEBHOOK_SECRET`(**de produção**, é diferente da de teste),
   e Client ID/Secret se marketplace.
4. **Webhook de produção**: cadastre a URL de produção na aba *produção* e copie o **novo** secret.
   É configuração separada da de teste.
5. **Planos de assinatura**: crie-os **com o token de produção** (script de uso único). IDs de plano de teste não existem em produção.
6. **Redirect URI** (marketplace) e **back_urls** em HTTPS do domínio final.
7. **Teste real mínimo**: uma cobrança de baixo valor (Pix e cartão) com a sua própria conta; confira acesso liberado, webhook `processado`,
   e **estorne** depois pelo painel se quiser.
8. **Revisar**: nenhum token em log, nenhum `console.log` de payload com dados do pagador, `.env*` fora do git, `binary_mode`/descriptor revisados.
9. **Monitoramento**: alerta para eventos em `erro`, `recebido` parado e assinatura `inadimplente`.
10. **Texto jurídico**: Termos e Política de Privacidade citando o Mercado Pago como processador; para assinaturas, regra de cancelamento
    e de **não devolução do ciclo em curso** ao trocar de plano.

### Rollback

Mantenha as credenciais de teste à mão. Se a produção falhar, desligue o botão de pagar (feature flag em coluna/variável, como o campo
`disponivel` do catálogo de planos) em vez de reverter deploy no meio de cobranças em curso.
