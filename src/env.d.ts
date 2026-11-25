/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly DATABASE_URL?: string;
}

declare namespace App {
  /** Set by the middleware; see src/middleware.ts. */
  interface Locals {
    /** On every product dashboard page, and on /suspended. */
    user: import('./lib/auth').StaffUser;
    account: import('./lib/accounts').Account;
    /** On the clinic dashboard (/admin). */
    clinic: import('./lib/clinics').Clinic;
    /** Set by the middleware on every /owner page except the sign-in page. */
    owner: import('./lib/owner-auth').Owner;
  }
}
