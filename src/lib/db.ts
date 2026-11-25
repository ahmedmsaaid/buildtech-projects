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
export interface Statement {
  sql: string;
  params: Params;
}
interface Database {
  run: Runner;
  /** Runs many statements in order as one transaction: all of them happen, or none. */
  runAll: (statements: Statement[]) => Promise<void>;
}

const databaseUrl = (import.meta.env.DATABASE_URL ?? process.env.DATABASE_URL ?? '').trim();

/** True when the local development database is in use. */
export const usesLocalDatabase = databaseUrl === '';

/**
 * Puts a statement's values into its text, which is what lets many statements
 * travel together (see runAll). Text values are quoted the way Postgres
 * expects, with any quote inside doubled, so a value can never end its own
 * quotes and be read as SQL. Even so, `queryAll` is meant for rows the server
 * made up itself, like demo data; what people type goes through `query`.
 */
function withValuesWrittenIn({ sql, params }: Statement): string {
  return sql.replace(/\$(\d+)/g, (_, position: string) => {
    const value = params[Number(position) - 1];
    if (value === undefined) throw new Error(`Statement has no value for $${position}`);
    if (value === null) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('A number sent to the database must be finite');
      return String(value);
    }
    // Postgres cannot store this character, and a backslash would only matter
    // with a setting Postgres turned off by default years ago; refuse both.
    if (value.includes('\0') || value.includes('\\')) throw new Error('This text cannot be written in a batch');
    return `'${value.replaceAll("'", "''")}'`;
  });
}

async function connect(): Promise<Database> {
  if (!usesLocalDatabase) {
    const { default: postgres } = await import('postgres');
    // Supabase's pooler does not support prepared statements.
    const sql = postgres(databaseUrl, { prepare: false, max: 3 });
    return {
      run: async (text, params = []) => (await sql.unsafe(text, params)) as never,
      // Sent as one piece of text, so hundreds of rows cost one trip to the server
      // instead of one each. Postgres runs such a text as a single transaction.
      runAll: async (statements) => {
        await sql.unsafe(statements.map(withValuesWrittenIn).join(';\n')).simple();
      },
    };
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
  return {
    run,
    runAll: (statements) =>
      local.transaction(async (transaction) => {
        for (const statement of statements) await transaction.query(statement.sql, statement.params);
      }),
  };
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
const shared = globalThis as { __clinicDb?: Promise<Database> };

function database(): Promise<Database> {
  // A failed connection is forgotten, so the next request tries again.
  shared.__clinicDb ??= connect().catch((error) => {
    shared.__clinicDb = undefined;
    throw error;
  });
  return shared.__clinicDb;
}

export async function query<Row = Record<string, unknown>>(sql: string, params: Params = []): Promise<Row[]> {
  return (await database()).run<Row>(sql, params);
}

/**
 * Writes many rows at once, in order, as one transaction. Use it instead of a
 * loop of `query` calls: the database is far from the server, and each
 * separate call is a trip there and back.
 */
export async function queryAll(statements: Statement[]): Promise<void> {
  if (statements.length > 0) await (await database()).runAll(statements);
}

/** True when a write failed because the row would duplicate a unique value. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export function newId(): string {
  return crypto.randomUUID();
}
