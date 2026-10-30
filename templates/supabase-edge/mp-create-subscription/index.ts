// Cria assinatura mensal SEM plano (preço calculado por cliente) com checkout transparente.
//   supabase functions deploy mp-create-subscription
//
// Body: { card_token: string, extra_units?: number }
// Para preço fixo, prefira preapproval_plan (references/04-assinaturas.md, modo A).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { mpRequest, MpError } from '../_shared/mercadopago.ts';

const BASE_PRICE = 49.9; // venha de um catálogo/tabela; NUNCA do cliente

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const round2 = (n: number) => Math.round(n * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const user = (await userClient.auth.getUser()).data?.user;
    if (!user?.email) return json({ error: 'Não autenticado' }, 401);

    const { card_token, extra_units } = await req.json().catch(() => ({}));
    if (typeof card_token !== 'string' || !card_token) return json({ error: 'card_token obrigatório' }, 400);

    // Valida a quantidade: ela entra direto na conta do valor cobrado.
    const extra = Number.isInteger(extra_units) && extra_units >= 0 && extra_units <= 999 ? extra_units : 0;
    const amount = round2(BASE_PRICE * (1 + extra));

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const accountId = user.id; // ajuste se a "conta" não for o próprio usuário

    const { data: existing } = await admin.from('assinaturas').select('mp_preapproval_id, status').eq('account_id', accountId).maybeSingle();
    const { data: account } = await admin.from('accounts').select('trial_termina_em').eq('id', accountId).maybeSingle();

    // Já tem assinatura ativa? Só muda o valor (vale na PRÓXIMA cobrança). Criar outra cobraria em dobro.
    if (existing?.mp_preapproval_id) {
      const current = await mpRequest<any>(`/preapproval/${encodeURIComponent(existing.mp_preapproval_id)}`).catch(() => null);
      if (current?.status === 'authorized') {
        await mpRequest(`/preapproval/${encodeURIComponent(current.id)}`, {
          method: 'PUT',
          body: JSON.stringify({ auto_recurring: { transaction_amount: amount, currency_id: 'BRL' } }),
        });
        return json({ status: 'updated', amount });
      }
    }

    // Trial: primeira cobrança no futuro. O MP exige data FUTURA; com menos de 1 h restante, cobra na hora.
    const trialEnd = account?.trial_termina_em ? new Date(account.trial_termina_em) : null;
    const startDate = trialEnd && trialEnd.getTime() - Date.now() > 60 * 60 * 1000 ? trialEnd.toISOString() : null;

    const pre = await mpRequest<any>('/preapproval', {
      method: 'POST',
      body: JSON.stringify({
        reason: extra > 0 ? `MeuApp Premium + ${extra} extra(s)` : 'MeuApp Premium (mensal)',
        external_reference: `sub:${accountId}`,
        payer_email: user.email,
        card_token_id: card_token,
        status: 'authorized',
        notification_url: `${url}/functions/v1/mp-webhook`,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months', // só 'days' ou 'months'
          transaction_amount: amount,
          currency_id: 'BRL',
          ...(startDate ? { start_date: startDate } : {}),
        },
      }),
    });

    await admin.from('assinaturas').upsert(
      { account_id: accountId, mp_preapproval_id: pre.id, mp_payer_email: user.email, status: pre.status === 'authorized' ? 'autorizada' : 'pendente', valor: amount, criado_por: user.id },
      { onConflict: 'account_id' },
    );

    if (pre.status !== 'authorized') {
      return json({ error: 'Pagamento não autorizado. Confira os dados do cartão ou tente outro cartão.', status: pre.status }, 402);
    }
    // O webhook reaplica o estado completo (periodo_fim etc.) em seguida.
    return json({ status: pre.status, amount, first_charge: startDate });
  } catch (err) {
    console.error('[mp-create-subscription]', err instanceof MpError ? { status: err.status, details: err.details } : String(err));
    return json({ error: 'Erro ao criar assinatura' }, err instanceof MpError ? 502 : 500);
  }
});
