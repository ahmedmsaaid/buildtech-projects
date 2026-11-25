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
await sql.unsafe(await readFile(new URL('../src/lib/schema.sql', import.meta.url), 'utf8'));
await sql.end();
console.log('Database is up to date.');
