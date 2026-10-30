// Helpers do Mercado Pago para Supabase Edge Functions (Deno), sem SDK:
// fetch direto + validação de webhook com crypto.subtle.
//
// Secrets (supabase secrets set ...):
//   MERCADOPAGO_ACCESS_TOKEN, MERCADOPAGO_WEBHOOK_SECRET
//   (marketplace) MERCADOPAGO_CLIENT_ID, MERCADOPAGO_CLIENT_SECRET
const MP_API = 'https://api.mercadopago.com';

export function accessToken(): string {
  const t = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');
  if (!t) throw new Error('MERCADOPAGO_ACCESS_TOKEN não configurado.');
  return t;
}

export class MpError extends Error {
  constructor(message: string, public status: number, public details: unknown) {
    super(message);
  }
}

/** Chamada à API. `token` permite usar o token de outro vendedor (marketplace). */
export async function mpRequest<T>(
  path: string,
  init: RequestInit & { token?: string; idempotencyKey?: string } = {},
): Promise<T> {
  const { token, idempotencyKey, headers, ...rest } = init;
  const res = await fetch(`${MP_API}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token ?? accessToken()}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
      ...(headers ?? {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new MpError(`Mercado Pago ${res.status}`, res.status, data);
  return data as T;
}

export const getPayment = (id: string, token?: string) => mpRequest<any>(`/v1/payments/${encodeURIComponent(id)}`, { token });
export const getPreapproval = (id: string, token?: string) => mpRequest<any>(`/preapproval/${encodeURIComponent(id)}`, { token });
export const getAuthorizedPayment = (id: string, token?: string) => mpRequest<any>(`/authorized_payments/${encodeURIComponent(id)}`, { token });

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Comparação em tempo constante de duas strings hex. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Valida `x-signature` (ts=...,v1=...) do webhook.
 * HMAC-SHA256 de "id:<data.id minúsculo>;request-id:<x-request-id>;ts:<ts>;".
 *
 * Falha FECHADA: sem MERCADOPAGO_WEBHOOK_SECRET devolve false (o caller
 * responde 401). Rejeita ts fora da tolerância (replay).
 */
export async function verifyWebhookSignature(req: Request, dataId: string, toleranceSeconds = 300): Promise<boolean> {
  const secret = Deno.env.get('MERCADOPAGO_WEBHOOK_SECRET');
  if (!secret) return false;

  const signature = req.headers.get('x-signature') ?? '';
  const requestId = req.headers.get('x-request-id') ?? '';
  const parts: Record<string, string> = {};
  for (const kv of signature.split(',')) {
    const [k, v] = kv.trim().split('=');
    if (k && v) parts[k] = v;
  }
  if (!parts.ts || !parts.v1) return false;

  // `ts` do MP pode vir em segundos ou milissegundos.
  const tsNum = Number(parts.ts);
  const tsMs = tsNum > 1e12 ? tsNum : tsNum * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > toleranceSeconds * 1000) return false;

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const mac = toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest)));
  return safeEqual(mac, parts.v1);
}

// ---------------------------------------------------------------------------
// OAuth (marketplace)
// ---------------------------------------------------------------------------

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
  public_key?: string;
}

export async function oauthToken(params: Record<string, string>): Promise<OAuthTokens> {
  const clientId = Deno.env.get('MERCADOPAGO_CLIENT_ID');
  const clientSecret = Deno.env.get('MERCADOPAGO_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('MERCADOPAGO_CLIENT_ID/CLIENT_SECRET não configurados.');
  return mpRequest<OAuthTokens>('/oauth/token', {
    method: 'POST',
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...params }),
  });
}
