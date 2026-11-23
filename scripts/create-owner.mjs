/**
 * Adds a platform owner account to the production database.
 *   DATABASE_URL=... npm run create-owner -- <email> "<name>"
 * It prints a one-time password for the account.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import postgres from 'postgres';

const [email, name = ''] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL first.');
if (!email) throw new Error('Usage: npm run create-owner -- <email> "<name>"');

const password = randomBytes(12).toString('base64url');
const salt = randomBytes(16);
const passwordHash = `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;

const sql = postgres(url, { prepare: false, max: 1 });
await sql`insert into owners (id, email, password_hash, name) values (${crypto.randomUUID()}, ${email.toLowerCase()}, ${passwordHash}, ${name})`;
await sql.end();

console.log(`Owner created. Sign in at /owner with ${email} and this password (shown once): ${password}`);
