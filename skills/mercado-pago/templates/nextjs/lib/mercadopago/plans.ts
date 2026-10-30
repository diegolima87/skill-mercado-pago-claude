/**
 * Catálogo de preços: FONTE ÚNICA.
 *
 * Landing, tela de checkout, script de criação de plano e backend importam
 * daqui. Quando o preço vive em vários lugares, o site anuncia um valor e o
 * Mercado Pago cobra outro, e quem descobre é o cliente, na fatura.
 *
 * Sem import de servidor neste arquivo (é importado por componentes de
 * cliente). Só os IDs de plano vêm de env no servidor; aqui guardamos o NOME
 * da variável, não o valor.
 */

// O Mercado Pago só aceita 'days' ou 'months'. 'years' NÃO existe, e o SDK tipa
// o campo como string solta, então o TypeScript não acusa: quebra só em runtime.
// Anual = 12 months.
export type FrequencyType = 'days' | 'months';

export interface Plan {
  key: string;
  /** `reason` do preapproval: texto que aparece na fatura do cartão. */
  reason: string;
  amount: number;
  frequency: number;
  frequencyType: FrequencyType;
  /** Nome da env var com o preapproval_plan_id criado por scripts/mp-plan.ts. */
  planIdEnv: string;
  /** Caminho (sem domínio) para onde o MP volta. */
  backPath: string;
  /** false = esconde o plano sem derrubar deploy (interruptor de lançamento). */
  available: boolean;
}

export const PLANS = {
  basic: {
    key: 'basic',
    reason: 'MeuApp: Plano Básico (mensal)',
    amount: 29.9,
    frequency: 1,
    frequencyType: 'months',
    planIdEnv: 'MERCADOPAGO_PLAN_ID_BASIC',
    backPath: '/assinar?retorno=1',
    available: true,
  },
  pro: {
    key: 'pro',
    reason: 'MeuApp: Plano Pro (anual)',
    amount: 299,
    frequency: 12,
    frequencyType: 'months',
    planIdEnv: 'MERCADOPAGO_PLAN_ID_PRO',
    backPath: '/assinar?retorno=1',
    available: true,
  },
} as const satisfies Record<string, Plan>;

export type PlanKey = keyof typeof PLANS;

export const isPlanKey = (v: unknown): v is PlanKey => typeof v === 'string' && v in PLANS;

/** Lê o preapproval_plan_id do ambiente. Só no servidor. */
export function planIdFromEnv(plan: Plan): string {
  const id = process.env[plan.planIdEnv];
  if (!id) {
    throw new Error(`Falta ${plan.planIdEnv} no ambiente. Rode "npx tsx scripts/mp-plan.ts ${plan.key}" e cole o id gerado.`);
  }
  return id;
}
