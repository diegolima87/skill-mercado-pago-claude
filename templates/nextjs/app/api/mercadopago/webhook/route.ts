import { NextResponse, after, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin'; // service role: rota pública, sem sessão de usuário
import { verifyWebhookSignature, InvalidWebhookSignatureError } from '@/lib/mercadopago/webhook';
import { decodeReference } from '@/lib/mercadopago/reference';
import { getPreapproval, getAuthorizedPayment } from '@/lib/mercadopago/subscription';
import { getPayment } from '@/lib/mercadopago/payments';
import { applySubscriptionState } from '@/lib/mercadopago/apply-subscription';

// Rota pública. Valida a assinatura, reivindica o evento no banco, responde
// rápido e faz o trabalho pesado DEPOIS da resposta (after()).
export const runtime = 'nodejs'; // precisa de crypto
export const maxDuration = 60;

type Admin = ReturnType<typeof createAdminClient>;
type WebhookBody = { type?: string; action?: string; data?: { id?: string | number } };

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as WebhookBody | null;

  // data.id vem na query string para pagamentos e no corpo para assinaturas.
  const dataId = String(request.nextUrl.searchParams.get('data.id') || body?.data?.id || '').toLowerCase();
  const topic = body?.type || request.nextUrl.searchParams.get('type') || '';
  const action = body?.action;
  const xSignature = request.headers.get('x-signature');
  const xRequestId = request.headers.get('x-request-id');

  const admin = createAdminClient();

  try {
    verifyWebhookSignature({ xSignature, xRequestId, dataId });
  } catch (err) {
    // Audita a tentativa e rejeita. NUNCA processa.
    await admin.from('mercadopago_eventos').insert({
      topico: topic || 'desconhecido',
      action,
      resource_id: dataId || 'desconhecido',
      x_request_id: xRequestId,
      assinatura_valida: false,
      payload: body,
      status: 'erro',
      erro: err instanceof InvalidWebhookSignatureError ? err.reason : String(err),
    });
    return NextResponse.json({ error: 'Assinatura inválida.' }, { status: 401 });
  }

  if (!dataId || !topic) return NextResponse.json({ ok: true }); // nada reconhecível, mas confirma recebimento

  // Reivindicação por INSERT: o índice único parcial (status = 'recebido')
  // resolve a corrida entre entregas simultâneas no Postgres, não em memória.
  const { data: event, error: claimError } = await admin
    .from('mercadopago_eventos')
    .insert({ topico: topic, action, resource_id: dataId, x_request_id: xRequestId, assinatura_valida: true, payload: body })
    .select('id')
    .single();

  // 23505 = outra entrega está processando este recurso agora. Confirma recebimento.
  if (claimError) return NextResponse.json({ ok: true });

  after(async () => {
    try {
      await processEvent(admin, topic, dataId);
      await admin
        .from('mercadopago_eventos')
        .update({ status: 'processado', processado_em: new Date().toISOString() })
        .eq('id', event.id);
    } catch (err) {
      await admin.from('mercadopago_eventos').update({ status: 'erro', erro: String(err) }).eq('id', event.id);
    }
  });

  return NextResponse.json({ ok: true });
}

/**
 * Todo caminho é um reducer sobre o RECURSO buscado por GET, nunca sobre o
 * payload do webhook (só traz um id). Quem chegar por último, o GET devolve o
 * estado real.
 */
async function processEvent(admin: Admin, topic: string, dataId: string): Promise<void> {
  if (topic === 'payment') {
    const payment = await getPayment(dataId);
    const ref = decodeReference(payment.external_reference);
    if (ref?.kind !== 'pay') return;

    const status =
      payment.status === 'approved' ? 'aprovado'
      : payment.status === 'rejected' ? 'rejeitado'
      : payment.status === 'cancelled' ? 'cancelado'
      : null; // pending / in_process: segue pendente
    if (!status) return;

    // Só sai de 'pendente': webhook repetido não reabre nem sobrescreve estado final.
    await admin
      .from('pagamentos')
      .update({ status, mp_payment_id: String(payment.id), updated_at: new Date().toISOString() })
      .eq('id', ref.paymentId)
      .eq('status', 'pendente');
    // TODO: efeitos de negócio idempotentes (liberar acesso, confirmar cupom) quando status === 'aprovado'.
    return;
  }

  if (topic === 'subscription_preapproval') {
    await applyBySubscriptionReference(admin, await getPreapproval(dataId));
    return;
  }

  if (topic === 'subscription_authorized_payment') {
    // Cada cobrança recorrente: descobre a assinatura e reaplica o estado ATUAL
    // (next_payment_date já avançado). É assim que periodo_fim avança todo ciclo.
    const charge = await getAuthorizedPayment(dataId);
    if (charge.preapproval_id) await applyBySubscriptionReference(admin, await getPreapproval(charge.preapproval_id));
  }
}

async function applyBySubscriptionReference(admin: Admin, preapproval: Awaited<ReturnType<typeof getPreapproval>>) {
  const ref = decodeReference(preapproval.external_reference);
  if (ref?.kind === 'sub') await applySubscriptionState(admin, ref.accountId, preapproval);
}
