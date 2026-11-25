/**
 * The private interface between this project and the owner dashboard, which
 * is a separate project on another address.
 *
 * The dashboard reads and writes the shared database itself for everything
 * that is the same across products (accounts, plans, payments). It calls the
 * routes under /internal only for what a product alone knows how to do.
 * Both sides hold the same secret, INTERNAL_API_SECRET.
 */
import { timingSafeEqual } from 'node:crypto';

/** Long enough that it cannot be guessed; a shorter value is treated as not set. */
const MIN_SECRET_LENGTH = 32;

/** True when the request carries the shared secret. With no secret configured, nothing is allowed in. */
export function isFromDashboard(request: Request): boolean {
  const secret = (import.meta.env.INTERNAL_API_SECRET ?? process.env.INTERNAL_API_SECRET ?? '').trim();
  if (secret.length < MIN_SECRET_LENGTH) return false;

  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

/** What every /internal route answers to a caller without the secret: the route does not exist. */
export const notFound = () => new Response(null, { status: 404 });
