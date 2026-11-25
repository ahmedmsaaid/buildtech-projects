import { hashPassword } from './auth';
import { addDays, nowIn, weekdayOf } from './time';

/**
 * Demo data for the local development database, created once when that
 * database is empty. Never runs against a real database (see db.ts).
 * It includes three clinics in different subscription states and three weeks
 * of made-up visits, so every screen has something to show.
 *
 * Demo sign-in for /admin on localhost:
 */
export const DEMO_EMAIL = 'demo@clinic.test';
export const DEMO_PASSWORD = 'demo-clinic-2026';

/** Demo sign-in for /owner on localhost: */
export const DEMO_OWNER_EMAIL = 'owner@buildtech.test';
export const DEMO_OWNER_PASSWORD = 'demo-owner-2026';

type Run = <Row>(sql: string, params?: (string | number | boolean | null)[]) => Promise<Row[]>;

const TIMEZONE = 'Africa/Cairo';
const OPEN_MINUTE = 1020;
const SLOT_MINUTES = 20;
const SLOTS_PER_DAY = 15;

const services: [name: string, price: number][] = [
  ['كشف', 400],
  ['استشارة', 150],
  ['متابعة تحاليل', 200],
];

const patients: [name: string, phone: string][] = [
  ['منى عبد الله', '01001112233'],
  ['كريم حسن', '01112223344'],
  ['سارة محمود', '01223334455'],
  ['عمر فاروق', '01004445566'],
  ['ليلى إبراهيم', '01115556677'],
  ['يوسف طارق', '01226667788'],
  ['هدى مصطفى', '01007778899'],
  ['أحمد جمال', '01118889900'],
  ['نور الدين علي', '01229990011'],
  ['ريم خالد', '01001234567'],
  ['محمود سعيد', '01112345678'],
  ['دينا شريف', '01223456789'],
];

/** A repeatable stand-in for randomness, so the demo looks the same on every machine. */
function pick(seed: number, size: number): number {
  return Math.abs(Math.floor(Math.sin(seed * 12.9898) * 43758.5453)) % size;
}

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
  { slug: 'demo', name: 'عيادة النور', doctor: 'د. أحمد سامي', specialty: 'باطنة وجهاز هضمي', email: DEMO_EMAIL, status: 'active', plan: 'monthly', paidInDays: 5 },
  { slug: 'smile-dental', name: 'سمايل لطب الأسنان', doctor: 'د. هبة منصور', specialty: 'أسنان وتقويم', email: 'smile-dental@clinic.test', status: 'active', plan: 'yearly', paidInDays: 210 },
  { slug: 'shifa-kids', name: 'عيادة الشفاء للأطفال', doctor: 'د. كريم عادل', specialty: 'أطفال وحديثي الولادة', email: 'shifa-kids@clinic.test', status: 'suspended', plan: 'monthly', paidInDays: -12 },
  { slug: 'hayah-derma', name: 'عيادة الحياة للجلدية', doctor: 'د. سلمى فؤاد', specialty: 'جلدية وتجميل', email: 'hayah-derma@clinic.test', status: 'active', plan: null, paidInDays: 11 },
];

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

  // The catalogue of plans for the clinic product.
  const plans = {
    monthly: { id: crypto.randomUUID(), name: 'شهري', months: 1, price: 500 },
    yearly: { id: crypto.randomUUID(), name: 'سنوي', months: 12, price: 5000 },
  };
  for (const [index, plan] of Object.values(plans).entries()) {
    await run("insert into plans (id, product, name, months, price, sort_order) values ($1, 'clinic', $2, $3, $4, $5)", [
      plan.id,
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
    await run(
      `insert into clinics (id, specialty, doctor_name, address, phone, whatsapp, slot_minutes, about)
       values ($1, $2, $3, '12 شارع التحرير، الدقي، الجيزة', '01000000000', '01000000000', $4, $5)`,
      [id, clinic.specialty, clinic.doctor, SLOT_MINUTES, index === 0 ? 'استشاري الباطنة والجهاز الهضمي والمناظير. خبرة أكتر من 15 سنة في تشخيص وعلاج أمراض المعدة والقولون والكبد.' : ''],
    );

    // Open Saturday to Thursday evening, closed on Friday.
    for (let weekday = 0; weekday < 7; weekday++) {
      await run('insert into working_hours (clinic_id, weekday, is_open, open_minute, close_minute) values ($1, $2, $3, $4, $5)', [
        id,
        weekday,
        weekday !== 5,
        OPEN_MINUTE,
        OPEN_MINUTE + SLOTS_PER_DAY * SLOT_MINUTES,
      ]);
    }

    const serviceIds: string[] = [];
    for (const [order, [name, price]] of services.entries()) {
      const serviceId = crypto.randomUUID();
      serviceIds.push(serviceId);
      await run('insert into services (id, clinic_id, name, price, sort_order) values ($1, $2, $3, $4, $5)', [serviceId, id, name, price, order + 1]);
    }

    await run('insert into users (id, account_id, email, password_hash, name) values ($1, $2, $3, $4, $5)', [
      crypto.randomUUID(),
      id,
      clinic.email,
      hashPassword(DEMO_PASSWORD),
      'الاستقبال',
    ]);

    // Paying clinics have a payment history.
    if (plan && clinic.status === 'active') {
      const lastPaidOn = addDays(today, clinic.paidInDays - plan.months * 30);
      await run('insert into subscription_payments (id, account_id, amount, paid_on, covers_until, note) values ($1, $2, $3, $4, $5, $6)', [
        crypto.randomUUID(),
        id,
        plan.price,
        lastPaidOn,
        addDays(today, clinic.paidInDays),
        'إنستاباي',
      ]);
    }

    // Only the first clinic gets visits: it is the one the clinic demo opens.
    if (index === 0) await seedVisits(run, id, serviceIds, today);
  }
}

/** Past days are finished visits with a few no-shows; today and the coming days are bookings still to happen. */
async function seedVisits(run: Run, clinicId: string, serviceIds: string[], today: string): Promise<void> {
  for (let offset = -21; offset <= 3; offset++) {
    const day = addDays(today, offset);
    if (weekdayOf(day) === 5) continue;

    const visits = 4 + pick(offset + 100, 6);
    const usedSlots = new Set<number>();
    for (let index = 0; index < visits; index++) {
      const seed = (offset + 30) * 17 + index;
      const slot = pick(seed, SLOTS_PER_DAY);
      if (usedSlots.has(slot)) continue;
      usedSlots.add(slot);

      const [name, phone] = patients[pick(seed + 7, patients.length)];
      const service = pick(seed + 3, services.length);
      const [serviceName, price] = services[service];
      const status = offset >= 0 ? 'booked' : pick(seed + 11, 9) === 0 ? 'no_show' : 'done';

      await run(
        `insert into appointments (id, clinic_id, service_id, service_name, price, paid, day, start_minute, patient_name, patient_phone, status, source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          crypto.randomUUID(),
          clinicId,
          serviceIds[service],
          serviceName,
          price,
          status === 'done' ? price : 0,
          day,
          OPEN_MINUTE + slot * SLOT_MINUTES,
          name,
          phone,
          status,
          pick(seed + 5, 3) === 0 ? 'staff' : 'online',
        ],
      );
    }
  }

  await run('insert into patient_notes (clinic_id, patient_phone, note) values ($1, $2, $3)', [
    clinicId,
    patients[0][1],
    'حساسية من البنسلين. بتتابع ارتجاع المريء، آخر منظار سليم.',
  ]);
}
