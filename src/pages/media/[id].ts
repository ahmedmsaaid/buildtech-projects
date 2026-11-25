/**
 * Serves a picture the owner uploaded for the home page or a banner.
 * A picture never changes once stored (a new upload gets a new address),
 * so browsers may keep it for good.
 */
import type { APIRoute } from 'astro';
import { getImage } from '../../lib/site';

export const GET: APIRoute = async ({ params }) => {
  const image = /^[0-9a-f-]{36}$/.test(params.id ?? '') ? await getImage(params.id ?? '') : null;
  if (!image) return new Response(null, { status: 404 });

  return new Response(image.bytes as BodyInit, {
    headers: {
      'content-type': image.mime,
      'cache-control': 'public, max-age=31536000, immutable',
      // The stored type was checked on upload; a browser must not guess another.
      'x-content-type-options': 'nosniff',
    },
  });
};
