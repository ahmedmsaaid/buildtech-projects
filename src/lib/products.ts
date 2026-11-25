/**
 * The registry of products the platform sells. The owner dashboard reads
 * everything it needs about a product from here, so adding a product means
 * adding one entry (and that product's own tables and pages), not editing
 * the dashboard.
 */
import { getClinicById, getClinicUsage, setUpClinic } from './clinics';
import { getRestaurantById, getRestaurantUsage, setUpRestaurant } from './restaurants';

export interface Product {
  key: string;
  /** What one customer of this product is called, and the plural. */
  customer: string;
  customers: string;
  /** Icon name from components/Icon.astro. */
  icon: 'pulse' | 'building';
  /** Where a customer's staff work. Everyone signs in at /login and is sent here. */
  dashboardPath: string;
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
}

export const products: Record<string, Product> = {
  clinic: {
    key: 'clinic',
    customer: 'عيادة',
    customers: 'العيادات',
    icon: 'pulse',
    dashboardPath: '/admin',
    publicPage: 'صفحة الحجز',
    load: async (locals, accountId) => {
      const clinic = await getClinicById(accountId);
      if (clinic) locals.clinic = clinic;
    },
    setupFields: [
      { name: 'doctor_name', label: 'اسم الدكتور' },
      { name: 'specialty', label: 'التخصص' },
    ],
    setUp: (accountId, answers, contactPhone) =>
      setUpClinic(accountId, { doctorName: answers.doctor_name ?? '', specialty: answers.specialty ?? '', phone: contactPhone }),
    usage: getClinicUsage,
  },
  restaurant: {
    key: 'restaurant',
    customer: 'مطعم',
    customers: 'المطاعم',
    icon: 'building',
    dashboardPath: '/restaurant',
    publicPage: 'المنيو',
    load: async (locals, accountId) => {
      const restaurant = await getRestaurantById(accountId);
      if (restaurant) locals.restaurant = restaurant;
    },
    setupFields: [{ name: 'cuisine', label: 'نوع الأكل' }],
    setUp: (accountId, answers, contactPhone) => setUpRestaurant(accountId, { cuisine: answers.cuisine ?? '', phone: contactPhone }),
    usage: getRestaurantUsage,
  },
};

export const productList = Object.values(products);

/** The product of an account. An unknown key means the registry and the data disagree, which is a bug. */
export function productOf(account: { product: string }): Product {
  const product = products[account.product];
  if (!product) throw new Error(`Unknown product "${account.product}"`);
  return product;
}
