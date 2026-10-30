// Tipos e helper compartilhados pelos Bricks. O SDK JS vem de
// https://sdk.mercadopago.com/js/v2 (carregado por <Script> ou por loadMercadoPagoSdk).

export interface BrickController {
  unmount: () => void;
}

export interface MercadoPagoInstance {
  bricks: () => {
    create: (type: string, containerId: string, settings: Record<string, unknown>) => Promise<BrickController>;
  };
}

declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, options?: { locale?: string }) => MercadoPagoInstance;
  }
}

/** Formato exato do `onSubmit` do Card Payment Brick. O cartão já foi
 * tokenizado no navegador (nunca passa pelo seu servidor). Ignore
 * `transaction_amount` no backend: o preço vem do servidor. */
export interface CardPaymentFormData {
  token: string;
  issuer_id?: string | number;
  payment_method_id: string;
  transaction_amount: number;
  installments: number;
  payer: {
    email: string;
    identification?: { type?: string; number?: string };
  };
}

export const MP_PUBLIC_KEY = process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY ?? '';
