/**
 * Where each customer's records live. A customer can have a database of
 * their own; their bookings, menu and orders are then kept there and nowhere
 * else. Customers without one, and every demo, stay in the platform's
 * database. Product code does not care which: it calls `queryFor` with the
 * account's id and the query goes to the right place.
 *
 * The platform's database always keeps what is not the customer's to keep:
 * the list of accounts, subscriptions and sign-ins (see schema.sql).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { Sql } from 'postgres';
import { query } from './db';
import productSchema from './schema-products.sql?raw';

type Params = (string | number | boolean | null)[];

/**
 * The version of schema-products.sql. Raise it whenever that file changes:
 * each customer's database is brought up to date the next time it is used.
 */
export const PRODUCT_SCHEMA_VERSION = 1;

/** The product tables as a customer's own database has them: with no `accounts` table to point at. */
const ownDatabaseSchema = productSchema.replaceAll(' references accounts (id) on delete cascade', '');

// ---------------------------------------------------------------------------
// Keeping the links secret
// ---------------------------------------------------------------------------

/**
 * A database's link contains its password, so it is never stored as it is.
 * The key comes from INTERNAL_API_SECRET, which lives only in the hosting
 * settings: someone who reads the accounts table alone cannot open any
 * customer's database. Changing that secret makes the stored links
 * unreadable, so they would have to be saved again.
 */
function key(): Buffer {
  const secret = (import.meta.env.INTERNAL_API_SECRET ?? process.env.INTERNAL_API_SECRET ?? '').trim();
  if (secret.length < 32) throw new Error('INTERNAL_API_SECRET must be set to keep database links.');
  return Buffer.from(hkdfSync('sha256', secret, '', 'buildtech database links', 32));
}

/** Encrypts a database link for storing in accounts.database_url. */
export function sealLink(link: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const sealed = Buffer.concat([cipher.update(link, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), sealed].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
}

function openLink(stored: string): string {
  const [version, iv, tag, sealed] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !sealed) throw new Error('A stored database link is not in a known form.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(sealed, 'base64url')), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/**
 * Checks a link and reduces it to what the driver understands. Hosts add
 * options to their links (Neon adds channel_binding) that the driver would
 * pass on to the server, which then refuses the connection.
 * Returns null for anything that is not a Postgres link.
 */
export function cleanLink(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return null;
  if (!url.hostname || !url.username || url.pathname.length < 2) return null;

  const isThisMachine = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  url.search = isThisMachine ? '' : '?sslmode=require';
  url.hash = '';
  return url.toString();
}

interface Connection {
  sql: Sql;
  /** Set for a database on this machine, which answers one query at a time (development only). */
  queue: Promise<unknown> | null;
}

/** The most customers' databases one server keeps open. Past it, the one opened longest ago is closed. */
const MAX_OPEN = 30;
// Kept on globalThis so the dev server's reloads reuse the connections.
const shared = globalThis as { __ownDatabases?: Map<string, Connection> };
const open = (shared.__ownDatabases ??= new Map());

async function connect(link: string): Promise<Connection> {
  const known = open.get(link);
  if (known) return known;

  const { default: postgres } = await import('postgres');
  const isThisMachine = /@(127\.0\.0\.1|localhost)[:/]/.test(link);
  // Links are pooled ones, which do not support prepared statements.
  const connection: Connection = {
    sql: postgres(link, { prepare: false, max: isThisMachine ? 1 : 2, idle_timeout: 20, connect_timeout: 15, onnotice: () => {} }),
    queue: isThisMachine ? Promise.resolve() : null,
  };
  if (open.size >= MAX_OPEN) {
    const [oldest, stale] = open.entries().next().value!;
    open.delete(oldest);
    void stale.sql.end({ timeout: 5 }).catch(() => {});
  }
  open.set(link, connection);
  return connection;
}

async function runOn<Row>(connection: Connection, work: (sql: Sql) => Promise<Row>): Promise<Row> {
  if (!connection.queue) return work(connection.sql);
  const turn = connection.queue.then(
    () => work(connection.sql),
    () => work(connection.sql),
  );
  connection.queue = turn.catch(() => {});
  return turn;
}

/**
 * A customer's own database, opened by its plain link, for the one job that
 * needs more than `queryFor`: moving a customer's records into it (move-data.ts).
 */
export async function openDatabase(link: string): Promise<{
  run: <Row>(sql: string, params?: Params) => Promise<Row[]>;
  /** Creates or updates the product tables. */
  prepare: () => Promise<void>;
  /** Adds rows to a table, skipping any that are already there. */
  addRows: (table: string, rows: Record<string, unknown>[]) => Promise<void>;
}> {
  const connection = await connect(link);
  return {
    run: (text, params = []) => runOn(connection, async (sql) => (await sql.unsafe(text, params)) as never),
    prepare: () => runOn(connection, async (sql) => void (await sql.unsafe(ownDatabaseSchema).simple())),
    addRows: (table, rows) =>
      runOn(connection, async (sql) => {
        // A few hundred at a time keeps each statement well inside the server's limits.
        for (let start = 0; start < rows.length; start += 300) {
          await sql`insert into ${sql(table)} ${sql(rows.slice(start, start + 300) as never)} on conflict do nothing`;
        }
      }),
  };
}

// ---------------------------------------------------------------------------
// Which database an account uses
// ---------------------------------------------------------------------------

interface Place {
  /** The encrypted link, or null for the platform's database. */
  link: string | null;
  schema: number;
}

// Refreshed every time an account is read (accounts.ts), which every request
// does before touching the account's records, so a change of database is
// picked up by the very next request.
const places = new Map<string, Place>();

/** Notes where an account's records live. Called wherever an account is read from the database. */
export function rememberDatabase(accountId: string, link: string | null, schema: number): void {
  // Demos come and go all day; the note is cheap to make again.
  if (places.size > 2000) places.clear();
  places.set(accountId, { link, schema });
}

async function placeOf(accountId: string): Promise<Place> {
  const known = places.get(accountId);
  if (known) return known;

  const [row] = await query<{ database_url: string | null; database_schema: number }>('select database_url, database_schema from accounts where id = $1', [
    accountId,
  ]);
  const place = { link: row?.database_url ?? null, schema: row?.database_schema ?? 0 };
  rememberDatabase(accountId, place.link, place.schema);
  return place;
}

// One update per database at a time, however many requests notice it is behind.
const updates = new Map<string, Promise<void>>();

async function bringUpToDate(accountId: string, link: string): Promise<void> {
  let update = updates.get(accountId);
  if (!update) {
    update = (async () => {
      await (await openDatabase(link)).prepare();
      await query('update accounts set database_schema = $2 where id = $1', [accountId, PRODUCT_SCHEMA_VERSION]);
      rememberDatabase(accountId, places.get(accountId)?.link ?? null, PRODUCT_SCHEMA_VERSION);
    })().finally(() => updates.delete(accountId));
    updates.set(accountId, update);
  }
  await update;
}

/**
 * Runs a query on an account's records, wherever they live. Everything a
 * product keeps for a customer goes through here; `query` (db.ts) is for the
 * platform's own tables.
 */
export async function queryFor<Row = Record<string, unknown>>(accountId: string, sql: string, params: Params = []): Promise<Row[]> {
  const place = await placeOf(accountId);
  if (!place.link) return query<Row>(sql, params);

  const link = openLink(place.link);
  if (place.schema < PRODUCT_SCHEMA_VERSION) await bringUpToDate(accountId, link);
  return (await openDatabase(link)).run<Row>(sql, params);
}
