/**
 * The registry of products the platform sells. The owner dashboard reads
 * everything it needs about a product from here, so adding a product means
 * adding one entry (and that product's own tables and pages), not editing
 * the dashboard.
 */
import { getClinicUsage, setUpClinic } from './clinics';

export interface Product {
  key: string;
  /** What one customer of this product is called, and the plural. */
  customer: string;
  customers: string;
  /** Icon name from components/Icon.astro. */
  icon: 'pulse' | 'building';
  /** Where a customer's staff sign in. */
  dashboardPath: string;
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
    setupFields: [
      { name: 'doctor_name', label: 'اسم الدكتور' },
      { name: 'specialty', label: 'التخصص' },
    ],
    setUp: (accountId, answers, contactPhone) =>
      setUpClinic(accountId, { doctorName: answers.doctor_name ?? '', specialty: answers.specialty ?? '', phone: contactPhone }),
    usage: getClinicUsage,
  },
};

export const productList = Object.values(products);

/** The product of an account. An unknown key means the registry and the data disagree, which is a bug. */
export function productOf(account: { product: string }): Product {
  const product = products[account.product];
  if (!product) throw new Error(`Unknown product "${account.product}"`);
  return product;
}
