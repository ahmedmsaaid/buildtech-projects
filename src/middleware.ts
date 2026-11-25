/**
 * Guards the customers' dashboards. Each product's dashboard needs a
 * signed-in user whose account bought that product; anyone else is sent to
 * the dashboard that is theirs.
 *
 * The platform owner's dashboard is a separate project with its own sign-in.
 */
import { defineMiddleware } from 'astro:middleware';
import { getAccountById } from './lib/accounts';
import { currentUser } from './lib/auth';
import { productList, products } from './lib/products';

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  const area = productList.find((product) => under(pathname, product.dashboardPath));
  if (!area && pathname !== '/suspended') return next();

  const user = await currentUser(context.cookies);
  const account = user && (await getAccountById(user.account_id));
  const own = account && products[account.product];
  if (!user || !account || !own) return context.redirect('/login');

  context.locals.user = user;
  context.locals.account = account;

  // A suspended account can only see why nothing opens, and sign out.
  if (pathname === '/suspended') return account.status === 'suspended' ? next() : context.redirect(own.dashboardPath);
  if (account.status === 'suspended') return context.redirect('/suspended');

  // A clinic's staff have no business in the restaurant dashboard, and so on.
  if (area !== own) return context.redirect(own.dashboardPath);

  await own.load(context.locals, account.id);
  return next();
});
