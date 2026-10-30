// Marketplace, passo 1: gera a URL de autorização para a empresa conectar a conta Mercado Pago.
//   supabase functions deploy mp-oauth-connect
//
// Secrets: MERCADOPAGO_CLIENT_ID, MP_OAUTH_REDIRECT_URI
//   (MP_OAUTH_REDIRECT_URI = https://<project-ref>.supabase.co/functions/v1/mp-oauth-callback,
//    idêntica, caractere a caractere, à cadastrada na aplicação no painel do MP)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    const clientId = Deno.env.get('MERCADOPAGO_CLIENT_ID');
    const redirectUri = Deno.env.get('MP_OAUTH_REDIRECT_URI');
    if (!clientId || !redirectUri) throw new Error('MERCADOPAGO_CLIENT_ID / MP_OAUTH_REDIRECT_URI não configurados');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const user = (await userClient.auth.getUser()).data?.user;
    if (!user) return json({ error: 'Não autenticado' }, 401);

    const { empresaId } = await req.json();
    if (!empresaId) return json({ error: 'empresaId é obrigatório' }, 400);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Só admin DA empresa conecta a conta dela. Ajuste ao seu modelo de permissão.
    const { data: isAdmin } = await admin.rpc('is_empresa_admin', { _user_id: user.id, _empresa_id: empresaId });
    if (!isAdmin) return json({ error: 'Acesso negado' }, 403);

    // state opaco, aleatório, de uso único: o contexto fica no servidor.
    const state = crypto.randomUUID();
    const { error } = await admin.from('mp_oauth_states').insert({ state, empresa_id: empresaId, usuario_id: user.id });
    if (error) throw new Error('Erro ao iniciar conexão');

    const authorize = new URL('https://auth.mercadopago.com.br/authorization');
    authorize.searchParams.set('client_id', clientId);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('platform_id', 'mp');
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('state', state);

    return json({ url: authorize.toString() });
  } catch (err) {
    console.error('[mp-oauth-connect]', String(err));
    return json({ error: 'Erro ao iniciar conexão' }, 500);
  }
});
