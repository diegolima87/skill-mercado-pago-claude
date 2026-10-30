'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Script from 'next/script';
import { MP_PUBLIC_KEY, type BrickController, type CardPaymentFormData } from './mercadopago-sdk';

export interface CardPaymentBrickProps {
  /** Valor exibido no formulário: puramente informativo. O que é cobrado é
   * sempre recalculado no servidor. */
  amount: number;
  payerEmail?: string;
  /** Deve devolver a Promise do backend. Se rejeitar, o Brick mostra o erro e
   * deixa o usuário tentar de novo. */
  onSubmit: (formData: CardPaymentFormData) => Promise<void>;
  onError?: (message: string) => void;
}

/** Formulário de cartão embutido (checkout transparente). O SDK tokeniza o
 * cartão num iframe próprio: número e CVV nunca passam pelo seu servidor nem
 * pelo seu DOM, só o token resultante vai ao backend. */
export function CardPaymentBrick({ amount, payerEmail, onSubmit, onError }: CardPaymentBrickProps) {
  const containerId = `mp-card-brick-${useId().replace(/[^a-zA-Z0-9]/g, '')}`; // id único por instância
  const controllerRef = useRef<BrickController | null>(null);
  const [sdkReady, setSdkReady] = useState(false);

  // Callbacks por ref: trocar a função não deve remontar o Brick.
  const onSubmitRef = useRef(onSubmit);
  const onErrorRef = useRef(onError);
  onSubmitRef.current = onSubmit;
  onErrorRef.current = onError;

  useEffect(() => {
    if (typeof window !== 'undefined' && window.MercadoPago) setSdkReady(true);
  }, []);

  useEffect(() => {
    if (!sdkReady || !window.MercadoPago) return;
    if (!MP_PUBLIC_KEY) {
      onErrorRef.current?.('Pagamento não configurado (chave pública do Mercado Pago ausente).');
      return;
    }

    const mp = new window.MercadoPago(MP_PUBLIC_KEY, { locale: 'pt-BR' });
    let cancelled = false;

    mp.bricks()
      .create('cardPayment', containerId, {
        initialization: { amount, payer: payerEmail ? { email: payerEmail } : undefined },
        customization: { paymentMethods: { minInstallments: 1, maxInstallments: 1 } },
        callbacks: {
          onReady: () => {},
          onSubmit: (formData: CardPaymentFormData) =>
            onSubmitRef.current(formData).catch((err) => {
              onErrorRef.current?.(err instanceof Error ? err.message : 'Não foi possível processar o pagamento.');
              return Promise.reject(err);
            }),
          onError: (error: unknown) => {
            console.error('[CardPaymentBrick]', error);
            onErrorRef.current?.('Erro no formulário de pagamento. Confira os dados do cartão.');
          },
        },
      })
      .then((controller) => {
        // O efeito pode ter sido desfeito antes de o create() resolver.
        if (cancelled) controller.unmount();
        else controllerRef.current = controller;
      });

    return () => {
      cancelled = true;
      controllerRef.current?.unmount();
      controllerRef.current = null;
    };
  }, [sdkReady, amount, payerEmail, containerId]);

  return (
    <>
      <Script src="https://sdk.mercadopago.com/js/v2" strategy="afterInteractive" onLoad={() => setSdkReady(true)} />
      <div id={containerId} />
    </>
  );
}
