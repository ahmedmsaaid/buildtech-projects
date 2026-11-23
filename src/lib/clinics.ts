/** Reading and changing a clinic's own settings: details, hours and services. */
import { newId, query } from './db';

export interface Clinic {
  id: string;
  slug: string;
  name: string;
  specialty: string;
  doctor_name: string;
  address: string;
  phone: string;
  whatsapp: string;
  accent: string;
  slot_minutes: number;
  booking_days: number;
  timezone: string;
  about: string;
  map_url: string;
  cancel_hours: number;
  status: 'active' | 'suspended';
  plan: 'trial' | 'monthly' | 'yearly';
  price: number;
  /** Last day the subscription covers, or null when never paid. */
  paid_until: string | null;
  contact_name: string;
  contact_phone: string;
  owner_note: string;
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
  const [clinic] = await query<Clinic>('select * from clinics where slug = $1', [slug]);
  return clinic ?? null;
}

export async function getClinicById(id: string): Promise<Clinic | null> {
  const [clinic] = await query<Clinic>('select * from clinics where id = $1', [id]);
  return clinic ?? null;
}

/** All seven days, Sunday first. Days never saved come back as closed. */
export async function getWorkingWeek(clinicId: string): Promise<WorkingDay[]> {
  const saved = await query<WorkingDay>('select weekday, is_open, open_minute, close_minute from working_hours where clinic_id = $1', [clinicId]);
  return Array.from(
    { length: 7 },
    (_, weekday) => saved.find((day) => day.weekday === weekday) ?? { weekday, is_open: false, open_minute: 1020, close_minute: 1320 },
  );
}

export async function saveWorkingDay(clinicId: string, day: WorkingDay): Promise<void> {
  await query(
    `insert into working_hours (clinic_id, weekday, is_open, open_minute, close_minute) values ($1, $2, $3, $4, $5)
     on conflict (clinic_id, weekday) do update set is_open = excluded.is_open, open_minute = excluded.open_minute, close_minute = excluded.close_minute`,
    [clinicId, day.weekday, day.is_open, day.open_minute, day.close_minute],
  );
}

export function getServices(clinicId: string, options: { includeRetired?: boolean } = {}): Promise<Service[]> {
  const activeOnly = options.includeRetired ? '' : 'and is_active';
  return query<Service>(
    `select id, name, price, sort_order, is_active from services where clinic_id = $1 ${activeOnly} order by is_active desc, sort_order, name`,
    [clinicId],
  );
}

export async function addService(clinicId: string, name: string, price: number): Promise<void> {
  await query(
    `insert into services (id, clinic_id, name, price, sort_order)
     values ($1, $2, $3, $4, (select coalesce(max(sort_order), 0) + 1 from services where clinic_id = $2))`,
    [newId(), clinicId, name, price],
  );
}

export async function updateService(clinicId: string, id: string, changes: { name: string; price: number; is_active: boolean }): Promise<void> {
  await query('update services set name = $3, price = $4, is_active = $5 where clinic_id = $1 and id = $2', [
    clinicId,
    id,
    changes.name,
    changes.price,
    changes.is_active,
  ]);
}

export type ClinicDetails = Pick<
  Clinic,
  | 'name'
  | 'specialty'
  | 'doctor_name'
  | 'address'
  | 'phone'
  | 'whatsapp'
  | 'accent'
  | 'slot_minutes'
  | 'booking_days'
  | 'about'
  | 'map_url'
  | 'cancel_hours'
>;

export async function updateClinicDetails(clinicId: string, details: ClinicDetails): Promise<void> {
  await query(
    `update clinics set name = $2, specialty = $3, doctor_name = $4, address = $5, phone = $6, whatsapp = $7,
       accent = $8, slot_minutes = $9, booking_days = $10, about = $11, map_url = $12, cancel_hours = $13
     where id = $1`,
    [
      clinicId,
      details.name,
      details.specialty,
      details.doctor_name,
      details.address,
      details.phone,
      details.whatsapp,
      details.accent,
      details.slot_minutes,
      details.booking_days,
      details.about,
      details.map_url,
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
  return query<ClosedDay>('select day, reason from closed_days where clinic_id = $1 and day >= $2 order by day', [clinicId, fromDay]);
}

export async function isClosedDay(clinicId: string, day: string): Promise<boolean> {
  const [closed] = await query('select 1 from closed_days where clinic_id = $1 and day = $2', [clinicId, day]);
  return closed !== undefined;
}

export async function addClosedDay(clinicId: string, day: string, reason: string): Promise<void> {
  await query(
    'insert into closed_days (clinic_id, day, reason) values ($1, $2, $3) on conflict (clinic_id, day) do update set reason = excluded.reason',
    [clinicId, day, reason],
  );
}

export async function removeClosedDay(clinicId: string, day: string): Promise<void> {
  await query('delete from closed_days where clinic_id = $1 and day = $2', [clinicId, day]);
}
