-- Clinic booking schema. Safe to run more than once.
--
-- Times are stored the way a clinic thinks about them: the calendar day as
-- 'YYYY-MM-DD' text and the time as minutes after midnight, both in the
-- clinic's own timezone. That keeps time zones out of every query.

create table if not exists clinics (
  id text primary key,
  -- The clinic's address on the web: /<slug>
  slug text not null unique,
  name text not null,
  specialty text not null default '',
  doctor_name text not null default '',
  address text not null default '',
  phone text not null default '',
  whatsapp text not null default '',
  accent text not null default '#0f766e',
  -- Length of one appointment.
  slot_minutes integer not null default 20 check (slot_minutes between 5 and 240),
  -- How many days ahead patients may book.
  booking_days integer not null default 14 check (booking_days between 1 and 90),
  timezone text not null default 'Africa/Cairo',
  created_at timestamptz not null default now()
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

create table if not exists users (
  id text primary key,
  clinic_id text not null references clinics (id) on delete cascade,
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

create table if not exists appointments (
  id text primary key,
  clinic_id text not null references clinics (id) on delete cascade,
  service_id text references services (id) on delete set null,
  -- Copied at booking time, so later edits to a service do not rewrite history.
  service_name text not null default '',
  price integer not null default 0,
  day text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  start_minute integer not null check (start_minute between 0 and 1439),
  patient_name text not null,
  patient_phone text not null,
  note text not null default '',
  status text not null default 'booked' check (status in ('booked', 'arrived', 'done', 'no_show', 'cancelled')),
  -- Who made it: the patient online, or staff at the desk.
  source text not null default 'online' check (source in ('online', 'staff')),
  created_at timestamptz not null default now()
);

-- One live appointment per slot. This is what makes double booking
-- impossible, even when two patients press "book" at the same moment.
create unique index if not exists appointments_slot_taken
  on appointments (clinic_id, day, start_minute)
  where status <> 'cancelled';

create index if not exists appointments_by_day on appointments (clinic_id, day);
create index if not exists appointments_by_phone on appointments (clinic_id, patient_phone);
