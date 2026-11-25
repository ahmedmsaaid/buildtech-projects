/**
 * Turns a new account into a working customer of its product (a clinic gets
 * its hours and a first service, a restaurant its first menu section).
 * The dashboard creates the account and its sign-in, then calls this.
 */
import type { APIRoute } from 'astro';
import { getAccountById } from '../../lib/accounts';
import { isFromDashboard, json, notFound } from '../../lib/internal';
import { products } from '../../lib/products';

export const POST: APIRoute = async ({ request }) => {
  if (!isFromDashboard(request)) return notFound();

  const body = (await request.json().catch(() => null)) as { accountId?: unknown; answers?: unknown } | null;
  const account = typeof body?.accountId === 'string' ? await getAccountById(body.accountId) : null;
  const product = account && products[account.product];
  if (!account || !product) return json({ ok: false, reason: 'unknown_account' }, 400);

  // Only the product's own questions are passed on, each as short text.
  const given = body?.answers && typeof body.answers === 'object' ? (body.answers as Record<string, unknown>) : {};
  const answers = Object.fromEntries(product.setupFields.map((field) => [field.name, String(given[field.name] ?? '').slice(0, 80)]));

  await product.setUp(account.id, answers, account.contact_phone);
  return json({ ok: true });
};
