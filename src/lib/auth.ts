/**
 * Staff sign-in: password hashing and the session cookie.
 * Passwords are hashed with scrypt; the cookie holds a random token whose
 * hash is what the database stores.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { query } from './db';

const COOKIE = 'clinic_session';
const SESSION_DAYS = 30;

export interface StaffUser {
  id: string;
  account_id: string;
  email: string;
  name: string;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
}

/** A random password to hand to a new account once; the user is told to keep it safe. */
export function generatePassword(): string {
  return randomBytes(9).toString('base64url');
}

export function passwordMatches(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, Buffer.from(salt, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Signs in and sets the cookie. Returns false for a wrong email or password. */
export async function signIn(cookies: AstroCookies, email: string, password: string): Promise<boolean> {
  const [user] = await query<{ id: string; password_hash: string }>('select id, password_hash from users where email = $1', [
    email.trim().toLowerCase(),
  ]);
  if (!user || !passwordMatches(password, user.password_hash)) return false;

  await startSession(cookies, user.id);
  return true;
}

/**
 * Signs the browser in as a staff member without a password. Only for code
 * that has already established the right to do so: a correct password above,
 * or the platform owner opening a clinic's dashboard.
 */
export async function startSession(cookies: AstroCookies, userId: string): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await query('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)', [hashToken(token), userId, expires.toISOString()]);
  cookies.set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: import.meta.env.PROD, path: '/', expires });
}

/** The signed-in staff member, or null. */
export async function currentUser(cookies: AstroCookies): Promise<StaffUser | null> {
  const token = cookies.get(COOKIE)?.value;
  if (!token) return null;

  const [user] = await query<StaffUser>(
    `select users.id, users.account_id, users.email, users.name
     from sessions join users on users.id = sessions.user_id
     where sessions.token_hash = $1 and sessions.expires_at > now()`,
    [hashToken(token)],
  );
  return user ?? null;
}

export async function signOut(cookies: AstroCookies): Promise<void> {
  const token = cookies.get(COOKIE)?.value;
  if (token) await query('delete from sessions where token_hash = $1', [hashToken(token)]);
  cookies.delete(COOKIE, { path: '/' });
}
