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

- `src/lib/schema.sql` — the tables, and the index that prevents double booking.
- `src/lib/db.ts` — the only code that talks to the database.
- `src/lib/appointments.ts` — booking rules: free slots, taking one, the day view.
- `src/lib/clinics.ts` — a clinic's details, hours and services.
- `src/pages/[clinic]/` — what patients see.
- `src/pages/admin/` — the staff dashboard, guarded by `src/middleware.ts`.
- `src/pages/owner/` and `src/lib/platform.ts` — the platform owner's side.

## Going live

1. Create a Postgres database (for example a Supabase project) and put its
   connection string in `DATABASE_URL`.
2. `npm run migrate` creates the tables.
3. `npm run create-owner -- <email> "<name>"` adds your owner account and
   prints its one-time password. Clinics are then added from `/owner`.
