---
name: mercado-pago
description: Guia passo a passo da integração com o Mercado Pago (Brasil), da criação da conta e da aplicação no painel até credenciais, webhook assinado, código, testes em sandbox e go-live. Cobre Pix, cartão (Bricks / checkout transparente), Checkout Pro, assinaturas recorrentes (preapproval), marketplace com OAuth e split. Use quando o usuário mencionar Mercado Pago, MP, mercadopago, Pix, checkout transparente, Bricks, assinatura recorrente, preapproval, webhook de pagamento, "integrar pagamento", "cobrar cartão" ou "receber por Pix". Também dispara com /mercado-pago.
---

# Mercado Pago — integração guiada

Você conduz o usuário por uma integração completa com o Mercado Pago, **em etapas, uma de cada vez**.
Não despeje tudo de uma vez: faça a etapa, confirme que funcionou, passe para a próxima.

## Regras de condução

1. **Descubra onde o usuário está** antes de começar (Etapa 0). Quem já tem conta e credenciais pula direto para a etapa certa.
2. **Faça pausas explícitas** nas etapas que acontecem fora do código (painel do Mercado Pago). Diga exatamente o que clicar e o que copiar de volta, e espere o usuário confirmar. Você não tem acesso ao painel dele.
3. **Nunca peça nem aceite que o usuário cole o Access Token, o Client Secret ou a chave secreta do webhook no chat.** Peça que ele mesmo grave direto no `.env` / nos secrets. Se ele colar mesmo assim, avise que deve regenerar a credencial. A Public Key (`APP_USR-...` ou `TEST-...` pública) pode aparecer, ela é feita para ir ao navegador.
4. **Teste primeiro, produção depois.** Todo o desenvolvimento acontece com credenciais de teste; produção só na Etapa 7.
5. **O valor da cobrança nunca vem do cliente.** Sempre recalcule o preço no servidor (catálogo, banco ou plano). Isso vale para Pix, cartão e assinatura.
6. **O webhook é a fonte da verdade.** A resposta síncrona da API pode liberar o acesso na hora, mas é o webhook (idempotente) que confirma e corrige o estado.
7. A interface do painel muda com frequência. Se algo do roteiro não bater com a tela do usuário, diga isso, descreva o objetivo do passo e consulte a documentação oficial: https://www.mercadopago.com.br/developers/pt/docs
8. Quando for escrever código, **leia o projeto antes** (stack, onde ficam rotas/funções, como é o acesso ao banco) e adapte os templates de `templates/` em vez de colar às cegas.

## Etapa 0 — Diagnóstico (sempre comece aqui)

Pergunte, de forma curta (use `AskUserQuestion` se disponível):

| Pergunta | Por quê |
|---|---|
| O que vai ser cobrado? (produto único, curso, serviço avulso, mensalidade, plano anual, vários vendedores) | define o fluxo |
| Como o cliente paga? (Pix, cartão, os dois, boleto) | define Brick vs Pix direto |
| Quer o formulário dentro do seu site (transparente) ou redirecionar para o Mercado Pago (Checkout Pro)? | define o front |
| Qual a stack? (Next.js, Node/Express, Supabase Edge Functions, Vercel serverless, outra) | define o template |
| Já tem conta Mercado Pago, aplicação criada e credenciais? | decide se começa na Etapa 1 ou na 3 |
| Os pagamentos caem na conta de quem? Só na sua, ou de vários vendedores/clientes que você cadastra? | se for vários vendedores, é marketplace (OAuth) |

Com as respostas, escolha o fluxo usando [references/02-escolher-fluxo.md](references/02-escolher-fluxo.md) e **diga ao usuário qual escolheu e por quê**, em duas linhas.

Resumo da escolha:

- Cobrança única + quer controle total da tela → **Pix direto + Card Payment Brick** → [03-pagamento-unico.md](references/03-pagamento-unico.md)
- Cobrança única + quer o mínimo de código → **Checkout Pro** (preferência + redirect) → [03-pagamento-unico.md](references/03-pagamento-unico.md)
- Mensalidade / plano recorrente → **Assinaturas (preapproval)** → [04-assinaturas.md](references/04-assinaturas.md)
- Cada cliente seu recebe na própria conta → **Marketplace / OAuth** → [06-marketplace-oauth.md](references/06-marketplace-oauth.md)

## Etapa 1 — Conta Mercado Pago

Leia [references/01-conta-e-credenciais.md](references/01-conta-e-credenciais.md), seção "Conta".
Objetivo: o usuário ter uma conta Mercado Pago **vendedora**, com a identidade validada (CPF/CNPJ), que é a conta que vai receber o dinheiro.

Pare e peça confirmação: "Sua conta está criada e verificada?"

## Etapa 2 — Criar a aplicação no painel de desenvolvedores

Leia a seção "Aplicação" de [01-conta-e-credenciais.md](references/01-conta-e-credenciais.md) e guie o usuário clicando por clicando. Pontos que precisam ficar certos:

- o **tipo de produto** escolhido na criação (Checkout Pro, Checkout API / Bricks, Assinaturas) tem de bater com o fluxo decidido na Etapa 0;
- uma aplicação por produto/ambiente de negócio (não misture dois sistemas na mesma aplicação, os webhooks e credenciais ficam acoplados).

Pare e peça confirmação.

## Etapa 3 — Credenciais e variáveis de ambiente

Siga a seção "Credenciais" de [01-conta-e-credenciais.md](references/01-conta-e-credenciais.md).

1. Explique a diferença: **Public Key** (vai no navegador) × **Access Token** (só servidor) × **Client ID/Secret** (só se OAuth/marketplace).
2. Crie você mesmo (no código do usuário) o `.env.example` com os nomes das variáveis, **sem valores**, e garanta que `.env*` está no `.gitignore`.
3. Peça ao usuário que preencha os valores de **teste** no `.env.local` / nos secrets da plataforma, e confirme sem ver os valores.
4. Valide a credencial sem expô-la: ofereça o comando `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $MERCADOPAGO_ACCESS_TOKEN" https://api.mercadopago.com/users/me` para o usuário rodar (esperado `200`).

Variáveis padrão desta skill (mantenha os nomes, os templates usam elas):

```
MERCADOPAGO_ACCESS_TOKEN=          # servidor
NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY=  # navegador (ou VITE_/PUBLIC_ conforme o framework)
MERCADOPAGO_WEBHOOK_SECRET=        # servidor, vem da Etapa 5
MERCADOPAGO_CLIENT_ID=             # só marketplace
MERCADOPAGO_CLIENT_SECRET=         # só marketplace
```

## Etapa 4 — Implementar o fluxo

Implemente o fluxo escolhido lendo a referência dele e adaptando o template da stack:

| Stack | Template |
|---|---|
| Next.js (App Router) | [templates/nextjs/](templates/nextjs/) |
| Supabase Edge Functions (Deno) | [templates/supabase-edge/](templates/supabase-edge/) |
| Qualquer banco | [templates/sql/schema.sql](templates/sql/schema.sql) (tabelas de eventos e assinatura) |

Ordem recomendada dentro do código:

1. cliente/config do SDK ou helper `mpRequest` (um só lugar lê o token);
2. tabela local do pagamento/assinatura **criada antes** de chamar o Mercado Pago, o `id` dela vira o `external_reference` e a chave de idempotência;
3. endpoint que cria a cobrança (valida usuário, recalcula valor no servidor);
4. front (Brick ou redirect);
5. webhook (Etapa 5).

Antes de dar a etapa por concluída, passe pelo checklist de [references/08-armadilhas.md](references/08-armadilhas.md). Ele resume os erros que mais custaram caro em produção.

## Etapa 5 — Webhook assinado

Leia [references/05-webhooks.md](references/05-webhooks.md). Em duas partes:

**No código:** rota pública (sem sessão de usuário) que valida `x-signature`, grava o evento de forma idempotente, responde rápido e processa buscando o recurso por `GET`.
**No painel (pausa):** o usuário cadastra a URL pública da rota, escolhe os eventos e copia a **chave secreta** para `MERCADOPAGO_WEBHOOK_SECRET` (sem colar no chat).

Atenção: o MP **não alcança `localhost`**. Para testar localmente, use um túnel (ngrok, cloudflared) ou faça deploy de preview, e cadastre essa URL na aba de **testes** do webhook.

Use o simulador de notificação do painel para confirmar `200`, e depois um pagamento de teste real para confirmar o fluxo ponta a ponta.

## Etapa 6 — Testar em sandbox

Leia [references/07-testes-e-go-live.md](references/07-testes-e-go-live.md), seção "Testes". Percorra os cenários, um a um, e registre o resultado:

- [ ] pagamento aprovado
- [ ] pagamento recusado (e a UI mostra o motivo)
- [ ] pagamento pendente (Pix aguardando) que depois vira aprovado via webhook
- [ ] webhook duplicado (reenviar) não duplica efeito
- [ ] assinatura: autorizar, cobrança recorrente, cancelar
- [ ] valor adulterado no front é ignorado pelo servidor

## Etapa 7 — Go-live

Leia a seção "Go-live" de [07-testes-e-go-live.md](references/07-testes-e-go-live.md).
Resumo: ativar as credenciais de produção no painel, trocar as variáveis **no ambiente de produção** (nunca no repositório), cadastrar a URL de produção do webhook (é uma configuração separada da de teste) e fazer **uma** cobrança real de baixo valor para validar de ponta a ponta antes de anunciar.

## Referências

| Arquivo | Conteúdo |
|---|---|
| [01-conta-e-credenciais.md](references/01-conta-e-credenciais.md) | conta, aplicação, credenciais, contas de teste |
| [02-escolher-fluxo.md](references/02-escolher-fluxo.md) | árvore de decisão dos fluxos |
| [03-pagamento-unico.md](references/03-pagamento-unico.md) | Pix, cartão com Brick, 3DS, Checkout Pro |
| [04-assinaturas.md](references/04-assinaturas.md) | planos, preapproval, trial, troca de plano, cancelamento |
| [05-webhooks.md](references/05-webhooks.md) | assinatura, idempotência, reducer, tópicos |
| [06-marketplace-oauth.md](references/06-marketplace-oauth.md) | conectar contas de vendedores, refresh de token, split |
| [07-testes-e-go-live.md](references/07-testes-e-go-live.md) | sandbox, cenários, checklist de produção |
| [08-armadilhas.md](references/08-armadilhas.md) | erros reais e como evitar |
| [09-banco-de-dados.md](references/09-banco-de-dados.md) | modelagem e RLS do acesso por assinatura |
