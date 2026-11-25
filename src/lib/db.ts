/**
 * The one door to the database. Everything else calls `query`.
 *
 * With DATABASE_URL set it talks to that Postgres server (production).
 * Without it, it keeps a real Postgres database in the .data folder, so the
 * project runs on a fresh checkout with nothing to install or sign up for,
 * filled with demo data.
 * Both speak the same SQL, so the rest of the code does not know which is in use.
 */
import schema from './schema.sql?raw';

type Params = (string | number | boolean | null)[];
type Runner = <Row>(sql: string, params?: Params) => Promise<Row[]>;

const databaseUrl = (import.meta.env.DATABASE_URL ?? process.env.DATABASE_URL ?? '').trim();

/** True when the local development database is in use. */
export const usesLocalDatabase = databaseUrl === '';

async function connect(): Promise<Runner> {
  if (!usesLocalDatabase) {
    const { default: postgres } = await import('postgres');
    // Supabase's pooler does not support prepared statements.
    const sql = postgres(databaseUrl, { prepare: false, max: 3 });
    return async (text, params = []) => (await sql.unsafe(text, params)) as never;
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { mkdirSync } = await import('node:fs');
  mkdirSync('./.data', { recursive: true });
  const local = new PGlite('./.data/postgres');
  await local.exec(schema);
  const run: Runner = async (text, params = []) => (await local.query(text, params)).rows as never;

  const { seedDemoData } = await import('./dev-seed');
  await seedDemoData(run);
  await shareLocalDatabase(local);
  return run;
}

/** Where the local database listens for the owner dashboard, in development only. */
export const LOCAL_DATABASE_PORT = 54330;

/**
 * The owner dashboard is a separate project, so in development it cannot
 * open this database's files. This serves the same database over the network
 * on this machine only, so both projects see the same demo data.
 */
async function shareLocalDatabase(local: import('@electric-sql/pglite').PGlite): Promise<void> {
  try {
    const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
    await new PGLiteSocketServer({ db: local, port: LOCAL_DATABASE_PORT, host: '127.0.0.1' }).start();
  } catch (error) {
    // The port being busy must not stop this project from running by itself.
    console.warn('The local database is not shared with the dashboard:', error instanceof Error ? error.message : error);
  }
}

// Kept on globalThis so the dev server's reloads reuse one connection.
const shared = globalThis as { __clinicDb?: Promise<Runner> };

export async function query<Row = Record<string, unknown>>(sql: string, params: Params = []): Promise<Row[]> {
  // A failed connection is forgotten, so the next request tries again.
  shared.__clinicDb ??= connect().catch((error) => {
    shared.__clinicDb = undefined;
    throw error;
  });
  const run = await shared.__clinicDb;
  return run<Row>(sql, params);
}

/** True when a write failed because the row would duplicate a unique value. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export function newId(): string {
  return crypto.randomUUID();
}
