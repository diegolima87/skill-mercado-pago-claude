import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth'; // → { user, accountId } ou { error: NextResponse }
import { createAdminClient } from '@/lib/supabase/admin';
import { createPreapproval, cancelPreapproval } from '@/lib/mercadopago/subscription';
import { applySubscriptionState } from '@/lib/mercadopago/apply-subscription';
import { encodeSubReference } from '@/lib/mercadopago/reference';
import { PLANS, isPlanKey, planIdFromEnv } from '@/lib/mercadopago/plans';

export const runtime = 'nodejs';

interface CardFormData {
  token: string;
  payer: { email: string };
}

export async function POST(request: Request) {
  const { tier, formData } = (await request.json().catch(() => ({}))) as { tier?: string; formData?: CardFormData };

  if (!isPlanKey(tier)) return NextResponse.json({ error: 'Plano inválido.' }, { status: 400 });
  if (!formData?.token || !formData.payer?.email) {
    return NextResponse.json({ error: 'Dados do cartão inválidos.' }, { status: 400 });
  }
  const plan = PLANS[tier];
  if (!plan.available) return NextResponse.json({ error: 'Plano indisponível.' }, { status: 400 });

  const gate = await requireUser();
  if (gate.error) return gate.error;
  const { user, accountId } = gate;
  const admin = createAdminClient();

  let planId: string;
  try {
    planId = planIdFromEnv(plan);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  // O MP não troca o plano de um preapproval existente: trocar de tier é
  // cancelar o antigo e criar outro. Se o cancelamento falhar, ABORTA, senão
  // o cliente é cobrado duas vezes.
  const { data: current } = await admin
    .from('assinaturas')
    .select('mp_preapproval_id, status, tier')
    .eq('account_id', accountId)
    .maybeSingle();

  if (current?.mp_preapproval_id && current.status !== 'cancelada' && current.tier !== tier) {
    try {
      await cancelPreapproval(current.mp_preapproval_id);
    } catch (err) {
      return NextResponse.json({ error: `Não foi possível trocar de plano: ${(err as Error).message}` }, { status: 502 });
    }
  }

  await admin
    .from('assinaturas')
    .upsert({ account_id: accountId, status: 'pendente', tier, criado_por: user.id }, { onConflict: 'account_id' });

  // O MP rejeita back_url com localhost: só manda com domínio público.
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  const backUrl = site && !site.includes('localhost') ? `${site}${plan.backPath}` : undefined;

  let preapproval;
  try {
    preapproval = await createPreapproval({
      planId,
      payerEmail: formData.payer.email,
      cardTokenId: formData.token,
      externalReference: encodeSubReference(accountId),
      backUrl,
    });
  } catch (err) {
    return NextResponse.json({ error: `Não foi possível processar o pagamento: ${(err as Error).message}` }, { status: 502 });
  }

  await admin
    .from('assinaturas')
    .update({ mp_preapproval_id: preapproval.id, mp_preapproval_plan_id: planId, mp_payer_email: formData.payer.email })
    .eq('account_id', accountId);

  // Libera na hora quando o MP já autorizou (caminho comum). O webhook chega
  // depois e reaplica o mesmo estado: o reducer é idempotente.
  if (preapproval.status === 'authorized') {
    await applySubscriptionState(admin, accountId, preapproval);
    return NextResponse.json({ ok: true, status: 'authorized' });
  }
  return NextResponse.json({ ok: true, status: preapproval.status || 'pending' });
}

export async function DELETE() {
  const gate = await requireUser();
  if (gate.error) return gate.error;
  const { accountId } = gate;
  const admin = createAdminClient();

  const { data: sub } = await admin.from('assinaturas').select('mp_preapproval_id').eq('account_id', accountId).maybeSingle();
  if (!sub?.mp_preapproval_id) return NextResponse.json({ error: 'Nenhuma assinatura encontrada.' }, { status: 404 });

  try {
    await cancelPreapproval(sub.mp_preapproval_id);
  } catch (err) {
    return NextResponse.json({ error: `Falha ao cancelar no Mercado Pago: ${(err as Error).message}` }, { status: 502 });
  }

  // O acesso continua até periodo_fim (período já pago). Quem decide acesso é
  // is_account_active(), não este status. O estado definitivo vem do webhook.
  await admin.from('assinaturas').update({ status: 'cancelada', cancelada_em: new Date().toISOString() }).eq('account_id', accountId);
  return NextResponse.json({ ok: true });
}
