/**
 * Platform core: an account is one customer of one product. Everything here
 * is the same whether the customer is a clinic or anything else; what a
 * product adds lives in that product's own module (clinics.ts for clinics).
 */
import { query } from './db';
import { rememberDatabase } from './tenants';

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
  /** Set on a visitor's demo (see demo.ts); null for every real customer. */
  demo_expires_at: string | Date | null;
}

export const ACCOUNT_COLUMNS = `accounts.id, accounts.product, accounts.slug, accounts.name, accounts.status, accounts.plan_id, accounts.price,
  accounts.period_months, accounts.paid_until, accounts.contact_name, accounts.contact_phone, accounts.owner_note,
  accounts.accent, accounts.theme, accounts.timezone, accounts.demo_expires_at`;

/** An account as stored, with where its records live. That part is noted for tenants.ts and goes no further. */
type StoredAccount = Account & { database_url: string | null; database_schema: number };
const STORED_COLUMNS = `${ACCOUNT_COLUMNS}, accounts.database_url, accounts.database_schema`;

function known(stored: StoredAccount | undefined): Account | null {
  if (!stored) return null;
  const { database_url, database_schema, ...account } = stored;
  rememberDatabase(account.id, database_url, database_schema);
  return account;
}

export async function getAccountBySlug(slug: string): Promise<Account | null> {
  const [account] = await query<StoredAccount>(`select ${STORED_COLUMNS} from accounts where slug = $1`, [slug]);
  return known(account);
}

export async function getAccountById(id: string): Promise<Account | null> {
  const [account] = await query<StoredAccount>(`select ${STORED_COLUMNS} from accounts where id = $1`, [id]);
  return known(account);
}

export interface HostAccount {
  slug: string;
  product: string;
  name: string;
}

// Every request asks which customer its address belongs to, so answers are
// remembered for a minute rather than asked of the database each time.
const HOST_MEMORY_MS = 60_000;
const hosts = new Map<string, { account: HostAccount | null; at: number }>();

/** The customer whose own address this is, or null for the platform's address and any other. */
export async function getAccountOnHost(host: string): Promise<HostAccount | null> {
  const known = hosts.get(host);
  if (known && Date.now() - known.at < HOST_MEMORY_MS) return known.account;

  const [account] = await query<HostAccount>('select slug, product, name from accounts where domain = $1', [host]);
  // Addresses come from the request, so the memory is capped: a flood of made-up ones cannot grow it.
  if (hosts.size > 500) hosts.clear();
  hosts.set(host, { account: account ?? null, at: Date.now() });
  return account ?? null;
}

/** Saves an account's color and theme choices. `theme` must already be cleaned (see theme.ts). */
export async function updateAppearance(accountId: string, accent: string, theme: Record<string, string>): Promise<void> {
  await query('update accounts set accent = $2, theme = $3 where id = $1', [accountId, accent, JSON.stringify(theme)]);
}
