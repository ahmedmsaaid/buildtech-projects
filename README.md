# Clinic booking

Patients book an appointment from a clinic's own link (`/<clinic>`). The
front desk sees each day's appointments at `/admin`, marks who arrived, and
reminds patients on WhatsApp.

## Run it

```
npm install
npm run dev
```

Open http://localhost:4340. With no `DATABASE_URL`, the app keeps a local
database in `.data/` and creates a demo clinic at `/demo`. The demo sign-in
for `/admin` is in `src/lib/dev-seed.ts`. Delete `.data/` to start again.

The platform owner's dashboard is at `/owner`: every clinic, its
subscription and payments, suspending a clinic, and opening its dashboard.
Its demo sign-in is in the same file.

## How it is organised

The code has two layers, and so does the database (`src/lib/schema.sql`).

**Platform core** — the same for every product:

- `src/lib/accounts.ts` — an account is one customer of one product.
- `src/lib/platform.ts` — the owner's side: accounts, plans, subscriptions, payments.
- `src/lib/events.ts` — the audit trail of everything the owner does.
- `src/lib/products.ts` — the registry of products. The owner dashboard reads
  everything it needs about a product from here.
- `src/lib/theme.ts` — a customer's look.
- `src/pages/owner/` — the owner dashboard.

**Products** — two so far.

Clinic booking:

- `src/lib/clinics.ts` — a clinic's profile, hours and services.
- `src/lib/appointments.ts` — booking rules: free slots, the queue, payments.
- `src/pages/site/clinic/` — what patients see.
- `src/pages/admin/` — the clinic's dashboard, guarded by `src/middleware.ts`.

Restaurant menu and orders:

- `src/lib/restaurants.ts` — a restaurant's profile and its menu.
- `src/lib/orders.ts` — placing an order, the kitchen's day, reports.
- `src/pages/site/restaurant/` — the menu guests order from.
- `src/pages/restaurant/` — the restaurant's dashboard.

Every customer's public address is `/<slug>`; `src/pages/[slug]/[...path].ts`
hands the request to the right product's pages under `src/pages/site/`.
Staff of every product sign in at `/login`.

`src/lib/db.ts` is the only code that talks to the database.

### Adding a product

1. Add its tables to `schema.sql`, each hanging off an account id.
2. Write its module (like `clinics.ts`) with a setup function and a usage function.
3. Register it in `products.ts`.
4. Build its public pages and its dashboard.

The owner dashboard, plans, subscriptions and the log then work for it unchanged.

## Going live

1. Create a Postgres database (for example a Supabase project). Copy its
   connection string: in Supabase, Connect > Transaction pooler.
2. Paste it into `.env.deploy` after `DATABASE_URL=`. That file is ignored by
   git and is read only by the two commands below.
3. `npm run migrate` creates the tables.
4. `npm run create-owner -- <email> "<name>"` adds your owner account and
   prints its one-time password. Customers are then added from `/owner`.
5. On the host (for example Vercel), set the same `DATABASE_URL` as an
   environment variable and deploy.
