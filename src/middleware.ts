/**
 * Guards the customers' dashboards. Each product's dashboard needs a
 * signed-in user whose account bought that product; anyone else is sent to
 * the dashboard that is theirs.
 *
 * It also gives a customer's own address (see accounts.domain) its meaning:
 * there, the front page is that customer's page, not the platform's.
 *
 * The platform owner's dashboard is a separate project with its own sign-in.
 */
import { defineMiddleware } from 'astro:middleware';
import { getAccountById, getAccountOnHost } from './lib/accounts';
import { currentUser } from './lib/auth';
import { productList, products } from './lib/products';

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // The address the visitor typed. Behind the host's proxy it arrives in the
  // forwarded header. It only chooses which public page to show, never who is
  // signed in, so a made-up value gains nothing.
  const host = (context.request.headers.get('x-forwarded-host') ?? context.request.headers.get('host') ?? '').split(',')[0].trim().toLowerCase();
  const hostAccount = host ? await getAccountOnHost(host) : null;
  if (hostAccount) {
    context.locals.hostAccount = hostAccount;
    if (pathname === '/' && products[hostAccount.product]) return next(`/site/${hostAccount.product}/${hostAccount.slug}/${context.url.search}`);
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
