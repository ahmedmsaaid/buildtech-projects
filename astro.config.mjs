// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Every page is rendered on the server: bookings and the staff dashboard
// always show live data.
export default defineConfig({
  output: 'server',
  // Moving a customer's records into a database of their own takes longer than a page.
  adapter: vercel({ maxDuration: 60 }),
  // The local database engine ships WebAssembly that must not be bundled.
  vite: { ssr: { external: ['@electric-sql/pglite', '@electric-sql/pglite-socket'] } },
});
