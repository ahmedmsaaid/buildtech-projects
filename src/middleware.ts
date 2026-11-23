/**
 * Guards the two private areas. /admin needs a signed-in clinic account and
 * /owner needs a signed-in platform owner; the two sign-ins are separate.
 */
import { defineMiddleware } from 'astro:middleware';
import { currentUser } from './lib/auth';
import { getClinicById } from './lib/clinics';
import { currentOwner } from './lib/owner-auth';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (pathname.startsWith('/owner')) {
    const owner = await currentOwner(context.cookies);
    const onSignIn = pathname === '/owner/login';

    if (!owner) return onSignIn ? next() : context.redirect('/owner/login');
    if (onSignIn) return context.redirect('/owner');

    context.locals.owner = owner;
    return next();
  }

  if (!pathname.startsWith('/admin')) return next();

  const user = await currentUser(context.cookies);
  const onSignIn = pathname === '/admin/login';

  if (!user) return onSignIn ? next() : context.redirect('/admin/login');
  if (onSignIn) return context.redirect('/admin');

  const clinic = await getClinicById(user.clinic_id);
  if (!clinic) return context.redirect('/admin/login');

  context.locals.user = user;
  context.locals.clinic = clinic;

  // A suspended clinic can sign in and sign out, and see why nothing else opens.
  const allowedWhileSuspended = pathname === '/admin/suspended' || pathname === '/admin/logout';
  if (clinic.status === 'suspended' && !allowedWhileSuspended) return context.redirect('/admin/suspended');
  if (clinic.status === 'active' && pathname === '/admin/suspended') return context.redirect('/admin');

  return next();
});
