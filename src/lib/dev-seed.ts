import { hashPassword } from './auth';
import { addDays, nowIn, weekdayOf } from './time';

/**
 * Demo data for the local development database, created once when that
 * database is empty. Never runs against a real database (see db.ts).
 * It includes clinics in different subscription states with three weeks of
 * made-up visits, and a restaurant with a menu and two weeks of orders, so
 * every screen has something to show.
 *
 * Demo sign-ins on localhost, all at /login. The clinic:
 */
export const DEMO_EMAIL = 'demo@clinic.test';
export const DEMO_PASSWORD = 'demo-clinic-2026';

/** The restaurant, with the same password as the clinic: */
export const DEMO_RESTAURANT_EMAIL = 'demo@restaurant.test';

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

  await seedRestaurant(run, today);
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

const demoMenu: [category: string, items: [name: string, description: string, price: number][]][] = [
  [
    'مشويات',
    [
      ['كفتة مشوية', 'نص كيلو كفتة بلدي على الفحم مع عيش وسلطة', 220],
      ['شيش طاووق', 'صدور فراخ متبّلة مشوية مع أرز', 190],
      ['ريش ضاني', 'أربع ريش على الفحم مع خضار سوتيه', 340],
      ['ميكس جريل', 'كفتة وطاووق وريش لشخصين', 480],
    ],
  ],
  [
    'طواجن',
    [
      ['طاجن بامية باللحمة', 'بامية بلدي بقطع اللحم في الفرن', 180],
      ['طاجن مكرونة بشاميل', '', 120],
      ['طاجن ورق عنب', 'ورق عنب بالكوارع', 160],
    ],
  ],
  [
    'مقبلات وسلطات',
    [
      ['طحينة', '', 30],
      ['بابا غنوج', '', 35],
      ['سلطة بلدي', '', 30],
      ['شوربة لسان عصفور', '', 45],
    ],
  ],
  [
    'مشروبات',
    [
      ['عصير ليمون بالنعناع', '', 40],
      ['عصير مانجو', '', 55],
      ['مياه معدنية', '', 15],
      ['شاي', '', 20],
    ],
  ],
];

/** A demo restaurant with a full menu and two weeks of orders. */
async function seedRestaurant(run: Run, today: string): Promise<void> {
  const id = crypto.randomUUID();
  const plan = { id: crypto.randomUUID(), name: 'شهري', months: 1, price: 700 };

  await run("insert into plans (id, product, name, months, price, sort_order) values ($1, 'restaurant', $2, $3, $4, 1)", [plan.id, plan.name, plan.months, plan.price]);
  await run("insert into plans (id, product, name, months, price, sort_order) values ($1, 'restaurant', 'سنوي', 12, 7000, 2)", [crypto.randomUUID()]);

  await run(
    `insert into accounts (id, product, slug, name, plan_id, price, period_months, paid_until, contact_name, contact_phone, accent, timezone)
     values ($1, 'restaurant', 'resto', 'مشويات الحاتي', $2, $3, $4, $5, 'أ. محمود الحاتي', '01000000000', '#b45309', $6)`,
    [id, plan.id, plan.price, plan.months, addDays(today, 19), TIMEZONE],
  );
  await run(
    `insert into restaurants (id, cuisine, address, phone, whatsapp, about, hours_note, tables_count)
     values ($1, 'مشويات وطواجن', '45 شارع جامعة الدول، المهندسين', '01000000000', '01000000000',
       'مشويات على الفحم وطواجن بلدي من سنة 1998. كل حاجة بتتعمل وقت الطلب.', 'يومياً من 12 الضهر لـ 1 بالليل', 12)`,
    [id],
  );
  await run('insert into users (id, account_id, email, password_hash, name) values ($1, $2, $3, $4, $5)', [
    crypto.randomUUID(),
    id,
    DEMO_RESTAURANT_EMAIL,
    hashPassword(DEMO_PASSWORD),
    'الكاشير',
  ]);
  await run('insert into subscription_payments (id, account_id, amount, paid_on, covers_until, note) values ($1, $2, $3, $4, $5, $6)', [
    crypto.randomUUID(),
    id,
    plan.price,
    addDays(today, -11),
    addDays(today, 19),
    'كاش',
  ]);

  const dishes: { id: string; name: string; price: number }[] = [];
  for (const [categoryOrder, [category, items]] of demoMenu.entries()) {
    const categoryId = crypto.randomUUID();
    await run('insert into menu_categories (id, restaurant_id, name, sort_order) values ($1, $2, $3, $4)', [categoryId, id, category, categoryOrder + 1]);
    for (const [itemOrder, [name, description, price]] of items.entries()) {
      const itemId = crypto.randomUUID();
      dishes.push({ id: itemId, name, price });
      await run('insert into menu_items (id, restaurant_id, category_id, name, description, price, sort_order) values ($1, $2, $3, $4, $5, $6, $7)', [
        itemId,
        id,
        categoryId,
        name,
        description,
        price,
        itemOrder + 1,
      ]);
    }
  }
  // One dish is sold out, so the menu shows how that looks.
  await run('update menu_items set is_available = false where id = $1', [dishes[2].id]);

  // Past days are finished orders; today has a few at each stage of the kitchen.
  for (let offset = -14; offset <= 0; offset++) {
    const day = addDays(today, offset);
    const count = offset === 0 ? 6 : 5 + pick(offset + 60, 9);

    for (let index = 0; index < count; index++) {
      const seed = (offset + 40) * 23 + index;
      const orderId = crypto.randomUUID();
      const isDineIn = pick(seed + 2, 4) !== 0;
      const status = offset < 0 ? (pick(seed + 9, 14) === 0 ? 'cancelled' : 'done') : (['new', 'new', 'preparing', 'preparing', 'ready', 'done'] as const)[index];

      const lines = Array.from({ length: 1 + pick(seed + 4, 3) }, (_, line) => ({
        dish: dishes[pick(seed * 7 + line * 13, dishes.length)],
        quantity: 1 + pick(seed + line, 2),
      })).filter((line, position, all) => all.findIndex((other) => other.dish.id === line.dish.id) === position);
      const total = lines.reduce((sum, line) => sum + line.dish.price * line.quantity, 0);
      const [customer, phone] = patients[pick(seed + 6, patients.length)];

      await run(
        `insert into orders (id, restaurant_id, number, day, type, table_number, customer_name, customer_phone, status, total, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() - make_interval(days => $11, mins => $12))`,
        [orderId, id, index + 1, day, isDineIn ? 'dine_in' : 'pickup', isDineIn ? 1 + pick(seed + 1, 12) : null, isDineIn ? '' : customer, isDineIn ? '' : phone, status, total, -offset, (count - index) * 6],
      );
      for (const line of lines) {
        await run('insert into order_items (id, order_id, item_id, name, price, quantity) values ($1, $2, $3, $4, $5, $6)', [
          crypto.randomUUID(),
          orderId,
          line.dish.id,
          line.dish.name,
          line.dish.price,
          line.quantity,
        ]);
      }
    }
  }
}
