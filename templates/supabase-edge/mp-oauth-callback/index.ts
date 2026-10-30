// Marketplace, passo 2: callback do OAuth (o navegador do usuário volta do Mercado Pago).
//   supabase functions deploy mp-oauth-callback --no-verify-jwt
//
// Secrets: MERCADOPAGO_CLIENT_ID, MERCADOPAGO_CLIENT_SECRET, MP_OAUTH_REDIRECT_URI, APP_RETURN_URL
//   APP_RETURN_URL = página FIXA do seu app (ex.: https://seuapp.com.br/configuracoes/pagamentos).
//   Nunca redirecione para uma URL vinda do request.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { oauthToken, mpRequest } from '../_shared/mercadopago.ts';

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function back(params: Record<string, string>) {
  const target = new URL(Deno.env.get('APP_RETURN_URL')!);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { Location: target.toString() } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (url.searchParams.get('error')) return back({ mp: 'error', reason: 'denied' });
  if (!code || !state) return back({ mp: 'error', reason: 'missing_params' });

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: row } = await admin.from('mp_oauth_states').select('empresa_id, usuario_id, created_at, used_at').eq('state', state).maybeSingle();
    if (!row) return back({ mp: 'error', reason: 'invalid_state' });
    if (row.used_at) return back({ mp: 'error', reason: 'state_already_used' });
    if (Date.now() - new Date(row.created_at).getTime() > STATE_MAX_AGE_MS) return back({ mp: 'error', reason: 'state_expired' });

    const tokens = await oauthToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: Deno.env.get('MP_OAUTH_REDIRECT_URI')!,
    });

    // Best-effort: e-mail da conta conectada (não bloqueia a conexão).
    let email: string | null = null;
    try {
      email = (await mpRequest<any>('/users/me', { token: tokens.access_token })).email ?? null;
    } catch (_) { /* ignora */ }

    const { error } = await admin.from('mercadopago_conexoes').upsert(
      {
        empresa_id: row.empresa_id,
        mp_user_id: String(tokens.user_id),
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        public_key: tokens.public_key ?? null,
        email,
        token_expires_at: new Date(Date.now() + (tokens.expires_in ?? 0) * 1000).toISOString(),
        status: 'conectado',
        conectado_por: row.usuario_id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'empresa_id' },
    );
    if (error) return back({ mp: 'error', reason: 'save_failed' });

    // Só marca o state como usado DEPOIS de salvar.
    await admin.from('mp_oauth_states').update({ used_at: new Date().toISOString() }).eq('state', state);
    return back({ mp: 'success' });
  } catch (err) {
    console.error('[mp-oauth-callback]', String(err));
    return back({ mp: 'error', reason: 'unexpected' });
  }
});
