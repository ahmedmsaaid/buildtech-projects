/**
 * Creates or updates the tables in the production database.
 *   npm run migrate
 * Safe to run more than once.
 */
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Put the live database link in .env.deploy first.');

const sql = postgres(url, { prepare: false, max: 1 });
// The platform's own tables, then the product tables it keeps for demos and
// for customers without a database of their own. A customer's own database
// is kept up to date by the site itself (src/lib/tenants.ts).
for (const file of ['schema.sql', 'schema-products.sql']) {
  await sql.unsafe(await readFile(new URL(`../src/lib/${file}`, import.meta.url), 'utf8'));
}
await sql.end();
console.log('Database is up to date.');
