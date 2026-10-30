import { paymentClient } from './client';

/**
 * Pagamentos avulsos. REGRAS:
 *  - `amount` vem SEMPRE do servidor (catálogo/banco), nunca do cliente.
 *  - `idempotencyKey` é DETERMINÍSTICA por intenção de cobrança (ex.: o id da
 *    linha local em `pagamentos`). Com Date.now()/UUID novo a cada request a
 *    idempotência deixa de existir e um retry vira cobrança dupla.
 */

export interface Payer {
  email: string;
  firstName?: string;
  lastName?: string;
  identification?: { type: string; number: string };
}

export interface CreatePixInput {
  amount: number;
  description: string;
  payer: Payer;
  /** id da linha local; volta no webhook (`external_reference`). */
  externalReference: string;
  idempotencyKey: string;
  /** ISO 8601 com offset. Padrão do MP: 24 h. */
  expiresAt?: string;
}

export async function createPixPayment(input: CreatePixInput) {
  const payment = await paymentClient().create({
    body: {
      transaction_amount: input.amount,
      description: input.description,
      payment_method_id: 'pix',
      payer: {
        email: input.payer.email,
        first_name: input.payer.firstName,
        last_name: input.payer.lastName,
      },
      external_reference: input.externalReference,
      ...(input.expiresAt ? { date_of_expiration: input.expiresAt } : {}),
    },
    requestOptions: { idempotencyKey: input.idempotencyKey },
  });

  const tx = payment.point_of_interaction?.transaction_data;
  return {
    id: String(payment.id),
    status: payment.status,
    statusDetail: payment.status_detail,
    qrCode: tx?.qr_code ?? null, // copia-e-cola
    qrCodeBase64: tx?.qr_code_base64 ?? null, // <img src="data:image/png;base64,...">
    ticketUrl: tx?.ticket_url ?? null,
    expiresAt: payment.date_of_expiration ?? null,
  };
}

export interface CreateCardInput {
  amount: number;
  description: string;
  /** `formData.token` do Card Payment Brick. */
  token: string;
  paymentMethodId: string;
  issuerId?: string | number;
  installments?: number;
  payer: Payer;
  externalReference: string;
  idempotencyKey: string;
}

export async function createCardPayment(input: CreateCardInput) {
  const payment = await paymentClient().create({
    body: {
      transaction_amount: input.amount,
      description: input.description,
      token: input.token,
      payment_method_id: input.paymentMethodId,
      issuer_id: input.issuerId != null ? Number(input.issuerId) : undefined,
      installments: input.installments ?? 1,
      payer: { email: input.payer.email, identification: input.payer.identification },
      external_reference: input.externalReference,
    },
    requestOptions: { idempotencyKey: input.idempotencyKey },
  });

  return {
    id: String(payment.id),
    status: payment.status, // approved | in_process | pending | rejected | cancelled
    statusDetail: payment.status_detail, // ex.: cc_rejected_insufficient_amount, pending_challenge
    // 3DS: veja references/03-pagamento-unico.md
    threeDs: payment.three_ds_info ?? null,
  };
}

export async function getPayment(id: string | number) {
  return paymentClient().get({ id });
}
