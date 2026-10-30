# skill-mercado-pago-claude

Skill para o [Claude Code](https://claude.com/claude-code) que guia uma integração completa com o **Mercado Pago (Brasil)**,
**da criação da conta até a API configurada e no ar**. Nasceu de implementações reais em produção.

> **English:** A Claude Code skill that walks you through a full Mercado Pago (Brazil) integration: account → app →
> credentials → Pix / cards (Bricks) / subscriptions / marketplace (OAuth) → signed webhooks → sandbox tests → go-live.
> Content is in Brazilian Portuguese.

## Instalar

Uma skill é uma pasta com um `SKILL.md`. Clone este repositório direto para a pasta de skills do Claude Code, com o nome `mercado-pago`
(é o nome do comando `/mercado-pago`).

**Para todos os seus projetos** (nível de usuário):

```bash
git clone https://github.com/diegolima87/skill-mercado-pago-claude.git ~/.claude/skills/mercado-pago
```

```powershell
# Windows (PowerShell)
git clone https://github.com/diegolima87/skill-mercado-pago-claude.git "$HOME\.claude\skills\mercado-pago"
```

**Só para um projeto** (vale para o time se a pasta for versionada):

```bash
git clone https://github.com/diegolima87/skill-mercado-pago-claude.git .claude/skills/mercado-pago
```

Reinicie o Claude Code (ou abra uma nova sessão). Para atualizar: `git pull` dentro da pasta.

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

## O que tem dentro

```
.
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
  Passam no type-check, e a validação de assinatura do webhook foi testada em 8 cenários, mas nada foi executado contra a API real do Mercado Pago.
- A interface do painel do Mercado Pago muda; a skill descreve o *objetivo* de cada passo e remete à documentação oficial.
- Cartões de teste e regras de tarifas/prazos mudam. Confira na documentação.

## Aviso

Projeto independente, **sem vínculo com o Mercado Pago**. "Mercado Pago" é marca de seus titulares.
Pagamentos envolvem dinheiro e dados pessoais: revise o código gerado, teste em sandbox e faça uma cobrança real mínima antes de lançar.

## Contribuir

Achou erro, mudança na API ou uma armadilha nova? Abra uma issue ou PR.

## Licença

[MIT](LICENSE)
