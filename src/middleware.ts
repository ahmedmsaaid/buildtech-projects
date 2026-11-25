/**
 * Guards the private areas.
 *
 * /owner needs a signed-in platform owner. Each product's dashboard needs a
 * signed-in user whose account bought that product; anyone else is sent to
 * the dashboard that is theirs. The two kinds of sign-in are separate.
 */
import { defineMiddleware } from 'astro:middleware';
import { getAccountById } from './lib/accounts';
import { currentUser } from './lib/auth';
import { currentOwner } from './lib/owner-auth';
import { productList, products } from './lib/products';

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (under(pathname, '/owner')) {
    const owner = await currentOwner(context.cookies);
    const onSignIn = pathname === '/owner/login';

    if (!owner) return onSignIn ? next() : context.redirect('/owner/login');
    if (onSignIn) return context.redirect('/owner');

    context.locals.owner = owner;
    return next();
  }

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
