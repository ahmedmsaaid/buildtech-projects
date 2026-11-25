/**
 * Platform core: an account is one customer of one product. Everything here
 * is the same whether the customer is a clinic or anything else; what a
 * product adds lives in that product's own module (clinics.ts for clinics).
 */
import { query } from './db';

export interface Account {
  id: string;
  /** Which product this customer uses: a key of the registry in products.ts. */
  product: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  /** Null while the account is still on its free trial. */
  plan_id: string | null;
  /** What the customer pays per period, in whole pounds. */
  price: number;
  period_months: number;
  /** Last day the subscription or trial covers, or null when never set. */
  paid_until: string | null;
  contact_name: string;
  contact_phone: string;
  owner_note: string;
  accent: string;
  /** JSON of theme choices; read it through themeOf() in theme.ts. */
  theme: string;
  timezone: string;
}

export const ACCOUNT_COLUMNS = `accounts.id, accounts.product, accounts.slug, accounts.name, accounts.status, accounts.plan_id, accounts.price,
  accounts.period_months, accounts.paid_until, accounts.contact_name, accounts.contact_phone, accounts.owner_note,
  accounts.accent, accounts.theme, accounts.timezone`;

export async function getAccountById(id: string): Promise<Account | null> {
  const [account] = await query<Account>(`select ${ACCOUNT_COLUMNS} from accounts where id = $1`, [id]);
  return account ?? null;
}

/** Saves an account's color and theme choices. `theme` must already be cleaned (see theme.ts). */
export async function updateAppearance(accountId: string, accent: string, theme: Record<string, string>): Promise<void> {
  await query('update accounts set accent = $2, theme = $3 where id = $1', [accountId, accent, JSON.stringify(theme)]);
}
