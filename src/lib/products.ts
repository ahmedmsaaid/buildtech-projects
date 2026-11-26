/**
 * The registry of products the platform sells. The owner dashboard reads
 * everything it needs about a product from here, so adding a product means
 * adding one entry (and that product's own tables and pages), not editing
 * the dashboard.
 *
 * There are two systems underneath, and several products on each: clinics
 * and barbershops take bookings; restaurants and cafés take orders from a
 * menu. Products on the same system share its pages and tables and differ
 * in their words (words.ts) and in what a new customer starts with.
 */
import { getClinicById, getClinicUsage, setUpClinic } from './clinics';
import { getRestaurantById, getRestaurantUsage, setUpRestaurant } from './restaurants';

export interface Product {
  key: string;
  /** What one customer of this product is called, and the plural. */
  customer: string;
  customers: string;
  /** Icon name from components/Icon.astro. */
  icon: 'pulse' | 'building' | 'scissors' | 'cup';
  /** Where a customer's staff work. Everyone signs in at /login and is sent here. */
  dashboardPath: string;
  /** Which public pages show this product's customers: the folder under pages/site. */
  pages: 'clinic' | 'restaurant';
  /** What the customer's public page is called, for buttons that open it. */
  publicPage: string;
  /** Puts what this product's dashboard pages need on the request (see env.d.ts). */
  load(locals: App.Locals, accountId: string): Promise<void>;
  /** Extra questions asked when the owner creates an account of this product. */
  setupFields: { name: string; label: string }[];
  /** Creates the product's own records for a new account. */
  setUp(accountId: string, answers: Record<string, string>, contactPhone: string): Promise<void>;
  /** A few figures that show how much the account is being used. */
  usage(accountId: string, since: string): Promise<{ label: string; value: string }[]>;
  /**
   * The product's tables (schema-products.sql), each with the condition that
   * picks one account's rows, where $1 is the account's id. Listed so that a
   * table comes after the ones it points at; deleting the account's row in
   * the first removes its rows in all the others.
   */
  tables: { name: string; where: string }[];
}

type Named = Pick<Product, 'key' | 'customer' | 'customers' | 'icon' | 'setupFields'>;

/** A product on the booking system: its staff work under /admin. */
function bookingProduct(named: Named): Product {
  return {
    ...named,
    dashboardPath: '/admin',
    pages: 'clinic',
    publicPage: 'صفحة الحجز',
    load: async (locals, accountId) => {
      const clinic = await getClinicById(accountId);
      if (clinic) locals.clinic = clinic;
    },
    setUp: (accountId, answers, contactPhone) =>
      setUpClinic(accountId, named.key, { doctorName: answers.doctor_name ?? '', specialty: answers.specialty ?? '', phone: contactPhone }),
    usage: (accountId, since) => getClinicUsage(accountId, since, named.key),
    tables: [
      { name: 'clinics', where: 'id = $1' },
      { name: 'working_hours', where: 'clinic_id = $1' },
      { name: 'closed_days', where: 'clinic_id = $1' },
      { name: 'services', where: 'clinic_id = $1' },
      { name: 'appointments', where: 'clinic_id = $1' },
      { name: 'patient_notes', where: 'clinic_id = $1' },
    ],
  };
}

/** A product on the ordering system: its staff work under /restaurant. */
function orderingProduct(named: Named): Product {
  return {
    ...named,
    dashboardPath: '/restaurant',
    pages: 'restaurant',
    publicPage: 'المنيو',
    load: async (locals, accountId) => {
      const restaurant = await getRestaurantById(accountId);
      if (restaurant) locals.restaurant = restaurant;
    },
    setUp: (accountId, answers, contactPhone) => setUpRestaurant(accountId, named.key, { cuisine: answers.cuisine ?? '', phone: contactPhone }),
    usage: getRestaurantUsage,
    tables: [
      { name: 'restaurants', where: 'id = $1' },
      { name: 'menu_categories', where: 'restaurant_id = $1' },
      { name: 'menu_items', where: 'restaurant_id = $1' },
      { name: 'orders', where: 'restaurant_id = $1' },
      { name: 'order_items', where: 'order_id in (select id from orders where restaurant_id = $1)' },
    ],
  };
}

export const products: Record<string, Product> = {
  clinic: bookingProduct({
    key: 'clinic',
    customer: 'عيادة',
    customers: 'العيادات',
    icon: 'pulse',
    setupFields: [
      { name: 'doctor_name', label: 'اسم الدكتور' },
      { name: 'specialty', label: 'التخصص' },
    ],
  }),
  barber: bookingProduct({
    key: 'barber',
    customer: 'صالون حلاقة',
    customers: 'الحلاقين',
    icon: 'scissors',
    setupFields: [{ name: 'doctor_name', label: 'اسم الحلاق أو صاحب الصالون' }],
  }),
  restaurant: orderingProduct({
    key: 'restaurant',
    customer: 'مطعم',
    customers: 'المطاعم',
    icon: 'building',
    setupFields: [{ name: 'cuisine', label: 'نوع الأكل' }],
  }),
  cafe: orderingProduct({
    key: 'cafe',
    customer: 'كافيه',
    customers: 'الكافيهات',
    icon: 'cup',
    setupFields: [{ name: 'cuisine', label: 'نوع الكافيه' }],
  }),
};

export const productList = Object.values(products);

/** The product of an account. An unknown key means the registry and the data disagree, which is a bug. */
export function productOf(account: { product: string }): Product {
  const product = products[account.product];
  if (!product) throw new Error(`Unknown product "${account.product}"`);
  return product;
}
