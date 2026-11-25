/** A few figures showing how much one account uses its product, in that product's own terms. */
import type { APIRoute } from 'astro';
import { getAccountById } from '../../lib/accounts';
import { isFromDashboard, json, notFound } from '../../lib/internal';
import { products } from '../../lib/products';
import { isDay } from '../../lib/time';

export const GET: APIRoute = async ({ request, url }) => {
  if (!isFromDashboard(request)) return notFound();

  const since = url.searchParams.get('since');
  const account = await getAccountById(url.searchParams.get('id') ?? '');
  const product = account && products[account.product];
  if (!account || !product || !isDay(since)) return json([], 400);

  return json(await product.usage(account.id, since));
};
