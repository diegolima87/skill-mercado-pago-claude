/**
 * `external_reference` carrega o que o webhook precisa para saber o que ativar.
 * Use ids opacos (uuid): o campo aparece nos painéis e logs do Mercado Pago,
 * então nunca coloque telefone, CPF ou e-mail aqui.
 *
 *   sub:<accountId>   → assinatura da conta
 *   pay:<pagamentoId> → pagamento avulso (id da linha local)
 */
export type Reference =
  | { kind: 'sub'; accountId: string }
  | { kind: 'pay'; paymentId: string };

export const encodeSubReference = (accountId: string) => `sub:${accountId}`;
export const encodePayReference = (paymentId: string) => `pay:${paymentId}`;

export function decodeReference(raw: string | null | undefined): Reference | null {
  if (!raw) return null;
  const [kind, id, ...rest] = raw.split(':');
  if (!id || rest.length) return null;
  if (kind === 'sub') return { kind: 'sub', accountId: id };
  if (kind === 'pay') return { kind: 'pay', paymentId: id };
  return null;
}
