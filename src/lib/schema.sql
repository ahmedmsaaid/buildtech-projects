-- Database schema. Safe to run more than once.
--
-- This is the platform core: who the customers are, what they pay, who can
-- sign in, and the platform's own home page. It knows nothing about clinics
-- or any other product, and it lives in the platform's own database only.
--
-- What a customer keeps (bookings, menus, orders) is in schema-products.sql,
-- which is also what a customer's own database is made of.

-- ===========================================================================
-- 1. Platform core
-- ===========================================================================

-- The subscriptions on offer, per product. Edited by the owner at /owner/plans.
create table if not exists plans (
  id text primary key,
  product text not null,
  name text not null,
  -- How many months one payment covers.
  months integer not null check (months between 1 and 36),
  -- Whole Egyptian pounds per period.
  price integer not null check (price >= 0),
  sort_order integer not null default 0,
  -- Retired plans stay, so accounts already on them keep working.
  is_active boolean not null default true
);

-- One customer of one product: a clinic, a restaurant, and so on.
create table if not exists accounts (
  id text primary key,
  -- Which product this customer uses; a key of the registry in products.ts.
  product text not null,
  -- The customer's address on the web: /<slug>. Unique across all products.
  slug text not null unique,
  name text not null,

  -- A suspended account keeps its data, but its public page and dashboard are closed.
  status text not null default 'active' check (status in ('active', 'suspended')),
  -- Null while the account is still on its free trial.
  plan_id text references plans (id) on delete set null,
  -- Copied from the plan when it is chosen, so later changes to the plan or a
  -- special deal for this customer do not disturb each other.
  price integer not null default 0 check (price >= 0),
  period_months integer not null default 1 check (period_months between 1 and 36),
  -- The last day the subscription or trial covers, as 'YYYY-MM-DD'.
  paid_until text,

  -- Who to call about the subscription. Never shown to the customer's own visitors.
  contact_name text not null default '',
  contact_phone text not null default '',
  owner_note text not null default '',

  -- The customer's look: a color and a JSON object of choices (see theme.ts).
  accent text not null default '#0f766e',
  theme text not null default '{}',
  timezone text not null default 'Africa/Cairo',
  created_at timestamptz not null default now()
);

create index if not exists accounts_by_product on accounts (product, created_at desc);

-- Set on a demo: a throwaway account a visitor started from the site to try a
-- product. It is deleted, with everything in it, once this moment has passed.
-- Null for every real customer.
alter table accounts add column if not exists demo_expires_at timestamptz;
create index if not exists accounts_demos on accounts (demo_expires_at) where demo_expires_at is not null;

-- A web address of the customer's own, e.g. elnour-clinic.vercel.app, in
-- lower case. A visit to it opens this customer's page instead of the
-- platform's home page (see middleware.ts). Null for customers without one.
alter table accounts add column if not exists domain text;
create unique index if not exists accounts_domain on accounts (domain) where domain is not null;

-- A customer's own database, when they have one: their bookings, menu and
-- orders live there instead of here (see tenants.ts). The link holds that
-- database's password, so it is stored encrypted. Null keeps the customer's
-- records in this database, as demos always are.
alter table accounts add column if not exists database_url text;
-- The database's id at the host that made it (a Neon project), so it can be
-- removed there. Null for a database the owner made by hand.
alter table accounts add column if not exists database_ref text;
-- Which version of schema-products.sql that database has (see tenants.ts).
alter table accounts add column if not exists database_schema integer not null default 0;

-- People who sign in to an account's dashboard.
create table if not exists users (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  email text not null unique,
  password_hash text not null,
  name text not null default ''
);

create table if not exists sessions (
  -- Only a hash of the cookie value is stored, so a leaked table cannot sign anyone in.
  token_hash text primary key,
  user_id text not null references users (id) on delete cascade,
  expires_at timestamptz not null
);

-- The people who run the platform. Separate from customer users on purpose.
create table if not exists owners (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  name text not null default ''
);

create table if not exists owner_sessions (
  token_hash text primary key,
  owner_id text not null references owners (id) on delete cascade,
  expires_at timestamptz not null
);

-- Every subscription payment received from an account.
create table if not exists subscription_payments (
  id text primary key,
  account_id text not null references accounts (id) on delete cascade,
  amount integer not null check (amount >= 0),
  paid_on text not null,
  -- The subscription end date this payment moved the account to.
  covers_until text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists subscription_payments_by_account on subscription_payments (account_id, paid_on desc);
create index if not exists subscription_payments_by_day on subscription_payments (paid_on);

-- One-use passes that let the owner open a customer's dashboard from the
-- owner dashboard, which lives on another address (see pages/enter.ts).
-- A pass lasts a minute and is deleted when used.
create table if not exists dashboard_passes (
  token_hash text primary key,
  user_id text not null references users (id) on delete cascade,
  expires_at timestamptz not null
);

-- What happened on the platform and who did it: the owner's audit trail.
-- Rows are only ever added.
create table if not exists events (
  id text primary key,
  created_at timestamptz not null default now(),
  -- Who acted, as text, so the record survives the actor being deleted.
  actor text not null,
  -- The account concerned, when there is one. Kept as plain text for the same reason.
  account_id text,
  account_name text not null default '',
  -- A key of eventLabels in events.ts.
  action text not null,
  detail text not null default ''
);

create index if not exists events_by_time on events (created_at desc);
create index if not exists events_by_account on events (account_id, created_at desc);

-- ---------------------------------------------------------------------------
-- The platform's own home page, managed from the owner dashboard.
-- ---------------------------------------------------------------------------

-- Its words, color and picture, as one JSON document in a single row.
create table if not exists site_settings (
  id integer primary key default 1 check (id = 1),
  content jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Pictures the owner uploaded. Small (the dashboard caps their size), so they
-- live here instead of needing a separate file store.
create table if not exists site_images (
  id text primary key,
  mime text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

create table if not exists site_banners (
  id text primary key,
  title text not null,
  body text not null default '',
  -- Where the banner's button goes; empty for a banner with no button.
  link_url text not null default '',
  link_label text not null default '',
  image_id text references site_images (id) on delete set null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
