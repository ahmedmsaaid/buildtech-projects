/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly DATABASE_URL?: string;
  readonly INTERNAL_API_SECRET?: string;
}

declare namespace App {
  /** Set by the middleware; see src/middleware.ts. */
  interface Locals {
    /** On every product dashboard page, and on /suspended. */
    user: import('./lib/auth').StaffUser;
    account: import('./lib/accounts').Account;
    /** On the clinic dashboard (/admin). */
    clinic: import('./lib/clinics').Clinic;
    /** On the restaurant dashboard (/restaurant). */
    restaurant: import('./lib/restaurants').Restaurant;
  }
}
