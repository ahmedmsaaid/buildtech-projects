/**
 * Every customer's public address is /<slug>, whatever they bought. This
 * looks the slug up and hands the request to that product's own pages, which
 * live under /site/<the product's pages>/. The visitor's address does not change.
 */
import type { APIRoute } from 'astro';
import { getAccountBySlug } from '../../lib/accounts';
import { products } from '../../lib/products';

export const ALL: APIRoute = async (context) => {
  const account = await getAccountBySlug(context.params.slug ?? '');
  const product = account && products[account.product];
  if (!account || !product) return new Response(null, { status: 404 });

  const rest = context.params.path ? `/${context.params.path}` : '';
  return context.rewrite(`/site/${product.pages}/${account.slug}${rest}${context.url.search}`);
};
