# 06 — Marketplace: cobrar na conta de terceiros (OAuth)

Use quando **cada cliente seu** (clínica, escola, empresa) recebe na **própria** conta Mercado Pago e você só orquestra.
✅ = usamos em produção · 📖 = documentação, não exercitado.

## Visão geral

```
Empresa clica "Conectar Mercado Pago"
  → seu backend cria um `state` aleatório (salvo no banco, com empresa e usuário)
  → devolve a URL de autorização do MP
  → empresa autoriza no MP
  → MP redireciona para seu /oauth-callback?code=...&state=...
  → backend valida state, troca code por access_token + refresh_token, salva por empresa
  → cobranças dessa empresa usam o token DELA
```

## Pré-requisito no painel (o usuário faz)

Na aplicação (não em Credenciais de teste): pegue **Client ID** e **Client Secret**, e cadastre o **Redirect URI**
(a URL pública da sua função de callback, idêntica à que você passa no código, caractere a caractere).

Variáveis: `MERCADOPAGO_CLIENT_ID`, `MERCADOPAGO_CLIENT_SECRET` (só servidor).

## 1) Iniciar a conexão ✅

Endpoint autenticado:

1. valide o usuário e que ele é **admin da empresa** que quer conectar (nunca confie em `empresaId` do corpo sem checar);
2. gere `state = crypto.randomUUID()` e grave `(state, empresa_id, usuario_id, created_at, used_at null)`;
3. devolva:

```
https://auth.mercadopago.com.br/authorization
  ?client_id=<CLIENT_ID>
  &response_type=code
  &platform_id=mp
  &redirect_uri=<REDIRECT_URI>
  &state=<state>
```

> ❌ Não use `state` que carregue dados em claro (JSON com `recipientId`/`returnUrl`): o cliente pode forjar.
> Use um valor opaco aleatório e guarde o contexto no servidor.

## 2) Callback ✅

Rota **pública** (é o navegador do usuário voltando do MP). Sequência:

1. se veio `error` → redirecione para o app com `mp=error&reason=denied`;
2. busque o `state` no banco: inexistente → `invalid_state`; `used_at` preenchido → `state_already_used`;
   mais de ~10 min → `state_expired`;
3. `POST https://api.mercadopago.com/oauth/token` com `{ client_id, client_secret, grant_type: "authorization_code", code, redirect_uri }`;
4. (opcional) `GET /users/me` com o novo token para guardar o e-mail da conta conectada;
5. `upsert` em `mercadopago_conexoes` (`onConflict: empresa_id`): `mp_user_id`, `access_token`, `refresh_token`, `public_key`, `token_expires_at`;
6. marque `used_at` no state **só depois** de salvar;
7. `302` de volta para o app com `mp=success`.

Redirecione sempre para uma URL fixa do **seu** app, nunca para uma URL vinda do request.

## 3) Usar o token da empresa e renová-lo ✅

Função única `getEmpresaAccessToken(empresaId)`:

```
se token_expires_at - agora > 5 min  → devolve access_token
senão → POST /oauth/token { client_id, client_secret, grant_type: "refresh_token", refresh_token }
        grava o NOVO access_token E o novo refresh_token (use `refreshed.refresh_token ?? atual`)
```

- Use o `expires_in` devolvido pelo MP para calcular a expiração. Não fixe uma duração no código.
- Se a renovação **falha**, não devolva o token velho em silêncio como fizemos em um projeto: marque a conexão como
  `expirada`/`reautorizar` e peça para a empresa reconectar. Cobrar com token morto gera erro confuso na ponta.
- Renove também em job agendado, não só sob demanda, para contas que ficam semanas sem cobrar.

## 4) Cobrar com o token da empresa ✅

Mesmas chamadas de [03](03-pagamento-unico.md), trocando o `Authorization: Bearer` pelo token da empresa.
A **Public Key** do Brick no front também precisa ser a da empresa conectada (`public_key` devolvida no OAuth) quando o cartão
é tokenizado para pagar naquela conta: tokens são válidos só dentro da conta que os gerou.

## 5) Webhook de marketplace ✅

A notificação do pagamento chega com `user_id` (conta MP do vendedor) no corpo. Para buscar o pagamento:

```
user_id → mercadopago_conexoes.mp_user_id → empresa → token da empresa → GET /v1/payments/{id}
```

Se não achar conexão, use o token da plataforma (pagamentos que você mesmo originou).
❌ Não percorra os tokens de todas as empresas até uma "dar certo".

## 6) Comissão da plataforma / split 📖

A API de pagamentos aceita `application_fee` no `POST /v1/payments` (e `marketplace_fee` nas preferências do Checkout Pro) quando a
cobrança usa o token OAuth do vendedor: o valor da comissão vai para a **sua** conta e o restante para o vendedor.
Em um dos nossos projetos a comissão (`platform_fee_percentage`) e o rateio interno entre médico/clínica/exame foram **apenas calculados e registrados**
no banco, sem enviar `application_fee` ao MP. Se você quer que o MP faça a retenção, envie o campo e **confirme as regras**
(limites, arredondamento, tarifas) na documentação oficial antes.

Calcule em centavos/inteiro ou arredonde a 2 casas de forma consistente: `Math.round(valor * pct) / 100`.

## Segurança

- `access_token`/`refresh_token` por empresa são credenciais de terceiros. Guarde em coluna **sem leitura via RLS pública**
  (só service role), idealmente criptografados (Supabase Vault / KMS). Já os mantivemos em texto simples: melhore.
- Permita **desconectar** (apaga tokens) e registre quem conectou (`conectado_por`).
- Nunca devolva o token ao navegador. O front só sabe "conectado: sim/não" + e-mail da conta.
