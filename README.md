# Claude Skills

Skills para o [Claude Code](https://claude.com/claude-code), nascidas de projetos reais em produção.
Cada skill guia o Claude por um fluxo completo, com referências, templates e a lista de erros que já custaram caro.

> **English:** Skills for Claude Code distilled from production projects. The first one, `mercado-pago`, walks you through
> a full Mercado Pago (Brazil) integration: account → app → credentials → Pix / cards / subscriptions / marketplace →
> signed webhooks → sandbox tests → go-live. Content is in Brazilian Portuguese.

## Skills

| Skill | O que faz |
|---|---|
| [`mercado-pago`](skills/mercado-pago) | Guia **da criação da conta no Mercado Pago até a API configurada e no ar**: Pix, cartão (Bricks), Checkout Pro, assinaturas recorrentes, marketplace (OAuth), webhook assinado, testes e go-live |

## Instalar

Uma skill é uma pasta com um `SKILL.md`. Copie a pasta para o diretório de skills do Claude Code.

**Para todos os seus projetos** (nível de usuário):

```bash
git clone https://github.com/diegolima87/claude-skills.git
mkdir -p ~/.claude/skills
cp -r claude-skills/skills/mercado-pago ~/.claude/skills/
```

```powershell
# Windows (PowerShell)
git clone https://github.com/diegolima87/claude-skills.git
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
Copy-Item -Recurse claude-skills\skills\mercado-pago "$HOME\.claude\skills\"
```

**Só para um projeto** (vai no git do projeto e vale para o time):

```bash
mkdir -p .claude/skills
cp -r /caminho/claude-skills/skills/mercado-pago .claude/skills/
```

Reinicie o Claude Code (ou abra uma nova sessão) para ele carregar a skill.

## Usar

Chame direto:

```
/mercado-pago
```

ou descreva o que quer, e o Claude aciona a skill sozinho:

- "quero cobrar por Pix e cartão no meu app Next.js, nunca usei Mercado Pago"
- "preciso de assinatura mensal com Mercado Pago e Supabase"
- "meu webhook do Mercado Pago está duplicando pagamento"
- "cada clínica minha deve receber na própria conta Mercado Pago"

### Como a conversa funciona

A skill conduz **uma etapa por vez** e para quando a próxima ação é sua:

```
0  Diagnóstico    → o que cobrar, como, stack, já tem conta?   → escolhe o fluxo
1  Conta          → criar/verificar a conta vendedora          (você, no site do MP)
2  Aplicação      → criar a aplicação no painel de desenvolvedores
3  Credenciais    → Public Key / Access Token de teste → .env  (sem colar segredo no chat)
4  Implementar    → código na sua stack, a partir dos templates
5  Webhook        → rota assinada + cadastro da URL e do secret no painel
6  Testar         → cartões de teste, Pix, webhook duplicado, valor adulterado
7  Go-live        → credenciais de produção, webhook de produção, cobrança real mínima
```

Ela **não** pede o seu Access Token, Client Secret nem a chave do webhook no chat: você grava direto no `.env`/secrets.

## O que tem dentro de `mercado-pago`

```
skills/mercado-pago/
├── SKILL.md                      roteiro guiado (as 8 etapas)
├── references/
│   ├── 01-conta-e-credenciais.md conta, aplicação, credenciais, contas de teste
│   ├── 02-escolher-fluxo.md      árvore de decisão
│   ├── 03-pagamento-unico.md     Pix, Card Payment Brick, 3DS, Checkout Pro, idempotência
│   ├── 04-assinaturas.md         planos, preapproval, trial, troca de plano, cancelamento
│   ├── 05-webhooks.md            assinatura HMAC, idempotência, reducer, fora de ordem
│   ├── 06-marketplace-oauth.md   conectar contas de vendedores, refresh de token, split
│   ├── 07-testes-e-go-live.md    sandbox, cenários, checklist de produção
│   ├── 08-armadilhas.md          41 erros reais e o jeito certo
│   └── 09-banco-de-dados.md      modelagem e portão de acesso no banco (RLS)
└── templates/
    ├── nextjs/                   App Router + SDK oficial + Bricks
    ├── supabase-edge/            Deno, sem SDK
    └── sql/schema.sql            tabelas, índice de idempotência, is_account_active()
```

## Honestidade sobre o que foi testado

- Os padrões marcados com ✅ nas referências vêm de projetos que rodam em produção (Next.js + Supabase, Supabase Edge Functions, Vercel, TanStack Start).
- Os marcados com 📖 vêm da documentação oficial e **não** foram exercitados por nós; confirme antes de depender deles.
- Os **templates são ponto de partida**, não uma biblioteca: o Claude adapta ao seu projeto, e você revisa.
- A interface do painel do Mercado Pago muda; a skill descreve o *objetivo* de cada passo e remete à documentação oficial.
- Cartões de teste e regras de tarifas/prazos mudam. Confira na documentação.

## Aviso

Projeto independente, **sem vínculo com o Mercado Pago**. "Mercado Pago" é marca de seus titulares.
Pagamentos envolvem dinheiro e dados pessoais: revise o código gerado, teste em sandbox e faça uma cobrança real mínima antes de lançar.

## Contribuir

Achou erro, mudança na API ou uma armadilha nova? Abra uma issue ou PR. Para novas skills, crie `skills/<nome>/SKILL.md`
com `name` e `description` no frontmatter (a `description` é o que faz o Claude acionar a skill) e acrescente à tabela acima.

## Licença

[MIT](LICENSE)
