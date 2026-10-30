/**
 * Cria os preapproval_plan UMA VEZ, fora do runtime do app.
 *
 *   npx tsx scripts/mp-plan.ts basic
 *   npx tsx scripts/mp-plan.ts all
 *
 * Imprime as linhas MERCADOPAGO_PLAN_ID_*= prontas para colar no .env.local e
 * nas variáveis do ambiente de produção.
 *
 * Plano é CATÁLOGO, não estado de usuário. Recriar a cada assinatura geraria um
 * plano novo por request, e migrar assinantes entre planos no Mercado Pago é
 * doloroso. NÃO rode de novo para um plano que já existe: gera um segundo
 * plan_id para o mesmo preço e deixa assinantes presos a IDs diferentes.
 *
 * ATENÇÃO: o plano pertence ao ambiente da credencial usada. Plano criado com
 * token de TESTE não existe em produção. Rode de novo com o token de produção
 * no go-live.
 *
 * Requer no .env.local: MERCADOPAGO_ACCESS_TOKEN, NEXT_PUBLIC_SITE_URL
 * (o MP rejeita back_url apontando para localhost).
 */
import { MercadoPagoConfig, PreApprovalPlan } from 'mercadopago';
import { config } from 'dotenv';
import { PLANS, type Plan } from '../lib/mercadopago/plans';

config({ path: '.env.local' });

const ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

if (!ACCESS_TOKEN || !SITE_URL) {
  console.error('Faltam MERCADOPAGO_ACCESS_TOKEN e/ou NEXT_PUBLIC_SITE_URL no .env.local.');
  process.exit(1);
}

const catalog: Record<string, Plan> = PLANS;
const target = process.argv[2];
if (!target || (target !== 'all' && !catalog[target])) {
  console.error(`Uso: npx tsx scripts/mp-plan.ts <${Object.keys(catalog).join(' | ')} | all>`);
  process.exit(1);
}

const plans = new PreApprovalPlan(new MercadoPagoConfig({ accessToken: ACCESS_TOKEN }));

async function create(plan: Plan) {
  const created = await plans.create({
    body: {
      reason: plan.reason,
      back_url: `${SITE_URL}${plan.backPath}`,
      auto_recurring: {
        // Só 'days' ou 'months'. Anual = 12 months.
        frequency: plan.frequency,
        frequency_type: plan.frequencyType,
        transaction_amount: plan.amount,
        currency_id: 'BRL',
      },
    },
  });
  console.log(`\n${plan.reason}`);
  console.log(`  valor: R$ ${plan.amount.toFixed(2)} a cada ${plan.frequency} ${plan.frequencyType}`);
  console.log(`  ${plan.planIdEnv}=${created.id}`);
}

async function main() {
  const list = target === 'all' ? Object.values(catalog) : [catalog[target]];
  for (const plan of list) await create(plan);
  console.log('\nCole as linhas acima no .env.local e no ambiente de produção.');
}

main().catch((err) => {
  console.error('Falha ao criar o plano:', err);
  process.exit(1);
});
