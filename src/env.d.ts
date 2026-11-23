/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly DATABASE_URL?: string;
}

declare namespace App {
  /** Set by the middleware on every /admin page except the sign-in page. */
  interface Locals {
    user: import('./lib/auth').StaffUser;
    clinic: import('./lib/clinics').Clinic;
    /** Set by the middleware on every /owner page except the sign-in page. */
    owner: import('./lib/owner-auth').Owner;
  }
}
