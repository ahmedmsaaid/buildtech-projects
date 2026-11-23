import { hashPassword } from './auth';
import { addDays, nowIn, weekdayOf } from './time';

/**
 * Demo clinic for the local development database, created once when that
 * database is empty. Never runs against a real database (see db.ts).
 * It includes three weeks of made-up visits, so the day view, the patient
 * files and the reports have something to show.
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

export async function seedDemoClinic(run: Run): Promise<void> {
  const [existing] = await run<{ id: string }>('select id from clinics limit 1');
  if (existing) return;

  const clinicId = crypto.randomUUID();
  await run(
    `insert into clinics (id, slug, name, specialty, doctor_name, address, phone, whatsapp, slot_minutes, about, timezone)
     values ($1, 'demo', 'عيادة النور', 'باطنة وجهاز هضمي', 'د. أحمد سامي', '12 شارع التحرير، الدقي، الجيزة', '01000000000', '01000000000', $2,
       'استشاري الباطنة والجهاز الهضمي والمناظير. خبرة أكتر من 15 سنة في تشخيص وعلاج أمراض المعدة والقولون والكبد.', $3)`,
    [clinicId, SLOT_MINUTES, TIMEZONE],
  );

  // Open Saturday to Thursday evening, closed on Friday.
  for (let weekday = 0; weekday < 7; weekday++) {
    await run('insert into working_hours (clinic_id, weekday, is_open, open_minute, close_minute) values ($1, $2, $3, $4, $5)', [
      clinicId,
      weekday,
      weekday !== 5,
      OPEN_MINUTE,
      OPEN_MINUTE + SLOTS_PER_DAY * SLOT_MINUTES,
    ]);
  }

  const serviceIds: string[] = [];
  for (const [index, [name, price]] of services.entries()) {
    const id = crypto.randomUUID();
    serviceIds.push(id);
    await run('insert into services (id, clinic_id, name, price, sort_order) values ($1, $2, $3, $4, $5)', [id, clinicId, name, price, index + 1]);
  }

  await run('insert into users (id, clinic_id, email, password_hash, name) values ($1, $2, $3, $4, $5)', [
    crypto.randomUUID(),
    clinicId,
    DEMO_EMAIL,
    hashPassword(DEMO_PASSWORD),
    'الاستقبال',
  ]);

  // Past days are finished visits with a few no-shows; today and the coming
  // days are bookings still to happen.
  const today = nowIn(TIMEZONE).day;
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

  await run('insert into owners (id, email, password_hash, name) values ($1, $2, $3, $4)', [
    crypto.randomUUID(),
    DEMO_OWNER_EMAIL,
    hashPassword(DEMO_OWNER_PASSWORD),
    'BuildTech',
  ]);

  // The demo clinic pays monthly and is due in a few days, so the renewal notice shows.
  await run("update clinics set plan = 'monthly', price = 500, paid_until = $2, contact_name = 'د. أحمد سامي', contact_phone = '01000000000' where id = $1", [
    clinicId,
    addDays(today, 5),
  ]);
  for (const monthsAgo of [2, 1]) {
    const paidOn = addDays(today, 5 - monthsAgo * 30);
    await run('insert into subscription_payments (id, clinic_id, amount, paid_on, covers_until, note) values ($1, $2, 500, $3, $4, $5)', [
      crypto.randomUUID(),
      clinicId,
      paidOn,
      addDays(paidOn, 30),
      'إنستاباي',
    ]);
  }

  // Two more clinics in other states, so the owner's list is not a single row.
  const others: [slug: string, name: string, doctor: string, specialty: string, status: string, plan: string, price: number, paidUntil: string][] = [
    ['smile-dental', 'سمايل لطب الأسنان', 'د. هبة منصور', 'أسنان وتقويم', 'active', 'yearly', 5000, addDays(today, 210)],
    ['shifa-kids', 'عيادة الشفاء للأطفال', 'د. كريم عادل', 'أطفال وحديثي الولادة', 'suspended', 'monthly', 500, addDays(today, -12)],
  ];
  for (const [slug, name, doctor, specialty, status, plan, price, paidUntil] of others) {
    const id = crypto.randomUUID();
    await run(
      `insert into clinics (id, slug, name, doctor_name, specialty, status, plan, price, paid_until, contact_name, timezone)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $4, $10)`,
      [id, slug, name, doctor, specialty, status, plan, price, paidUntil, TIMEZONE],
    );
    for (let weekday = 0; weekday < 7; weekday++) {
      await run('insert into working_hours (clinic_id, weekday, is_open, open_minute, close_minute) values ($1, $2, $3, $4, $5)', [
        id,
        weekday,
        weekday !== 5,
        OPEN_MINUTE,
        OPEN_MINUTE + SLOTS_PER_DAY * SLOT_MINUTES,
      ]);
    }
    await run("insert into services (id, clinic_id, name, price, sort_order) values ($1, $2, 'كشف', 300, 1)", [crypto.randomUUID(), id]);
    await run('insert into users (id, clinic_id, email, password_hash, name) values ($1, $2, $3, $4, $5)', [
      crypto.randomUUID(),
      id,
      `${slug}@clinic.test`,
      hashPassword(DEMO_PASSWORD),
      doctor,
    ]);
  }

  await run('insert into patient_notes (clinic_id, patient_phone, note) values ($1, $2, $3)', [
    clinicId,
    patients[0][1],
    'حساسية من البنسلين. بتتابع ارتجاع المريء، آخر منظار سليم.',
  ]);
}
