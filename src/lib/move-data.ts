/**
 * Gives a customer a database of their own and moves their records into it.
 * From then on nothing of theirs is kept in the platform's database except
 * the account itself, its subscription and its sign-ins.
 */
import type { Account } from './accounts';
import { query } from './db';
import { productOf } from './products';
import { cleanLink, openDatabase, PRODUCT_SCHEMA_VERSION, rememberDatabase, sealLink } from './tenants';

export type MoveResult = { ok: true; rows: number } | { ok: false; reason: 'bad_link' | 'is_demo' | 'has_one' | 'unreachable' | 'failed' };

/**
 * `link` is the new database's Postgres link; `ref` is its id at the host
 * that made it, when a host did. The database may be empty or already hold
 * these tables.
 */
export async function moveToOwnDatabase(account: Account, link: string, ref: string | null): Promise<MoveResult> {
  // A demo is thrown away in a day; it stays where it is cheap to delete.
  if (account.demo_expires_at) return { ok: false, reason: 'is_demo' };
  const [current] = await query<{ database_url: string | null }>('select database_url from accounts where id = $1', [account.id]);
  if (current?.database_url) return { ok: false, reason: 'has_one' };

  const clean = cleanLink(link);
  if (!clean) return { ok: false, reason: 'bad_link' };

  let own: Awaited<ReturnType<typeof openDatabase>>;
  try {
    own = await openDatabase(clean);
    await own.prepare();
  } catch (error) {
    console.error('Could not open or prepare a customer database:', error instanceof Error ? error.message : error);
    return { ok: false, reason: 'unreachable' };
  }

  const { tables } = productOf(account);
  const copy = async () => {
    let rows = 0;
    for (const table of tables) {
      const found = await query<Record<string, unknown>>(`select ${table.name}.* from ${table.name} where ${table.where}`, [account.id]);
      if (found.length > 0) await own.addRows(table.name, found);
      rows += found.length;
    }
    return rows;
  };

  try {
    const rows = await copy();

    const sealed = sealLink(clean);
    await query('update accounts set database_url = $2, database_ref = $3, database_schema = $4 where id = $1', [account.id, sealed, ref, PRODUCT_SCHEMA_VERSION]);
    rememberDatabase(account.id, sealed, PRODUCT_SCHEMA_VERSION);

    // From here on the customer is using the new database, so whatever goes
    // wrong below must not be reported as a failed move: the caller would
    // throw the new database away.
    try {
      // Anything written here while the copy ran (a booking made that very
      // second) is carried over too; rows already copied are skipped.
      await copy();
      // The customer's records now live in their database only.
      await query(`delete from ${tables[0].name} where id = $1`, [account.id]);
    } catch (error) {
      console.error('Tidying up after moving a customer failed; their old rows are still in the shared database:', error instanceof Error ? error.message : error);
    }
    return { ok: true, rows };
  } catch (error) {
    console.error('Moving a customer to their own database failed:', error instanceof Error ? error.message : error);
    return { ok: false, reason: 'failed' };
  }
}
