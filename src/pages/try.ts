/**
 * Starts a demo: a private, pre-filled copy of a product for the visitor,
 * who is signed in to it and sent to its dashboard. No sign-up.
 * POST only, so opening a link or a crawler can never create one.
 */
import type { APIRoute } from 'astro';
import { isDemoProduct, startDemo } from '../lib/demo';
import { demoLimiter } from '../lib/rate-limit';

export const POST: APIRoute = async ({ request, cookies, clientAddress, redirect, locals }) => {
  // Demos are BuildTech's offer; a customer's own address has only that customer on it.
  if (locals.hostAccount) return redirect('/login');

  const product = (await request.formData()).get('product');
  if (!isDemoProduct(product)) return redirect('/');
  if (demoLimiter.isLimited(clientAddress)) return redirect('/login?demo=later');

  return redirect(await startDemo(product, cookies));
};
