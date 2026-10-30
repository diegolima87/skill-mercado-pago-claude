// Cria cobrança avulsa (Pix ou cartão). Chamada pelo front com o JWT do usuário.
//   supabase functions deploy mp-create-payment
//
// Body: { type: 'pix' | 'card', item_id: string, card?: { token, payment_method_id, issuer_id?, installments?, payer? } }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { mpRequest, MpError } from '../_shared/mercadopago.ts';

const cors = {
  'Access-Control-Allow-Origin': '*', // restrinja ao(s) seu(s) domínio(s) em produção
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    // Autentica o usuário a partir do JWT (nunca confie em user_id do corpo).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: 'Não autenticado' }, 401);

    const { type, item_id, card } = await req.json();
    if ((type !== 'pix' && type !== 'card') || !item_id) return json({ error: 'type e item_id são obrigatórios' }, 400);
    if (type === 'card' && (!card?.token || !card?.payment_method_id)) return json({ error: 'Dados do cartão incompletos' }, 400);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Preço do SERVIDOR.
    const { data: item } = await admin.from('itens').select('id, titulo, preco').eq('id', item_id).maybeSingle();
    if (!item || Number(item.preco) <= 0) return json({ error: 'Item inválido' }, 404);

    // Reaproveita tentativa pendente (índice único parcial no banco).
    let { data: pagamento } = await admin.from('pagamentos').select('id, valor').eq('user_id', user.id).eq('item_id', item.id).eq('status', 'pendente').maybeSingle();
    if (!pagamento) {
      const { data, error } = await admin.from('pagamentos').insert({ user_id: user.id, item_id: item.id, valor: item.preco, metodo: type }).select('id, valor').single();
      if (error || !data) return json({ error: 'Erro ao iniciar pagamento' }, 500);
      pagamento = data;
    }

    const body: Record<string, unknown> = {
      transaction_amount: Number(pagamento.valor),
      description: item.titulo,
      external_reference: `pay:${pagamento.id}`,
    };
    if (type === 'pix') {
      body.payment_method_id = 'pix';
      body.payer = { email: user.email };
    } else {
      Object.assign(body, {
        token: card.token,
        payment_method_id: card.payment_method_id,
        issuer_id: card.issuer_id,
        installments: card.installments ?? 1,
        payer: { email: card.payer?.email ?? user.email, identification: card.payer?.identification },
      });
    }

    // Chave DETERMINÍSTICA por intenção (id da linha local), nunca Date.now()/UUID por request.
    const payment = await mpRequest<any>('/v1/payments', {
      method: 'POST',
      idempotencyKey: `${type}-${pagamento.id}`,
      body: JSON.stringify(body),
    });

    await admin.from('pagamentos').update({ mp_payment_id: String(payment.id) }).eq('id', pagamento.id);

    const tx = payment.point_of_interaction?.transaction_data;
    return json({
      payment_id: pagamento.id,
      status: payment.status,
      status_detail: payment.status_detail,
      qr_code: tx?.qr_code ?? null,
      qr_code_base64: tx?.qr_code_base64 ?? null,
      expires_at: payment.date_of_expiration ?? null,
    });
  } catch (err) {
    console.error('[mp-create-payment]', err instanceof MpError ? { status: err.status, details: err.details } : String(err));
    return json({ error: 'Erro ao processar pagamento' }, err instanceof MpError ? 502 : 500);
  }
});
