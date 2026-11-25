/**
 * Where the owner lands when they open a customer's dashboard from their own
 * dashboard. The two are on different addresses, so the owner's dashboard
 * cannot sign this browser in directly: it leaves a one-use pass in the
 * database and sends the browser here with it.
 */
import type { APIRoute } from 'astro';
import { getAccountById } from '../lib/accounts';
import { hashToken, startSession } from '../lib/auth';
import { query } from '../lib/db';
import { products } from '../lib/products';

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const pass = url.searchParams.get('pass') ?? '';
  if (!/^[0-9a-f]{64}$/.test(pass)) return redirect('/login');

  // Deleting while reading makes the pass work exactly once, even if the address is opened twice.
  const [entry] = await query<{ user_id: string; account_id: string }>(
    `delete from dashboard_passes using users
     where dashboard_passes.token_hash = $1 and dashboard_passes.expires_at > now() and users.id = dashboard_passes.user_id
     returning dashboard_passes.user_id, users.account_id`,
    [hashToken(pass)],
  );
  if (!entry) return redirect('/login');

  const account = await getAccountById(entry.account_id);
  const product = account && products[account.product];
  if (!product) return redirect('/login');

  await startSession(cookies, entry.user_id);
  return redirect(product.dashboardPath);
};
