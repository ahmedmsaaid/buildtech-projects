-- What a customer of each product keeps. Safe to run more than once.
--
-- These tables exist in two places: in the platform's database, for demos
-- and for customers without a database of their own, and in each customer's
-- own database, where the references to `accounts` are left out because that
-- table is not there (see tenants.ts).
--
-- After changing this file, raise PRODUCT_SCHEMA_VERSION in tenants.ts so
-- every customer's database picks the change up.
--
-- A new product adds its own tables below and registers itself in
-- src/lib/products.ts.

-- ===========================================================================
-- Product: clinic booking
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

-- The people who take the bookings: a salon's barbers, a clinic's doctors.
-- Optional. A place with none takes one booking per slot; with a team, each
-- member takes one, and the visitor may choose whom.
create table if not exists staff (
  id text primary key,
  clinic_id text not null references clinics (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  -- Someone who left stays, so their past bookings keep their name.
  is_active boolean not null default true
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

-- Who takes the booking, when the place has a team. The name is copied so it
-- survives the member being renamed or removed.
alter table appointments add column if not exists staff_id text references staff (id) on delete set null;
alter table appointments add column if not exists staff_name text not null default '';

-- One live appointment per slot and per team member (or per slot, for a
-- place without a team). This is what makes double booking impossible, even
-- when two people press "book" at the same moment.
drop index if exists appointments_slot_taken;
create unique index if not exists appointments_slot_taken_by
  on appointments (clinic_id, day, start_minute, coalesce(staff_id, ''))
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
-- Product: restaurant menu and orders
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
