/**
 * Try-before-you-ask demos. A visitor presses "try it" and gets a private
 * copy of a product, already full of sample data, with no sign-up: an
 * account of their own that nobody else can see or spoil, removed a day later.
 *
 * A demo is an ordinary account with `demo_expires_at` set. Everything else
 * in the product treats it exactly like a customer's.
 */
import { randomBytes } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { hashPassword, startSession } from './auth';
import { newId, query } from './db';
import { demoNames, fillClinic, fillRestaurant } from './demo-data';
import { products } from './products';
import { addDays, nowIn } from './time';

const TIMEZONE = 'Africa/Cairo';
/** How long a demo lives. */
export const DEMO_HOURS = 24;
/** The most demos kept at once. Beyond this the oldest make room, so demos can never fill the database. */
const MAX_LIVE_DEMOS = 150;

export type DemoProduct = keyof typeof demoNames;

export function isDemoProduct(value: unknown): value is DemoProduct {
  return typeof value === 'string' && value in demoNames;
}

/** Removes demos past their time, and the oldest ones when there are too many. Their data goes with them. */
async function clearOldDemos(): Promise<void> {
  await query('delete from accounts where demo_expires_at < now()');
  await query(
    `delete from accounts where id in (
       select id from accounts where demo_expires_at is not null order by demo_expires_at desc offset $1
     )`,
    [MAX_LIVE_DEMOS - 1],
  );
}

/**
 * Creates a demo of a product, signs this browser in to it, and returns the
 * dashboard to open. The demo's sign-in has a random password nobody is
 * told: the only way in is the session started here.
 */
export async function startDemo(product: DemoProduct, cookies: AstroCookies): Promise<string> {
  await clearOldDemos();

  const today = nowIn(TIMEZONE).day;
  const accountId = newId();
  const tag = randomBytes(4).toString('hex');
  const { name, contact } = demoNames[product];

  await query(
    `insert into accounts (id, product, slug, name, paid_until, contact_name, accent, timezone, demo_expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(hours => $9))`,
    [accountId, product, `demo-${tag}`, name, addDays(today, 30), contact, product === 'restaurant' ? '#b45309' : '#0f766e', TIMEZONE, DEMO_HOURS],
  );

  if (product === 'clinic') {
    await fillClinic(query, accountId, today, {
      doctor: contact,
      specialty: 'باطنة وجهاز هضمي',
      about: 'استشاري الباطنة والجهاز الهضمي والمناظير. خبرة أكتر من 15 سنة في تشخيص وعلاج أمراض المعدة والقولون والكبد.',
    });
  } else {
    await fillRestaurant(query, accountId, today);
  }

  const userId = newId();
  await query('insert into users (id, account_id, email, password_hash, name) values ($1, $2, $3, $4, $5)', [
    userId,
    accountId,
    `demo-${tag}@demo.invalid`,
    hashPassword(randomBytes(24).toString('hex')),
    'زائر',
  ]);

  await startSession(cookies, userId);
  return products[product].dashboardPath;
}

/** Whole hours left before a demo is removed, never less than one while it still exists. */
export function demoHoursLeft(expiresAt: string | Date): number {
  return Math.max(1, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 3_600_000));
}
