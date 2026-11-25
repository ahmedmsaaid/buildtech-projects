import { hashPassword } from './auth';
import { demoNames, fillClinic, fillRestaurant, type Run } from './demo-data';
import { addDays, nowIn } from './time';

/**
 * Demo data for the local development database, created once when that
 * database is empty. Never runs against a real database (see db.ts).
 * It includes clinics in different subscription states and a restaurant, so
 * every screen, the owner dashboard included, has something to show.
 *
 * Demo sign-ins on localhost, all at /login. The clinic:
 */
export const DEMO_EMAIL = 'demo@clinic.test';
export const DEMO_PASSWORD = 'demo-clinic-2026';

/** The restaurant, with the same password as the clinic: */
export const DEMO_RESTAURANT_EMAIL = 'demo@restaurant.test';

/** Demo sign-in for the owner dashboard on localhost: */
export const DEMO_OWNER_EMAIL = 'owner@buildtech.test';
export const DEMO_OWNER_PASSWORD = 'demo-owner-2026';

const TIMEZONE = 'Africa/Cairo';

interface DemoClinic {
  slug: string;
  name: string;
  doctor: string;
  specialty: string;
  email: string;
  status: 'active' | 'suspended';
  plan: 'monthly' | 'yearly' | null;
  /** Days from today until the subscription ends; negative means it already has. */
  paidInDays: number;
}

const clinics: DemoClinic[] = [
  { slug: 'demo', name: demoNames.clinic.name, doctor: demoNames.clinic.contact, specialty: 'باطنة وجهاز هضمي', email: DEMO_EMAIL, status: 'active', plan: 'monthly', paidInDays: 5 },
  { slug: 'smile-dental', name: 'سمايل لطب الأسنان', doctor: 'د. هبة منصور', specialty: 'أسنان وتقويم', email: 'smile-dental@clinic.test', status: 'active', plan: 'yearly', paidInDays: 210 },
  { slug: 'shifa-kids', name: 'عيادة الشفاء للأطفال', doctor: 'د. كريم عادل', specialty: 'أطفال وحديثي الولادة', email: 'shifa-kids@clinic.test', status: 'suspended', plan: 'monthly', paidInDays: -12 },
  { slug: 'hayah-derma', name: 'عيادة الحياة للجلدية', doctor: 'د. سلمى فؤاد', specialty: 'جلدية وتجميل', email: 'hayah-derma@clinic.test', status: 'active', plan: null, paidInDays: 11 },
];

async function addUser(run: Run, accountId: string, email: string, name: string): Promise<void> {
  await run('insert into users (id, account_id, email, password_hash, name) values ($1, $2, $3, $4, $5)', [
    crypto.randomUUID(),
    accountId,
    email,
    hashPassword(DEMO_PASSWORD),
    name,
  ]);
}

async function addPayment(run: Run, accountId: string, amount: number, paidOn: string, coversUntil: string, note: string): Promise<void> {
  await run('insert into subscription_payments (id, account_id, amount, paid_on, covers_until, note) values ($1, $2, $3, $4, $5, $6)', [
    crypto.randomUUID(),
    accountId,
    amount,
    paidOn,
    coversUntil,
    note,
  ]);
}

export async function seedDemoData(run: Run): Promise<void> {
  const [existing] = await run<{ id: string }>('select id from accounts limit 1');
  if (existing) return;

  const today = nowIn(TIMEZONE).day;

  await run('insert into owners (id, email, password_hash, name) values ($1, $2, $3, $4)', [
    crypto.randomUUID(),
    DEMO_OWNER_EMAIL,
    hashPassword(DEMO_OWNER_PASSWORD),
    'BuildTech',
  ]);

  // The catalogue of plans, per product.
  const plans = {
    monthly: { id: crypto.randomUUID(), product: 'clinic', name: 'شهري', months: 1, price: 500 },
    yearly: { id: crypto.randomUUID(), product: 'clinic', name: 'سنوي', months: 12, price: 5000 },
    restaurantMonthly: { id: crypto.randomUUID(), product: 'restaurant', name: 'شهري', months: 1, price: 700 },
    restaurantYearly: { id: crypto.randomUUID(), product: 'restaurant', name: 'سنوي', months: 12, price: 7000 },
  };
  for (const [index, plan] of Object.values(plans).entries()) {
    await run('insert into plans (id, product, name, months, price, sort_order) values ($1, $2, $3, $4, $5, $6)', [
      plan.id,
      plan.product,
      plan.name,
      plan.months,
      plan.price,
      index + 1,
    ]);
  }

  for (const [index, clinic] of clinics.entries()) {
    const id = crypto.randomUUID();
    const plan = clinic.plan ? plans[clinic.plan] : null;

    await run(
      `insert into accounts (id, product, slug, name, status, plan_id, price, period_months, paid_until, contact_name, contact_phone, timezone)
       values ($1, 'clinic', $2, $3, $4, $5, $6, $7, $8, $9, '01000000000', $10)`,
      [id, clinic.slug, clinic.name, clinic.status, plan?.id ?? null, plan?.price ?? 0, plan?.months ?? 1, addDays(today, clinic.paidInDays), clinic.doctor, TIMEZONE],
    );
    // Only the first clinic gets visits: it is the one the clinic demo opens.
    await fillClinic(run, id, today, {
      doctor: clinic.doctor,
      specialty: clinic.specialty,
      about: index === 0 ? 'استشاري الباطنة والجهاز الهضمي والمناظير. خبرة أكتر من 15 سنة في تشخيص وعلاج أمراض المعدة والقولون والكبد.' : '',
      withVisits: index === 0,
    });
    await addUser(run, id, clinic.email, 'الاستقبال');

    // Paying clinics have a payment history.
    if (plan && clinic.status === 'active') {
      await addPayment(run, id, plan.price, addDays(today, clinic.paidInDays - plan.months * 30), addDays(today, clinic.paidInDays), 'إنستاباي');
    }
  }

  const restaurantId = crypto.randomUUID();
  const restaurantPlan = plans.restaurantMonthly;
  await run(
    `insert into accounts (id, product, slug, name, plan_id, price, period_months, paid_until, contact_name, contact_phone, accent, timezone)
     values ($1, 'restaurant', 'resto', $2, $3, $4, $5, $6, $7, '01000000000', '#b45309', $8)`,
    [restaurantId, demoNames.restaurant.name, restaurantPlan.id, restaurantPlan.price, restaurantPlan.months, addDays(today, 19), demoNames.restaurant.contact, TIMEZONE],
  );
  await fillRestaurant(run, restaurantId, today);
  await addUser(run, restaurantId, DEMO_RESTAURANT_EMAIL, 'الكاشير');
  await addPayment(run, restaurantId, restaurantPlan.price, addDays(today, -11), addDays(today, 19), 'كاش');
}
