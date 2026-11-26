/**
 * The clinic product's own settings: the clinic's profile, hours, days off
 * and services. A clinic is an account (accounts.ts) plus the profile below;
 * the two share one id.
 */
import { getAccountById, getAccountBySlug, type Account } from './accounts';
import { newId, query } from './db';
import { queryFor } from './tenants';
import { takesBookings, wordsForBooking } from './words';

export interface ClinicProfile {
  specialty: string;
  doctor_name: string;
  address: string;
  phone: string;
  whatsapp: string;
  about: string;
  map_url: string;
  slot_minutes: number;
  booking_days: number;
  cancel_hours: number;
}

/** A clinic as the rest of the product uses it: the account and its profile together. */
export type Clinic = Account & ClinicProfile;

const PROFILE_COLUMNS = 'specialty, doctor_name, address, phone, whatsapp, about, map_url, slot_minutes, booking_days, cancel_hours';

/** Joins an account with its clinic profile, which is kept with the clinic's other records. Null when the account's product does not take bookings. */
async function asClinic(account: Account | null): Promise<Clinic | null> {
  if (!account || !takesBookings(account.product)) return null;
  const [profile] = await queryFor<ClinicProfile>(account.id, `select ${PROFILE_COLUMNS} from clinics where id = $1`, [account.id]);
  return profile ? { ...account, ...profile } : null;
}

export interface WorkingDay {
  weekday: number;
  is_open: boolean;
  open_minute: number;
  close_minute: number;
}

export interface Service {
  id: string;
  name: string;
  price: number;
  sort_order: number;
  is_active: boolean;
}

export async function getClinicBySlug(slug: string): Promise<Clinic | null> {
  return asClinic(await getAccountBySlug(slug));
}

export async function getClinicById(id: string): Promise<Clinic | null> {
  return asClinic(await getAccountById(id));
}

/**
 * Turns a new account into a working clinic: its profile, evening hours on
 * six days, and one kind of visit. The clinic then adjusts all of it in its
 * own settings. Called by the platform when an account of this product is created.
 */
export async function setUpClinic(accountId: string, product: string, profile: { doctorName: string; specialty: string; phone: string }): Promise<void> {
  // A barbershop does not start with a clinic's hours or its twenty-minute visits.
  const start = wordsForBooking(product);
  await queryFor(accountId, 'insert into clinics (id, doctor_name, specialty, phone, whatsapp, slot_minutes) values ($1, $2, $3, $4, $4, $5)', [
    accountId,
    profile.doctorName,
    profile.specialty,
    profile.phone,
    start.slotMinutes,
  ]);

  // Saturday to Thursday, at the hours this kind of business usually keeps.
  for (let weekday = 0; weekday < 7; weekday++) {
    await saveWorkingDay(accountId, { weekday, is_open: weekday !== 5, open_minute: start.openMinute, close_minute: start.closeMinute });
  }
  await addService(accountId, start.firstService, 0);
}

/** All seven days, Sunday first. Days never saved come back as closed. */
export async function getWorkingWeek(clinicId: string): Promise<WorkingDay[]> {
  const saved = await queryFor<WorkingDay>(clinicId, 'select weekday, is_open, open_minute, close_minute from working_hours where clinic_id = $1', [clinicId]);
  return Array.from(
    { length: 7 },
    (_, weekday) => saved.find((day) => day.weekday === weekday) ?? { weekday, is_open: false, open_minute: 1020, close_minute: 1320 },
  );
}

export async function saveWorkingDay(clinicId: string, day: WorkingDay): Promise<void> {
  await queryFor(clinicId, 
    `insert into working_hours (clinic_id, weekday, is_open, open_minute, close_minute) values ($1, $2, $3, $4, $5)
     on conflict (clinic_id, weekday) do update set is_open = excluded.is_open, open_minute = excluded.open_minute, close_minute = excluded.close_minute`,
    [clinicId, day.weekday, day.is_open, day.open_minute, day.close_minute],
  );
}

export function getServices(clinicId: string, options: { includeRetired?: boolean } = {}): Promise<Service[]> {
  const activeOnly = options.includeRetired ? '' : 'and is_active';
  return queryFor<Service>(clinicId, 
    `select id, name, price, sort_order, is_active from services where clinic_id = $1 ${activeOnly} order by is_active desc, sort_order, name`,
    [clinicId],
  );
}

export async function addService(clinicId: string, name: string, price: number): Promise<void> {
  await queryFor(clinicId, 
    `insert into services (id, clinic_id, name, price, sort_order)
     values ($1, $2, $3, $4, (select coalesce(max(sort_order), 0) + 1 from services where clinic_id = $2))`,
    [newId(), clinicId, name, price],
  );
}

export async function updateService(clinicId: string, id: string, changes: { name: string; price: number; is_active: boolean }): Promise<void> {
  await queryFor(clinicId, 'update services set name = $3, price = $4, is_active = $5 where clinic_id = $1 and id = $2', [
    clinicId,
    id,
    changes.name,
    changes.price,
    changes.is_active,
  ]);
}

export interface StaffMember {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

/** The people who take bookings, in the place's order. Empty for a place that works as one. */
export function getStaff(clinicId: string, options: { includeRetired?: boolean } = {}): Promise<StaffMember[]> {
  const activeOnly = options.includeRetired ? '' : 'and is_active';
  return queryFor<StaffMember>(
    clinicId,
    `select id, name, sort_order, is_active from staff where clinic_id = $1 ${activeOnly} order by is_active desc, sort_order, name`,
    [clinicId],
  );
}

export async function addStaff(clinicId: string, name: string): Promise<void> {
  await queryFor(
    clinicId,
    `insert into staff (id, clinic_id, name, sort_order)
     values ($1, $2, $3, (select coalesce(max(sort_order), 0) + 1 from staff where clinic_id = $2))`,
    [newId(), clinicId, name],
  );
}

export async function updateStaff(clinicId: string, id: string, changes: { name: string; is_active: boolean }): Promise<void> {
  await queryFor(clinicId, 'update staff set name = $3, is_active = $4 where clinic_id = $1 and id = $2', [clinicId, id, changes.name, changes.is_active]);
}

/** What a clinic edits in its own settings: its name and its whole profile. */
export type ClinicDetails = { name: string } & ClinicProfile;

export async function updateClinicDetails(clinicId: string, details: ClinicDetails): Promise<void> {
  // The name belongs to the account; everything else is the clinic's profile.
  await query('update accounts set name = $2 where id = $1', [clinicId, details.name]);
  await queryFor(clinicId, 
    `update clinics set specialty = $2, doctor_name = $3, address = $4, phone = $5, whatsapp = $6, about = $7, map_url = $8,
       slot_minutes = $9, booking_days = $10, cancel_hours = $11
     where id = $1`,
    [
      clinicId,
      details.specialty,
      details.doctor_name,
      details.address,
      details.phone,
      details.whatsapp,
      details.about,
      details.map_url,
      details.slot_minutes,
      details.booking_days,
      details.cancel_hours,
    ],
  );
}

export interface ClosedDay {
  day: string;
  reason: string;
}

/** Days off from `fromDay` onward, soonest first. */
export function getClosedDays(clinicId: string, fromDay: string): Promise<ClosedDay[]> {
  return queryFor<ClosedDay>(clinicId, 'select day, reason from closed_days where clinic_id = $1 and day >= $2 order by day', [clinicId, fromDay]);
}

export async function isClosedDay(clinicId: string, day: string): Promise<boolean> {
  const [closed] = await queryFor(clinicId, 'select 1 from closed_days where clinic_id = $1 and day = $2', [clinicId, day]);
  return closed !== undefined;
}

export async function addClosedDay(clinicId: string, day: string, reason: string): Promise<void> {
  await queryFor(clinicId, 
    'insert into closed_days (clinic_id, day, reason) values ($1, $2, $3) on conflict (clinic_id, day) do update set reason = excluded.reason',
    [clinicId, day, reason],
  );
}

export async function removeClosedDay(clinicId: string, day: string): Promise<void> {
  await queryFor(clinicId, 'delete from closed_days where clinic_id = $1 and day = $2', [clinicId, day]);
}

/** How much a clinic is being used, for the platform owner. */
export async function getClinicUsage(clinicId: string, since: string, product: string): Promise<{ label: string; value: string }[]> {
  const [usage] = await queryFor<{ bookings: number; online: number; patients: number }>(clinicId, 
    `select
       count(*) filter (where day >= $2 and status <> 'cancelled')::int as bookings,
       count(*) filter (where day >= $2 and status <> 'cancelled' and source = 'online')::int as online,
       count(distinct patient_phone)::int as patients
     from appointments where clinic_id = $1`,
    [clinicId, since],
  );
  const onlineShare = usage.bookings === 0 ? 0 : Math.round((usage.online / usage.bookings) * 100);
  return [
    { label: 'حجز في 30 يوم', value: String(usage.bookings) },
    { label: wordsForBooking(product).client1, value: String(usage.patients) },
    { label: 'حجز أونلاين', value: `${onlineShare}%` },
  ];
}
