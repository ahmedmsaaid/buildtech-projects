/**
 * Gives an account a database of its own and moves its records there.
 * The dashboard makes the database (or is handed its link) and calls this;
 * only this project knows which tables a product keeps.
 */
import type { APIRoute } from 'astro';
import { getAccountById } from '../../lib/accounts';
import { isFromDashboard, json, notFound } from '../../lib/internal';
import { moveToOwnDatabase } from '../../lib/move-data';
import { products } from '../../lib/products';

export const POST: APIRoute = async ({ request }) => {
  if (!isFromDashboard(request)) return notFound();

  const body = (await request.json().catch(() => null)) as { accountId?: unknown; link?: unknown; ref?: unknown } | null;
  const account = typeof body?.accountId === 'string' ? await getAccountById(body.accountId) : null;
  if (!account || !products[account.product]) return json({ ok: false, reason: 'unknown_account' }, 400);
  if (typeof body?.link !== 'string' || body.link.length > 600) return json({ ok: false, reason: 'bad_link' }, 400);

  const ref = typeof body.ref === 'string' && body.ref.length <= 80 ? body.ref : null;
  const result = await moveToOwnDatabase(account, body.link, ref);
  return json(result, result.ok ? 200 : 400);
};
