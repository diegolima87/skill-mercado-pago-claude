import { preApprovalClient, getAccessToken } from './client';

export interface CreatePreapprovalInput {
  /** preapproval_plan_id criado fora do runtime por scripts/mp-plan.ts. */
  planId: string;
  payerEmail: string;
  /** Token gerado pelo Card Payment Brick no navegador. */
  cardTokenId: string;
  externalReference: string;
  /** O MP rejeita back_url apontando para localhost: só passe com domínio público. */
  backUrl?: string;
}

/**
 * Cria a assinatura já AUTORIZADA (sem redirect). O valor cobrado vem do
 * PLANO; o card_token_id só autoriza a cobrança recorrente, então não há
 * superfície para o cliente adulterar o preço.
 */
export async function createPreapproval({ planId, payerEmail, cardTokenId, externalReference, backUrl }: CreatePreapprovalInput) {
  return preApprovalClient().create({
    body: {
      preapproval_plan_id: planId,
      payer_email: payerEmail,
      card_token_id: cardTokenId,
      external_reference: externalReference,
      ...(backUrl ? { back_url: backUrl } : {}),
      status: 'authorized',
    },
  });
}

export const getPreapproval = (id: string) => preApprovalClient().get({ id });

/**
 * Cancela no MP. O status local só vira 'cancelada' de forma definitiva quando
 * o webhook subscription_preapproval confirmar. O acesso continua até
 * `periodo_fim` (período já pago).
 */
export const cancelPreapproval = (id: string) =>
  preApprovalClient().update({ id, body: { status: 'cancelled' } });

/** Muda só o valor da mensalidade; vale a partir da PRÓXIMA cobrança. */
export const updatePreapprovalAmount = (id: string, amount: number) =>
  preApprovalClient().update({ id, body: { auto_recurring: { transaction_amount: amount, currency_id: 'BRL' } } });

export interface AuthorizedPayment {
  id?: string;
  preapproval_id?: string;
  status?: string; // 'processed' = cobrança paga
}

/**
 * O SDK Node NÃO tem cliente para /authorized_payments (cada cobrança
 * recorrente dentro de uma assinatura): chamada REST direta. Usada no webhook
 * subscription_authorized_payment para descobrir a QUAL preapproval a cobrança
 * pertence.
 */
export async function getAuthorizedPayment(id: string): Promise<AuthorizedPayment> {
  const res = await fetch(`https://api.mercadopago.com/authorized_payments/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
  });
  if (!res.ok) throw new Error(`Falha ao buscar authorized_payment ${id}: HTTP ${res.status}`);
  return res.json();
}
