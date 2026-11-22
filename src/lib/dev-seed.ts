import { hashPassword } from './auth';

/**
 * Demo clinic for the local development database, created once when that
 * database is empty. Never runs against a real database (see db.ts).
 *
 * Demo sign-in for /admin on localhost:
 */
export const DEMO_EMAIL = 'demo@clinic.test';
export const DEMO_PASSWORD = 'demo-clinic-2026';


type Run = <Row>(sql: string, params?: (string | number | boolean | null)[]) => Promise<Row[]>;

export async function seedDemoClinic(run: Run): Promise<void> {
  const [existing] = await run<{ id: string }>('select id from clinics limit 1');
  if (existing) return;

  const clinicId = crypto.randomUUID();
  await run(
    `insert into clinics (id, slug, name, specialty, doctor_name, address, phone, whatsapp, slot_minutes)
     values ($1, 'demo', 'عيادة النور', 'باطنة وجهاز هضمي', 'د. أحمد سامي', '12 شارع التحرير، الدقي، الجيزة', '01000000000', '01000000000', 20)`,
    [clinicId],
  );

  // Open Saturday to Thursday evening, closed on Friday.
  for (let weekday = 0; weekday < 7; weekday++) {
    await run('insert into working_hours (clinic_id, weekday, is_open, open_minute, close_minute) values ($1, $2, $3, 1020, 1320)', [
      clinicId,
      weekday,
      weekday !== 5,
    ]);
  }

  const services: [name: string, price: number][] = [
    ['كشف', 400],
    ['استشارة', 150],
    ['متابعة تحاليل', 200],
  ];
  for (const [index, [name, price]] of services.entries()) {
    await run('insert into services (id, clinic_id, name, price, sort_order) values ($1, $2, $3, $4, $5)', [
      crypto.randomUUID(),
      clinicId,
      name,
      price,
      index + 1,
    ]);
  }

  await run('insert into users (id, clinic_id, email, password_hash, name) values ($1, $2, $3, $4, $5)', [
    crypto.randomUUID(),
    clinicId,
    DEMO_EMAIL,
    hashPassword(DEMO_PASSWORD),
    'الاستقبال',
  ]);
}
