import type { APIRoute } from 'astro';
import { signOut } from '../lib/auth';

/** POST only, so a link on another site cannot sign someone out. */
export const POST: APIRoute = async ({ cookies, redirect }) => {
  await signOut(cookies);
  return redirect('/login');
};
