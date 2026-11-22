// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Every page is rendered on the server: bookings and the staff dashboard
// always show live data.
export default defineConfig({
  output: 'server',
  adapter: vercel(),
  // The local database engine ships WebAssembly that must not be bundled.
  vite: { ssr: { external: ['@electric-sql/pglite'] } },
});
