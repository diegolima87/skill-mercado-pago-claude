# 08 — Armadilhas (erros reais, em ordem de custo)

Cada item saiu de um bug, quase-bug ou revisão de segurança em projetos em produção. Percorra a lista antes de fechar a Etapa 4.

## Segurança e dinheiro

| # | Armadilha | Correto |
|---|---|---|
| 1 | Webhook com `if (secret) { validar }`: sem o secret aceita qualquer notificação forjada (fail-open) | Sem secret → **401**. Falha fechada sempre |
| 2 | Webhook que **não valida** `x-signature` | Valide sempre. Sem isso qualquer um "aprova" um pagamento chamando sua URL |
| 3 | Confiar em `transaction_amount` vindo do Brick/cliente | Preço sempre recalculado no servidor |
| 4 | `body.empresa_id` / `padId` / `aluno_empresa_id` aceitos sem checar dono | Valide contra o usuário autenticado (`auth.getUser`) e contra o vínculo real no banco |
| 5 | Comparar a assinatura com `===` / `!==` | `timingSafeEqual` |
| 6 | Voltar das `back_urls` e liberar acesso | A volta do usuário **não prova pagamento**; só o webhook / `GET` prova |
| 7 | Access Token em variável pública (`NEXT_PUBLIC_*`) ou no repositório | Só a Public Key é pública |
| 8 | Logar e-mail/CPF/payload completo do pagador | Logue id, status, valor |
| 9 | `external_reference` com telefone/CPF | Use ids opacos (`app:<uuid>`) |
| 10 | Token OAuth de terceiros em texto simples legível por RLS | Só service role, criptografado |
| 11 | `state` do OAuth com dados em claro, ou reutilizável | Aleatório, guardado no servidor, uso único, expira (10 min) |

## Idempotência e concorrência

| # | Armadilha | Correto |
|---|---|---|
| 12 | `X-Idempotency-Key` com `Date.now()`/UUID novo a cada request | Chave determinística por intenção (`id` da linha local) |
| 13 | "select se já processou, senão insert" para deduplicar webhook | Índice único no Postgres decide a corrida |
| 14 | Índice único em `(topico, resource_id)` cobrindo eventos **já processados** | Descarta o 2º evento do mesmo recurso (ex.: `authorized` → `cancelled`). Lock só `where status = 'recebido'` |
| 15 | Webhook atualiza banco a partir do **payload** | `GET` do recurso e aplique o estado atual (reducer) |
| 16 | Comparar `last_modified` como **string** (offset `-04:00` × `+00:00`) | Compare por epoch (`getTime()`) |
| 17 | `update` numa linha que ainda não existe "funciona" e não grava nada | `upsert ... onConflict` |
| 18 | Duplo clique em "pagar" cria duas cobranças | Reaproveite a tentativa `pendente` (índice único parcial no banco) |
| 19 | Webhook responde sempre 200 mesmo em falha e ninguém reprocessa | Registre `erro` + job de reprocesso, ou devolva 5xx em falha transitória |

## Assinaturas

| # | Armadilha | Correto |
|---|---|---|
| 20 | `frequency_type: "years"` | Só `days`/`months`. Anual = `12 months`. O TS não acusa, quebra em runtime |
| 21 | `back_url` com `localhost` | MP rejeita. Omita em dev |
| 22 | Criar nova assinatura quando já existe ativa (cobra em dobro) | `PUT` no valor, ou cancelar a antiga antes e **abortar** se o cancelamento falhar |
| 23 | Esperar trocar o plano num preapproval existente | Não existe. Cancelar + criar. Avise que o ciclo atual não é devolvido |
| 24 | Acesso cortado no instante do `next_payment_date` | Folga de ~3 dias; MP tenta de novo antes de desistir |
| 25 | Acesso cortado quando o usuário cancela | O período já foi pago: acesso até `periodo_fim`; decida pela data, não pelo status |
| 26 | Webhook de cobrança recorrente reabrindo assinatura cancelada | `cancelada` é estado final |
| 27 | Webhook re-derivando `quantidade` do `external_reference` depois de um `PUT` de valor | O `external_reference` **não muda** com o `PUT`; marque "atualizado manualmente" e pare de derivar |
| 28 | Procurar cliente SDK de `/authorized_payments` | O SDK Node não tem; use `fetch` direto |
| 29 | Preço do plano espalhado (landing, tela, env, script) | **Catálogo único** importado por tudo. Divergência = site anuncia um preço e o MP cobra outro |
| 30 | Criar o plano em runtime a cada assinatura | Plano é catálogo: script de uso único, `plan_id` em env. Migrar assinantes entre planos é doloroso |
| 31 | Recriar plano "só para garantir" | Gera segundo `plan_id` para o mesmo preço e deixa assinantes presos a IDs diferentes |

## Multi-tenant / marketplace

| # | Armadilha | Correto |
|---|---|---|
| 32 | Webhook testa o token de **cada** tenant até um funcionar | `user_id` do corpo → conexão → token |
| 33 | Refresh falha e o código devolve o token velho em silêncio | Marque conexão expirada, peça reconexão |
| 34 | Mesmo gateway embutido em cada função | Adapter único (`chargePix`/`chargeCard`/`getStatus`) e **status normalizado**; facilita ter outro gateway depois |
| 35 | Trocar o provedor da empresa e quebrar cobranças pendentes | Grave o gateway **na cobrança** e use-o ao consultar status |
| 36 | Modo teste exige trocar credenciais na mão | Guarde pares `produção`/`teste` lado a lado + flag `modo`, com função única `getActiveAccessToken` |

## Operação

| # | Armadilha | Correto |
|---|---|---|
| 37 | Testar localmente esperando webhook | MP não alcança `localhost`; túnel ou preview |
| 38 | Esquecer que webhook de teste e de produção são configurações **separadas** (e secrets diferentes) | Cadastre os dois; secrets distintos por ambiente |
| 39 | Deixar credencial de produção configurada durante testes | Só na hora do go-live |
| 40 | Estado do acesso só na UI | Aplique o portão no **banco** (RLS / função `is_account_active`): a chave anon é pública e quem chama a API direto ignora a UI |
| 41 | Sem trilha de eventos | Tabela `mercadopago_eventos` com payload, status, erro: salva o suporte |
