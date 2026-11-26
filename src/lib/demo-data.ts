/**
 * Made-up content that turns an empty account into a believable business:
 * a clinic with weeks of visits, a restaurant with a menu and orders.
 *
 * Used in two places: the demo a visitor starts from the site (demo.ts),
 * and the local development database (dev-seed.ts). Every function takes
 * the query runner to use, because the development seed runs before the
 * normal one is available.
 */
import { addDays, weekdayOf } from './time';

export type Run = <Row>(sql: string, params?: (string | number | boolean | null)[]) => Promise<Row[]>;

const OPEN_MINUTE = 1020;
const SLOT_MINUTES = 20;
const SLOTS_PER_DAY = 15;

const clinicServices: [name: string, price: number][] = [
  ['كشف', 400],
  ['استشارة', 150],
  ['متابعة تحاليل', 200],
];

const people: [name: string, phone: string][] = [
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

const menu: [category: string, items: [name: string, description: string, price: number][]][] = [];
const restaurantMenu: typeof menu = [
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

/** A repeatable stand-in for randomness, so every demo looks the same. */
function pick(seed: number, size: number): number {
  return Math.abs(Math.floor(Math.sin(seed * 12.9898) * 43758.5453)) % size;
}

/** What a demo clinic and a demo restaurant are called, used when their accounts are created. */
export const demoNames = {
  clinic: { name: 'عيادة النور', contact: 'د. أحمد سامي' },
  barber: { name: 'صالون الأسطى', contact: 'الأسطى كريم' },
  restaurant: { name: 'مشويات الحاتي', contact: 'أ. محمود الحاتي' },
  cafe: { name: 'كافيه روقان', contact: 'أ. يوسف منير' },
} as const;

/** What a barbershop offers, in place of a clinic's kinds of visit. */
export const barberServices: [name: string, price: number][] = [
  ['حلاقة شعر', 100],
  ['حلاقة دقن', 60],
  ['شعر ودقن', 150],
  ['حلاقة أطفال', 80],
];

const cafeMenu: typeof menu = [
  [
    'قهوة',
    [
      ['إسبريسو', 'شوت دوبل', 45],
      ['كابتشينو', '', 65],
      ['لاتيه', 'ساده أو بنكهة الفانيليا أو الكراميل', 70],
      ['قهوة تركي', 'على الرملة', 35],
      ['سبانيش لاتيه', '', 85],
    ],
  ],
  [
    'مشروبات باردة',
    [
      ['آيس لاتيه', '', 75],
      ['آيس موكا', '', 85],
      ['موهيتو', 'ليمون ونعناع، أو فراولة', 60],
      ['عصير مانجو', '', 55],
    ],
  ],
  [
    'حلويات',
    [
      ['تشيز كيك', 'لوتس أو توت', 90],
      ['براونيز', 'مع بولة آيس كريم', 80],
      ['وافل', 'نوتيلا وموز', 95],
    ],
  ],
  [
    'سندوتشات',
    [
      ['كلوب ساندوتش', 'فراخ وجبنة وبيض', 120],
      ['توست جبنة مشوي', '', 70],
      ['كرواسون ديك رومي', '', 85],
    ],
  ],
];

/**
 * Makes an existing account a clinic with evening hours, three services,
 * three weeks of finished visits and a few days of bookings to come.
 * `withVisits: false` leaves the diary empty.
 */
export async function fillClinic(
  run: Run,
  accountId: string,
  today: string,
  profile: {
    doctor: string;
    specialty: string;
    about?: string;
    withVisits?: boolean;
    /** What can be booked. A clinic's kinds of visit when left out. */
    offers?: [name: string, price: number][];
    /** The private note kept on the first client. */
    note?: string;
    /** The people who take the bookings, for a place where the visitor chooses one. */
    team?: string[];
  },
): Promise<void> {
  const services = profile.offers ?? clinicServices;
  await run(
    `insert into clinics (id, specialty, doctor_name, address, phone, whatsapp, slot_minutes, about)
     values ($1, $2, $3, '12 شارع التحرير، الدقي، الجيزة', '01000000000', '01000000000', $4, $5)`,
    [accountId, profile.specialty, profile.doctor, SLOT_MINUTES, profile.about ?? ''],
  );

  // Open Saturday to Thursday evening, closed on Friday.
  for (let weekday = 0; weekday < 7; weekday++) {
    await run('insert into working_hours (clinic_id, weekday, is_open, open_minute, close_minute) values ($1, $2, $3, $4, $5)', [
      accountId,
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
    await run('insert into services (id, clinic_id, name, price, sort_order) values ($1, $2, $3, $4, $5)', [serviceId, accountId, name, price, order + 1]);
  }
  const team: { id: string; name: string }[] = [];
  for (const [order, name] of (profile.team ?? []).entries()) {
    const id = crypto.randomUUID();
    team.push({ id, name });
    await run('insert into staff (id, clinic_id, name, sort_order) values ($1, $2, $3, $4)', [id, accountId, name, order + 1]);
  }
  if (profile.withVisits === false) return;

  // Past days are finished visits with a few no-shows; today and the coming days are bookings.
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

      const [name, phone] = people[pick(seed + 7, people.length)];
      const service = pick(seed + 3, services.length);
      const [serviceName, price] = services[service];
      const status = offset >= 0 ? 'booked' : pick(seed + 11, 9) === 0 ? 'no_show' : 'done';
      const member = team.length > 0 ? team[pick(seed + 13, team.length)] : null;

      await run(
        `insert into appointments (id, clinic_id, service_id, service_name, price, paid, day, start_minute, patient_name, patient_phone, status, source, staff_id, staff_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          crypto.randomUUID(),
          accountId,
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
          member?.id ?? null,
          member?.name ?? '',
        ],
      );
    }
  }

  await run('insert into patient_notes (clinic_id, patient_phone, note) values ($1, $2, $3)', [
    accountId,
    people[0][1],
    profile.note ?? 'حساسية من البنسلين. بتتابع ارتجاع المريء، آخر منظار سليم.',
  ]);
}

/** Makes an existing account a restaurant, or a café, with a full menu and two weeks of orders, some being made right now. */
export async function fillRestaurant(run: Run, accountId: string, today: string, kind: 'restaurant' | 'cafe' = 'restaurant'): Promise<void> {
  const isCafe = kind === 'cafe';
  const menu = isCafe ? cafeMenu : restaurantMenu;
  await run(
    `insert into restaurants (id, cuisine, address, phone, whatsapp, about, hours_note, tables_count, prep_minutes)
     values ($1, $2, '45 شارع جامعة الدول، المهندسين', '01000000000', '01000000000', $3, $4, 12, $5)`,
    isCafe
      ? [accountId, 'قهوة مختصة وحلويات', 'قهوة محمّصة طازة وحلويات بتتعمل كل يوم. مكان هادي للشغل والقعدة.', 'يومياً من 9 الصبح لـ 2 بالليل', 10]
      : [accountId, 'مشويات وطواجن', 'مشويات على الفحم وطواجن بلدي من سنة 1998. كل حاجة بتتعمل وقت الطلب.', 'يومياً من 12 الضهر لـ 1 بالليل', 20],
  );

  const dishes: { id: string; name: string; price: number }[] = [];
  for (const [categoryOrder, [category, items]] of menu.entries()) {
    const categoryId = crypto.randomUUID();
    await run('insert into menu_categories (id, restaurant_id, name, sort_order) values ($1, $2, $3, $4)', [categoryId, accountId, category, categoryOrder + 1]);
    for (const [itemOrder, [name, description, price]] of items.entries()) {
      const itemId = crypto.randomUUID();
      dishes.push({ id: itemId, name, price });
      await run('insert into menu_items (id, restaurant_id, category_id, name, description, price, sort_order) values ($1, $2, $3, $4, $5, $6, $7)', [
        itemId,
        accountId,
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
      const [customer, phone] = people[pick(seed + 6, people.length)];

      await run(
        `insert into orders (id, restaurant_id, number, day, type, table_number, customer_name, customer_phone, status, total, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() - make_interval(days => $11, mins => $12))`,
        [orderId, accountId, index + 1, day, isDineIn ? 'dine_in' : 'pickup', isDineIn ? 1 + pick(seed + 1, 12) : null, isDineIn ? '' : customer, isDineIn ? '' : phone, status, total, -offset, (count - index) * 6],
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
