# 01 — Conta, aplicação e credenciais

> A interface do painel muda. Os nomes de menu abaixo são os que usamos; se não baterem,
> procure pelo objetivo do passo. Documentação oficial: https://www.mercadopago.com.br/developers/pt/docs

## Conta

Objetivo: uma conta Mercado Pago que **receba** o dinheiro.

1. Criar a conta em https://www.mercadopago.com.br (pode ser a mesma conta pessoal ou uma de CNPJ).
2. Validar identidade (CPF/CNPJ, selfie/documento, quando pedido). Sem isso o saque e, em alguns casos,
   a ativação das credenciais de produção ficam bloqueados.
3. Definir como o dinheiro é liberado (prazo de liberação, tarifas). Isso está na conta, não na API.
   Avise o usuário que a taxa por transação e o prazo de repasse dependem da conta e do meio de pagamento.

> Pessoa física vs. jurídica: funciona para os dois. Para cobrar de terceiros de forma recorrente
> (SaaS, escola, clínica) recomende CNPJ.

## Aplicação

Painel: https://www.mercadopago.com.br/developers/panel/app → **Criar aplicação**.

Preencha:

| Campo | Orientação |
|---|---|
| Nome | o do produto (aparece para você, não para o cliente) |
| Tipo de pagamento | **Pagamentos online** |
| Solução / produto | escolha conforme o fluxo (veja abaixo) |
| Plataforma de e-commerce | "Não, uso integração própria" (se for código seu) |
| Termos | aceitar |

Mapeamento fluxo → solução na criação:

| Fluxo escolhido | Solução |
|---|---|
| Checkout Pro (redirect) | Checkout Pro |
| Pix direto, cartão com Brick | Checkout API / Checkout Bricks |
| Assinaturas | Assinaturas (a mesma aplicação de Bricks costuma servir, pois o cartão é tokenizado pelo Brick) |
| Marketplace | a aplicação precisa de OAuth: configure o **Redirect URI** nos detalhes da aplicação |

Regra prática: **uma aplicação por sistema**. Webhook, credenciais e Redirect URI são por aplicação.

## Credenciais

Dentro da aplicação → **Credenciais**. Existem dois conjuntos independentes:

- **Credenciais de teste**: usadas no desenvolvimento. Cobranças nelas nunca movimentam dinheiro de verdade.
- **Credenciais de produção**: exigem ativação (formulário com segmento do negócio e site; leva de minutos a dias).

| Credencial | Onde usar | Segredo? |
|---|---|---|
| **Public Key** | navegador (SDK JS / Bricks) | não |
| **Access Token** | servidor, header `Authorization: Bearer ...` | **sim** |
| **Client ID / Client Secret** | só em marketplace (OAuth) | **sim** (secret) |
| **Chave secreta do webhook** | validação do `x-signature` | **sim** (fica na tela de Webhooks, não em Credenciais) |

Regras:

- Public Key em variável pública (`NEXT_PUBLIC_*`, `VITE_*`). Todo o resto **só no servidor** / secrets da plataforma.
- Nunca commitar. `.env*` no `.gitignore`; só `.env.example` sem valores vai para o git.
- Se um Access Token vazou (chat, commit, print), **regenere no painel** antes de continuar.
- Sem fallback hardcoded de chave no código. Se faltar a variável, falhe com erro claro
  (`MERCADOPAGO_ACCESS_TOKEN não configurado`).

### Validar sem expor o token

O usuário roda no terminal dele (você não precisa ver o token):

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $MERCADOPAGO_ACCESS_TOKEN" \
  https://api.mercadopago.com/users/me
# 200 = token válido
```

## Contas de teste

Painel da aplicação → **Contas de teste**. Para testar de verdade, o fluxo exige **duas** contas:

| Conta | Papel |
|---|---|
| **Vendedor** (de teste) | normalmente criada junto com a aplicação. As credenciais de teste pertencem a ela |
| **Comprador** (de teste) | você cria; é quem "paga" (login com usuário/senha que o painel mostra) |

Detalhes que já nos custaram tempo:

- No primeiro login dessas contas o Mercado Pago pede um **código de verificação de 6 dígitos** (vem pelo painel/e-mail de teste).
- Para pagar com cartão de teste use dados de teste coerentes: nome do titular decide o resultado (veja
  [07-testes-e-go-live.md](07-testes-e-go-live.md)), CPF de teste `12345678909` e o **e-mail do comprador de teste**
  (`test_user_...@testuser.com`). Misturar e-mail real com credencial de teste costuma gerar erro de
  "pagador inválido".
- Nunca use credencial de produção para testar.

## Checklist de saída da etapa

- [ ] conta vendedora criada e verificada
- [ ] aplicação criada com a solução certa
- [ ] Public Key e Access Token **de teste** gravados no `.env.local` (sem ir ao git)
- [ ] `curl /users/me` retornou 200
- [ ] conta de teste Comprador criada
