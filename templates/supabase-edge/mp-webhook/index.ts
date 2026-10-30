// Webhook do Mercado Pago (Supabase Edge Function).
//
// Deploy SEM verificação de JWT (o MP não manda JWT):
//   supabase functions deploy mp-webhook --no-verify-jwt
// URL para cadastrar no painel:
//   https://<project-ref>.supabase.co/functions/v1/mp-webhook
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyWebhookSignature, getPayment, getPreapproval, getAuthorizedPayment } from '../_shared/mercadopago.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true });

  const body = await req.json().catch(() => null);
  const url = new URL(req.url);
  const dataId = String(url.searchParams.get('data.id') || body?.data?.id || '').toLowerCase();
  const topic: string = body?.type || url.searchParams.get('type') || '';

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // 1) Assinatura válida (falha fechada). Senão 401 e NÃO processa.
  if (!(await verifyWebhookSignature(req, dataId))) {
    await admin.from('mercadopago_eventos').insert({
      topico: topic || 'desconhecido',
      action: body?.action,
      resource_id: dataId || 'desconhecido',
      x_request_id: req.headers.get('x-request-id'),
      assinatura_valida: false,
      payload: body,
      status: 'erro',
      erro: 'assinatura inválida',
    });
    return json({ error: 'invalid signature' }, 401);
  }
  if (!dataId || !topic) return json({ ok: true });

  // 2) Reivindica o evento (índice único parcial: status = 'recebido').
  const { data: event, error: claimError } = await admin
    .from('mercadopago_eventos')
    .insert({ topico: topic, action: body?.action, resource_id: dataId, x_request_id: req.headers.get('x-request-id'), payload: body })
    .select('id')
    .single();
  if (claimError) return json({ ok: true }); // outra entrega está processando

  // 3) Processa depois de responder.
  const work = (async () => {
    try {
      await processEvent(admin, topic, dataId, body?.user_id);
      await admin.from('mercadopago_eventos').update({ status: 'processado', processado_em: new Date().toISOString() }).eq('id', event.id);
    } catch (err) {
      console.error('[mp-webhook] erro', topic, dataId, String(err));
      await admin.from('mercadopago_eventos').update({ status: 'erro', erro: String(err) }).eq('id', event.id);
    }
  })();
  // @ts-ignore EdgeRuntime existe no runtime do Supabase
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work);
  else await work;

  return json({ ok: true });
});

type Admin = SupabaseClient;

/** Reducer sobre o RECURSO (GET), nunca sobre o payload do webhook. */
async function processEvent(admin: Admin, topic: string, dataId: string, _notifierUserId?: number) {
  // Marketplace: aqui você resolveria o token do vendedor a partir de `_notifierUserId`
  // (mercadopago_conexoes.mp_user_id). Veja references/06-marketplace-oauth.md.
  const token = undefined;

  if (topic === 'payment') {
    const payment = await getPayment(dataId, token);
    const ref: string | undefined = payment.external_reference; // 'pay:<id local>'
    if (!ref?.startsWith('pay:')) return;
    const status =
      payment.status === 'approved' ? 'aprovado'
      : payment.status === 'rejected' ? 'rejeitado'
      : payment.status === 'cancelled' ? 'cancelado'
      : null;
    if (!status) return;
    await admin
      .from('pagamentos')
      .update({ status, mp_payment_id: String(payment.id), updated_at: new Date().toISOString() })
      .eq('id', ref.slice(4))
      .eq('status', 'pendente'); // só sai de pendente: repetição não sobrescreve estado final
    // TODO: efeitos de negócio idempotentes quando 'aprovado'.
    return;
  }

  if (topic === 'subscription_preapproval') {
    await applyPreapproval(admin, await getPreapproval(dataId, token));
    return;
  }

  if (topic === 'subscription_authorized_payment') {
    const charge = await getAuthorizedPayment(dataId, token);
    if (charge.preapproval_id) await applyPreapproval(admin, await getPreapproval(charge.preapproval_id, token));
  }
}

async function applyPreapproval(admin: Admin, pre: any) {
  const ref: string | undefined = pre.external_reference; // 'sub:<accountId>'
  if (!ref?.startsWith('sub:')) return;
  const accountId = ref.slice(4);

  // Evento mais antigo que o estado já aplicado? Ignora (compare por EPOCH, não string).
  const { data: current } = await admin.from('assinaturas').select('mp_atualizado_em').eq('account_id', accountId).maybeSingle();
  if (current?.mp_atualizado_em && pre.last_modified) {
    const arrived = new Date(pre.last_modified).getTime();
    const applied = new Date(current.mp_atualizado_em).getTime();
    if (Number.isFinite(arrived) && Number.isFinite(applied) && arrived <= applied) return;
  }

  const status = pre.status === 'authorized' ? 'autorizada' : pre.status === 'paused' ? 'pausada' : pre.status === 'cancelled' ? 'cancelada' : 'pendente';
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    account_id: accountId,
    mp_preapproval_id: pre.id,
    mp_payer_email: pre.payer_email ?? null,
    status,
    valor: pre.auto_recurring?.transaction_amount ?? 0,
    moeda: pre.auto_recurring?.currency_id ?? 'BRL',
    mp_atualizado_em: pre.last_modified ?? null,
  };
  if (status === 'autorizada') {
    if (pre.next_payment_date) {
      const next = new Date(pre.next_payment_date);
      patch.proxima_cobranca_em = next.toISOString();
      patch.periodo_fim = new Date(next.getTime() + GRACE_MS).toISOString();
    }
    patch.ultimo_pagamento_em = now;
  }
  if (status === 'cancelada') patch.cancelada_em = now; // NÃO apaga periodo_fim: período já pago

  // upsert, não update: update em linha inexistente "funciona" sem gravar nada.
  const { error } = await admin.from('assinaturas').upsert(patch, { onConflict: 'account_id' });
  if (error) throw new Error(error.message);
}
