import type { SupabaseClient } from '@supabase/supabase-js';

type LocalStatus = 'pendente' | 'autorizada' | 'pausada' | 'cancelada';

function toLocalStatus(mpStatus: string | undefined): LocalStatus {
  if (mpStatus === 'authorized') return 'autorizada';
  if (mpStatus === 'paused') return 'pausada';
  if (mpStatus === 'cancelled') return 'cancelada';
  return 'pendente';
}

/** Subconjunto do recurso preapproval que usamos (o SDK não exporta o tipo). */
export interface PreapprovalResource {
  id?: string;
  status?: string;
  payer_email?: string;
  /** `last_modified` no preapproval (em payments o nome é `date_last_updated`). */
  last_modified?: string;
  next_payment_date?: string;
  auto_recurring?: { transaction_amount?: number; currency_id?: string };
}

const GRACE_MS = 3 * 24 * 60 * 60 * 1000; // folga: o MP tenta de novo antes de desistir

/**
 * Aplica o estado ATUAL de um preapproval (sempre vindo de um GET, nunca do
 * payload do webhook, que só traz um id). É um reducer sobre o RECURSO, não
 * sobre o evento: notificação fora de ordem e reprocessamento se resolvem
 * sozinhos, pois aplicar o mesmo estado duas vezes dá o mesmo resultado.
 */
export async function applySubscriptionState(
  admin: SupabaseClient,
  accountId: string,
  resource: PreapprovalResource,
  onAuthorized?: (admin: SupabaseClient, accountId: string, now: string) => Promise<void>,
): Promise<void> {
  const { data: current } = await admin
    .from('assinaturas')
    .select('mp_atualizado_em')
    .eq('account_id', accountId)
    .maybeSingle();

  // Compare por EPOCH, não por string: o MP devolve com offset local (-04:00) e
  // o PostgREST normaliza para UTC (+00:00). Como texto, descarta evento novo
  // achando que é velho.
  if (current?.mp_atualizado_em && resource.last_modified) {
    const arrived = new Date(resource.last_modified).getTime();
    const applied = new Date(current.mp_atualizado_em).getTime();
    if (Number.isFinite(arrived) && Number.isFinite(applied) && arrived <= applied) return;
  }

  const status = toLocalStatus(resource.status);
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    account_id: accountId,
    mp_preapproval_id: resource.id ?? null,
    mp_payer_email: resource.payer_email ?? null,
    status,
    valor: resource.auto_recurring?.transaction_amount ?? 0,
    moeda: resource.auto_recurring?.currency_id ?? 'BRL',
    mp_atualizado_em: resource.last_modified ?? null,
  };

  if (status === 'autorizada') {
    if (resource.next_payment_date) {
      const next = new Date(resource.next_payment_date);
      patch.proxima_cobranca_em = next.toISOString();
      patch.periodo_fim = new Date(next.getTime() + GRACE_MS).toISOString();
    }
    patch.ultimo_pagamento_em = now;
  }
  if (status === 'cancelada') patch.cancelada_em = now;
  // Cancelada NÃO apaga periodo_fim: o período já foi pago.

  // upsert, não update: update numa linha inexistente afeta zero linhas e
  // retorna sucesso, o webhook "funcionaria" sem gravar nada.
  const { error } = await admin.from('assinaturas').upsert(patch, { onConflict: 'account_id' });
  if (error) throw new Error(`Falha ao gravar assinatura: ${error.message}`);

  if (status === 'autorizada' && onAuthorized) await onAuthorized(admin, accountId, now);
}
