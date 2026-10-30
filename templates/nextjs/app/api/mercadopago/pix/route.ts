import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createPixPayment } from '@/lib/mercadopago/payments';
import { encodePayReference } from '@/lib/mercadopago/reference';

export const runtime = 'nodejs';

/**
 * Cria cobrança Pix para um item.
 * Ordem: (1) valida usuário, (2) preço do SERVIDOR, (3) linha local PENDENTE,
 * (4) chama o MP com idempotência determinística, (5) devolve o QR.
 */
export async function POST(request: Request) {
  const { itemId } = (await request.json().catch(() => ({}))) as { itemId?: string };
  if (!itemId) return NextResponse.json({ error: 'itemId obrigatório.' }, { status: 400 });

  const gate = await requireUser();
  if (gate.error) return gate.error;
  const { user } = gate;
  const admin = createAdminClient();

  // Preço sempre do banco/catálogo; nunca do corpo do request.
  const { data: item } = await admin.from('itens').select('id, titulo, preco').eq('id', itemId).maybeSingle();
  if (!item || Number(item.preco) <= 0) return NextResponse.json({ error: 'Item inválido.' }, { status: 404 });

  // Reaproveita a tentativa pendente (índice único parcial garante 1 por usuário/item).
  let { data: pagamento } = await admin
    .from('pagamentos')
    .select('id, valor')
    .eq('user_id', user.id)
    .eq('item_id', item.id)
    .eq('status', 'pendente')
    .maybeSingle();

  if (!pagamento) {
    const { data, error } = await admin
      .from('pagamentos')
      .insert({ user_id: user.id, item_id: item.id, valor: item.preco, metodo: 'pix' })
      .select('id, valor')
      .single();
    if (error || !data) return NextResponse.json({ error: 'Erro ao iniciar pagamento.' }, { status: 500 });
    pagamento = data;
  }

  try {
    const pix = await createPixPayment({
      amount: Number(pagamento.valor),
      description: item.titulo,
      payer: { email: user.email! },
      externalReference: encodePayReference(pagamento.id),
      idempotencyKey: `pix-${pagamento.id}`, // determinística: retry devolve o MESMO pagamento
    });

    await admin.from('pagamentos').update({ mp_payment_id: pix.id }).eq('id', pagamento.id);
    return NextResponse.json({ paymentId: pagamento.id, qrCode: pix.qrCode, qrCodeBase64: pix.qrCodeBase64, expiresAt: pix.expiresAt });
  } catch (err) {
    return NextResponse.json({ error: `Erro ao criar Pix: ${(err as Error).message}` }, { status: 502 });
  }
}

/** Polling do front: consulta a linha LOCAL (quem a atualiza é o webhook). */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  const gate = await requireUser();
  if (gate.error) return gate.error;
  if (!id) return NextResponse.json({ error: 'id obrigatório.' }, { status: 400 });

  const admin = createAdminClient();
  const { data } = await admin.from('pagamentos').select('status').eq('id', id).eq('user_id', gate.user.id).maybeSingle();
  return NextResponse.json({ status: data?.status ?? 'desconhecido' });
}
