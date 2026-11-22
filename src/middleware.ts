/** Guards the staff dashboard: every /admin page needs a signed-in user. */
import { defineMiddleware } from 'astro:middleware';
import { currentUser } from './lib/auth';
import { getClinicById } from './lib/clinics';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (!pathname.startsWith('/admin')) return next();

  const user = await currentUser(context.cookies);
  const onSignIn = pathname === '/admin/login';

  if (!user) return onSignIn ? next() : context.redirect('/admin/login');
  if (onSignIn) return context.redirect('/admin');

  const clinic = await getClinicById(user.clinic_id);
  if (!clinic) return context.redirect('/admin/login');

  context.locals.user = user;
  context.locals.clinic = clinic;
  return next();
});
