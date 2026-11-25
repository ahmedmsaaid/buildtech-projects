-- Database schema. Safe to run more than once.
--
-- It has two layers:
--
--   1. The platform core: who the customers are, what they pay, and who can
--      sign in. It knows nothing about clinics or any other product.
--   2. Products. Each product keeps its own tables and hangs them off an
--      account. The clinic product is the only one so far.
--
-- A new product adds its own tables below and registers itself in
-- src/lib/products.ts. The core does not change.

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

-- ===========================================================================
-- 2. Product: clinic booking
--
-- Times are stored the way a clinic thinks about them: the calendar day as
-- 'YYYY-MM-DD' text and the time as minutes after midnight, both in the
-- account's own timezone. That keeps time zones out of every query.
-- ===========================================================================

-- What makes an account a clinic. Shares its id with the account.
create table if not exists clinics (
  id text primary key references accounts (id) on delete cascade,
  specialty text not null default '',
  doctor_name text not null default '',
  address text not null default '',
  phone text not null default '',
  whatsapp text not null default '',
  -- A short paragraph and a map link for the public page.
  about text not null default '',
  map_url text not null default '',
  -- Length of one appointment.
  slot_minutes integer not null default 20 check (slot_minutes between 5 and 240),
  -- How many days ahead patients may book.
  booking_days integer not null default 14 check (booking_days between 1 and 90),
  -- Patients may cancel online until this many hours before the appointment.
  cancel_hours integer not null default 2 check (cancel_hours between 0 and 72)
);

create table if not exists working_hours (
  clinic_id text not null references clinics (id) on delete cascade,
  -- 0 is Sunday, 6 is Saturday.
  weekday integer not null check (weekday between 0 and 6),
  is_open boolean not null default false,
  open_minute integer not null default 1020,
  close_minute integer not null default 1320,
  primary key (clinic_id, weekday),
  check (open_minute >= 0 and close_minute <= 1440 and open_minute < close_minute)
);

-- Single days the clinic is closed (holidays, travel), on top of the weekly hours.
create table if not exists closed_days (
  clinic_id text not null references clinics (id) on delete cascade,
  day text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  reason text not null default '',
  primary key (clinic_id, day)
);

create table if not exists services (
  id text primary key,
  clinic_id text not null references clinics (id) on delete cascade,
  name text not null,
  -- Whole Egyptian pounds. 0 shows no price.
  price integer not null default 0 check (price >= 0),
  sort_order integer not null default 0,
  -- Retired services stay, so old appointments keep their service.
  is_active boolean not null default true
);

create table if not exists appointments (
  id text primary key,
  clinic_id text not null references clinics (id) on delete cascade,
  service_id text references services (id) on delete set null,
  -- Copied at booking time, so later edits to a service do not rewrite history.
  service_name text not null default '',
  price integer not null default 0,
  -- What the patient actually paid, in whole pounds.
  paid integer not null default 0 check (paid >= 0),
  day text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  start_minute integer not null check (start_minute between 0 and 1439),
  patient_name text not null,
  patient_phone text not null,
  note text not null default '',
  status text not null default 'booked' check (status in ('booked', 'arrived', 'done', 'no_show', 'cancelled')),
  -- Who made it: the patient online, or staff at the desk.
  source text not null default 'online' check (source in ('online', 'staff')),
  -- When the patient was marked as arrived: this is their place in the queue.
  arrived_at timestamptz,
  created_at timestamptz not null default now()
);

-- One live appointment per slot. This is what makes double booking
-- impossible, even when two patients press "book" at the same moment.
create unique index if not exists appointments_slot_taken
  on appointments (clinic_id, day, start_minute)
  where status <> 'cancelled';

create index if not exists appointments_by_day on appointments (clinic_id, day);
create index if not exists appointments_by_phone on appointments (clinic_id, patient_phone);

-- The clinic's private note about a patient. Patients are known by phone number.
create table if not exists patient_notes (
  clinic_id text not null references clinics (id) on delete cascade,
  patient_phone text not null,
  note text not null default '',
  primary key (clinic_id, patient_phone)
);

-- ===========================================================================
-- 3. Product: restaurant menu and orders
--
-- Guests open the menu from a QR code on their table, or from a link, and
-- order from their phone. The kitchen sees orders arrive on its dashboard.
-- ===========================================================================

-- What makes an account a restaurant. Shares its id with the account.
create table if not exists restaurants (
  id text primary key references accounts (id) on delete cascade,
  cuisine text not null default '',
  address text not null default '',
  phone text not null default '',
  whatsapp text not null default '',
  about text not null default '',
  map_url text not null default '',
  -- Opening hours as the restaurant writes them, e.g. "يومياً من 12 الضهر لـ 12 بالليل".
  hours_note text not null default '',
  -- Tables are numbered 1 to this. Each gets its own QR code.
  tables_count integer not null default 10 check (tables_count between 0 and 200),
  -- Off pauses ordering; the menu stays readable.
  accepts_orders boolean not null default true,
  -- Whether guests may order without a table, to collect.
  allows_pickup boolean not null default true,
  -- Shown to guests as roughly how long an order takes.
  prep_minutes integer not null default 20 check (prep_minutes between 1 and 240)
);

create table if not exists menu_categories (
  id text primary key,
  restaurant_id text not null references restaurants (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists menu_items (
  id text primary key,
  restaurant_id text not null references restaurants (id) on delete cascade,
  category_id text not null references menu_categories (id) on delete cascade,
  name text not null,
  description text not null default '',
  -- Whole Egyptian pounds.
  price integer not null default 0 check (price >= 0),
  -- Off shows the item as sold out for now.
  is_available boolean not null default true,
  sort_order integer not null default 0
);

create index if not exists menu_items_by_category on menu_items (restaurant_id, category_id, sort_order);

create table if not exists orders (
  id text primary key,
  restaurant_id text not null references restaurants (id) on delete cascade,
  -- A short number that restarts every day; what staff and guests call the order.
  number integer not null,
  -- The calendar day in the restaurant's timezone, as 'YYYY-MM-DD'.
  day text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  type text not null check (type in ('dine_in', 'pickup')),
  -- Set for dine-in orders.
  table_number integer,
  customer_name text not null default '',
  customer_phone text not null default '',
  note text not null default '',
  status text not null default 'new' check (status in ('new', 'preparing', 'ready', 'done', 'cancelled')),
  -- Sum of the lines below, fixed when the order was placed.
  total integer not null default 0 check (total >= 0),
  created_at timestamptz not null default now(),
  unique (restaurant_id, day, number)
);

create index if not exists orders_by_day on orders (restaurant_id, day, created_at);

create table if not exists order_items (
  id text primary key,
  order_id text not null references orders (id) on delete cascade,
  item_id text references menu_items (id) on delete set null,
  -- Copied when the order was placed, so later menu edits do not rewrite it.
  name text not null,
  price integer not null,
  quantity integer not null check (quantity between 1 and 50)
);

create index if not exists order_items_by_order on order_items (order_id);
