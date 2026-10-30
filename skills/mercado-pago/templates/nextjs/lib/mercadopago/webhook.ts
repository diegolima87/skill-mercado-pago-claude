import { WebhookSignatureValidator, InvalidWebhookSignatureError } from 'mercadopago';

export { InvalidWebhookSignatureError };

export interface VerifyWebhookInput {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
}

/**
 * Valida a assinatura do webhook com o validador oficial do SDK (tempo
 * constante, tolerância de timestamp). Lança InvalidWebhookSignatureError se
 * inválida: o caller responde 401 e NUNCA processa o evento.
 *
 * Falha FECHADA: sem MERCADOPAGO_WEBHOOK_SECRET lança erro (não "pula" a
 * validação). A versão `if (secret) { validar }` aceita qualquer evento forjado.
 */
export function verifyWebhookSignature({ xSignature, xRequestId, dataId }: VerifyWebhookInput): void {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) throw new Error('MERCADOPAGO_WEBHOOK_SECRET não configurado.');

  WebhookSignatureValidator.validate({
    xSignature,
    xRequestId,
    dataId,
    secret,
    toleranceSeconds: 300, // 5 min: mitiga replay sem exigir relógio perfeito
  });
}
