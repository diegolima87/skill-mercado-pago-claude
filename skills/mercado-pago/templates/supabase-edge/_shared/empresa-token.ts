// Marketplace, passo 3: token válido da conta Mercado Pago conectada por uma empresa.
// Renova via refresh_token quando faltar pouco para expirar.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { oauthToken } from './mercadopago.ts';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export async function getEmpresaAccessToken(admin: SupabaseClient, empresaId: string): Promise<string | null> {
  const { data: conn } = await admin
    .from('mercadopago_conexoes')
    .select('access_token, refresh_token, token_expires_at, status')
    .eq('empresa_id', empresaId)
    .maybeSingle();
  if (!conn || conn.status === 'reautorizar') return null;

  if (new Date(conn.token_expires_at).getTime() - Date.now() > REFRESH_MARGIN_MS) return conn.access_token;

  try {
    const fresh = await oauthToken({ grant_type: 'refresh_token', refresh_token: conn.refresh_token });
    await admin
      .from('mercadopago_conexoes')
      .update({
        access_token: fresh.access_token,
        refresh_token: fresh.refresh_token ?? conn.refresh_token, // o refresh_token também gira
        token_expires_at: new Date(Date.now() + (fresh.expires_in ?? 0) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('empresa_id', empresaId);
    return fresh.access_token;
  } catch (err) {
    // NÃO devolva o token velho em silêncio: cobrar com token morto gera erro confuso.
    // Marque para reautorização e deixe a UI pedir a reconexão.
    console.error('[empresa-token] refresh falhou', empresaId, String(err));
    await admin.from('mercadopago_conexoes').update({ status: 'reautorizar' }).eq('empresa_id', empresaId);
    return null;
  }
}

/** Webhook de marketplace: o `user_id` do corpo identifica a conta MP do vendedor. */
export async function empresaIdFromMpUser(admin: SupabaseClient, mpUserId: string | number): Promise<string | null> {
  const { data } = await admin.from('mercadopago_conexoes').select('empresa_id').eq('mp_user_id', String(mpUserId)).maybeSingle();
  return data?.empresa_id ?? null;
}
