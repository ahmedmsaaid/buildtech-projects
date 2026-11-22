/**
 * Adds a clinic and its first staff account to the production database.
 *   DATABASE_URL=... npm run create-clinic -- <slug> "<clinic name>" <email>
 * It prints a one-time password for the account. The clinic then fills in
 * its hours and services from /admin/settings.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import postgres from 'postgres';

const [slug, name, email] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL first.');
if (!slug || !name || !email) throw new Error('Usage: npm run create-clinic -- <slug> "<clinic name>" <email>');
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug === 'admin') throw new Error('The slug must be lowercase letters, digits and dashes, and not "admin".');

const password = randomBytes(9).toString('base64url');
const salt = randomBytes(16);
const passwordHash = `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
const clinicId = crypto.randomUUID();

const sql = postgres(url, { prepare: false, max: 1 });
await sql.begin(async (tx) => {
  await tx`insert into clinics (id, slug, name) values (${clinicId}, ${slug}, ${name})`;
  await tx`insert into users (id, clinic_id, email, password_hash) values (${crypto.randomUUID()}, ${clinicId}, ${email.toLowerCase()}, ${passwordHash})`;
});
await sql.end();

console.log(`Clinic created: /${slug}`);
console.log(`Sign in at /admin with ${email} and this password (shown once): ${password}`);
