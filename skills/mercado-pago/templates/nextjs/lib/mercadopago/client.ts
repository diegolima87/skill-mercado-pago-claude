import { MercadoPagoConfig, Payment, PreApproval, PreApprovalPlan } from 'mercadopago';

// Singleton por processo: MercadoPagoConfig só guarda token e opções, não há
// estado por chamada que justifique recriar a cada request.
let config: MercadoPagoConfig | null = null;

export function getAccessToken(): string {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error('MERCADOPAGO_ACCESS_TOKEN não configurado.');
  return token;
}

function getConfig(): MercadoPagoConfig {
  if (!config) config = new MercadoPagoConfig({ accessToken: getAccessToken() });
  return config;
}

export const paymentClient = () => new Payment(getConfig());
export const preApprovalClient = () => new PreApproval(getConfig());
export const preApprovalPlanClient = () => new PreApprovalPlan(getConfig());
