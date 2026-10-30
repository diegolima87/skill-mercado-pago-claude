'use client';

import { useEffect, useId, useRef } from 'react';
import { MP_PUBLIC_KEY, type BrickController } from './mercadopago-sdk';

export interface StatusScreenBrickProps {
  paymentId: string;
  /** `three_ds_info.external_resource_url` da resposta do pagamento. */
  externalResourceURL: string;
  /** `three_ds_info.creq` da resposta do pagamento. */
  creq: string;
  onError?: (message: string) => void;
}

/** Desafio 3D Secure de um pagamento único. O Card Payment Brick só tokeniza;
 * quando o pagamento volta com status_detail 'pending_challenge', este Brick
 * renderiza o desafio do emissor a partir de `three_ds_info`.
 * Pressupõe que o SDK (sdk.mercadopago.com/js/v2) já foi carregado pelo
 * CardPaymentBrick. Veja references/03-pagamento-unico.md (seção 3D Secure). */
export function StatusScreenBrick({ paymentId, externalResourceURL, creq, onError }: StatusScreenBrickProps) {
  const containerId = `mp-status-brick-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const controllerRef = useRef<BrickController | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!window.MercadoPago) {
      onErrorRef.current?.('SDK do Mercado Pago não carregado.');
      return;
    }
    if (!MP_PUBLIC_KEY) {
      onErrorRef.current?.('Pagamento não configurado (chave pública do Mercado Pago ausente).');
      return;
    }

    const mp = new window.MercadoPago(MP_PUBLIC_KEY, { locale: 'pt-BR' });
    let cancelled = false;

    mp.bricks()
      .create('statusScreen', containerId, {
        initialization: { paymentId, additionalInfo: { externalResourceURL, creq } },
        callbacks: {
          onReady: () => {},
          onError: (error: unknown) => {
            console.error('[StatusScreenBrick]', error);
            onErrorRef.current?.('Erro ao validar o pagamento com o banco emissor.');
          },
        },
      })
      .then((controller) => {
        if (cancelled) controller.unmount();
        else controllerRef.current = controller;
      });

    return () => {
      cancelled = true;
      controllerRef.current?.unmount();
      controllerRef.current = null;
    };
  }, [paymentId, externalResourceURL, creq, containerId]);

  return <div id={containerId} />;
}
