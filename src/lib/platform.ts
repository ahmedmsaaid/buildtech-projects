/**
 * The platform owner's side: every clinic, its subscription, and its accounts.
 * Unlike the rest of the code, these queries are not limited to one clinic,
 * so they are only ever called from /owner pages.
 */
import { generatePassword, hashPassword } from './auth';
import type { Clinic } from './clinics';
import { isUniqueViolation, newId, query } from './db';
import { addDays, addMonths, daysBetween } from './time';

export const planLabels: Record<Clinic['plan'], string> = { trial: 'تجربة', monthly: 'شهري', yearly: 'سنوي' };
export const planMonths: Record<Clinic['plan'], number> = { trial: 0, monthly: 1, yearly: 12 };

/** How long a new clinic may try the product before it has to pay. */
const TRIAL_DAYS = 14;

export type SubscriptionState = 'suspended' | 'expired' | 'expiring' | 'active';

/** Where a clinic's subscription stands today. "Expiring" means a week or less is left. */
export function subscriptionState(clinic: Pick<Clinic, 'status' | 'paid_until'>, today: string): SubscriptionState {
  if (clinic.status === 'suspended') return 'suspended';
  if (!clinic.paid_until || clinic.paid_until < today) return 'expired';
  return daysBetween(today, clinic.paid_until) <= 7 ? 'expiring' : 'active';
}

export const stateLabels: Record<SubscriptionState, string> = {
  suspended: 'موقوفة',
  expired: 'الاشتراك منتهي',
  expiring: 'قرّب ينتهي',
  active: 'شغّالة',
};

export interface ClinicRow extends Clinic {
  bookings_30d: number;
  last_booking_day: string | null;
}

/** Every clinic with how much it is being used, newest first. */
export function listClinics(search: string, since: string): Promise<ClinicRow[]> {
  return query<ClinicRow>(
    `select clinics.*,
       (select count(*)::int from appointments
          where appointments.clinic_id = clinics.id and appointments.day >= $2 and appointments.status <> 'cancelled') as bookings_30d,
       (select max(day) from appointments where appointments.clinic_id = clinics.id) as last_booking_day
     from clinics
     where $1 = '' or clinics.name ilike '%' || $1 || '%' or clinics.slug ilike '%' || $1 || '%' or clinics.doctor_name ilike '%' || $1 || '%'
     order by clinics.created_at desc`,
    [search, since],
  );
}

export interface NewClinic {
  slug: string;
  name: string;
  specialty: string;
  doctorName: string;
  contactName: string;
  contactPhone: string;
  staffEmail: string;
  plan: Clinic['plan'];
  price: number;
}

export type CreateClinicResult =
  | { ok: true; clinicId: string; password: string }
  | { ok: false; reason: 'slug_taken' | 'email_taken' };

/**
 * Creates a clinic that is ready to open: evening hours on six days, one
 * kind of visit, and a first staff account. Returns that account's password,
 * which exists nowhere else, so the caller must show it once.
 */
export async function createClinic(input: NewClinic, today: string): Promise<CreateClinicResult> {
  const [slugTaken] = await query('select 1 from clinics where slug = $1', [input.slug]);
  if (slugTaken) return { ok: false, reason: 'slug_taken' };
  const [emailTaken] = await query('select 1 from users where email = $1', [input.staffEmail]);
  if (emailTaken) return { ok: false, reason: 'email_taken' };

  const clinicId = newId();
  const password = generatePassword();

  try {
    await query(
      `insert into clinics (id, slug, name, specialty, doctor_name, contact_name, contact_phone, phone, whatsapp, plan, price, paid_until)
       values ($1, $2, $3, $4, $5, $6, $7, $7, $7, $8, $9, $10)`,
      [clinicId, input.slug, input.name, input.specialty, input.doctorName, input.contactName, input.contactPhone, input.plan, input.price, addDays(today, TRIAL_DAYS)],
    );
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'slug_taken' };
    throw error;
  }

  // Saturday to Thursday, 5 to 10 in the evening; the clinic adjusts it in its settings.
  for (let weekday = 0; weekday < 7; weekday++) {
    await query('insert into working_hours (clinic_id, weekday, is_open, open_minute, close_minute) values ($1, $2, $3, 1020, 1320)', [
      clinicId,
      weekday,
      weekday !== 5,
    ]);
  }
  await query("insert into services (id, clinic_id, name, price, sort_order) values ($1, $2, 'كشف', 0, 1)", [newId(), clinicId]);
  await query('insert into users (id, clinic_id, email, password_hash, name) values ($1, $2, $3, $4, $5)', [
    newId(),
    clinicId,
    input.staffEmail,
    hashPassword(password),
    input.contactName,
  ]);

  return { ok: true, clinicId, password };
}

export async function setClinicStatus(clinicId: string, status: Clinic['status']): Promise<void> {
  await query('update clinics set status = $2 where id = $1', [clinicId, status]);
  // Suspending signs the clinic's staff out at once.
  if (status === 'suspended') await query('delete from sessions where user_id in (select id from users where clinic_id = $1)', [clinicId]);
}

export interface SubscriptionDetails {
  plan: Clinic['plan'];
  price: number;
  paid_until: string | null;
  contact_name: string;
  contact_phone: string;
  owner_note: string;
}

export async function updateSubscription(clinicId: string, details: SubscriptionDetails): Promise<void> {
  await query('update clinics set plan = $2, price = $3, paid_until = $4, contact_name = $5, contact_phone = $6, owner_note = $7 where id = $1', [
    clinicId,
    details.plan,
    details.price,
    details.paid_until,
    details.contact_name,
    details.contact_phone,
    details.owner_note,
  ]);
}

export interface Payment {
  id: string;
  amount: number;
  paid_on: string;
  covers_until: string;
  note: string;
}

/**
 * Records a payment and extends the subscription by a number of months.
 * The new period starts where the old one ends, or today if it had lapsed,
 * so a clinic that pays early loses nothing and one that pays late gets a full period.
 */
export async function recordPayment(clinic: Clinic, amount: number, months: number, note: string, today: string): Promise<string> {
  const from = clinic.paid_until && clinic.paid_until > today ? clinic.paid_until : today;
  const coversUntil = addMonths(from, months);

  await query('insert into subscription_payments (id, clinic_id, amount, paid_on, covers_until, note) values ($1, $2, $3, $4, $5, $6)', [
    newId(),
    clinic.id,
    amount,
    today,
    coversUntil,
    note,
  ]);
  await query('update clinics set paid_until = $2 where id = $1', [clinic.id, coversUntil]);
  return coversUntil;
}

export function listPayments(clinicId: string): Promise<Payment[]> {
  return query<Payment>('select id, amount, paid_on, covers_until, note from subscription_payments where clinic_id = $1 order by paid_on desc, created_at desc', [
    clinicId,
  ]);
}

export interface StaffAccount {
  id: string;
  email: string;
  name: string;
}

export function listStaff(clinicId: string): Promise<StaffAccount[]> {
  return query<StaffAccount>('select id, email, name from users where clinic_id = $1 order by email', [clinicId]);
}

/** Replaces a staff account's password and signs it out everywhere. Returns the new password to show once. */
export async function resetStaffPassword(clinicId: string, userId: string): Promise<string | null> {
  const password = generatePassword();
  const updated = await query<{ id: string }>('update users set password_hash = $3 where clinic_id = $1 and id = $2 returning id', [
    clinicId,
    userId,
    hashPassword(password),
  ]);
  if (updated.length === 0) return null;

  await query('delete from sessions where user_id = $1', [userId]);
  return password;
}

export interface ClinicUsage {
  bookings_30d: number;
  patients: number;
  online_share: number;
  last_booking_day: string | null;
}

export async function getClinicUsage(clinicId: string, since: string): Promise<ClinicUsage> {
  const [usage] = await query<{ bookings_30d: number; online: number; patients: number; last_booking_day: string | null }>(
    `select
       count(*) filter (where day >= $2 and status <> 'cancelled')::int as bookings_30d,
       count(*) filter (where day >= $2 and status <> 'cancelled' and source = 'online')::int as online,
       count(distinct patient_phone)::int as patients,
       max(day) as last_booking_day
     from appointments where clinic_id = $1`,
    [clinicId, since],
  );
  return {
    bookings_30d: usage.bookings_30d,
    patients: usage.patients,
    online_share: usage.bookings_30d === 0 ? 0 : Math.round((usage.online / usage.bookings_30d) * 100),
    last_booking_day: usage.last_booking_day,
  };
}

/** Money received from subscriptions since a day, across all clinics. */
export async function getIncomeSince(day: string): Promise<number> {
  const [row] = await query<{ total: number }>('select coalesce(sum(amount), 0)::int as total from subscription_payments where paid_on >= $1', [day]);
  return row.total;
}

/** What the active subscriptions are worth per month, with yearly plans spread over twelve months. */
export function monthlyValue(clinics: Pick<Clinic, 'status' | 'plan' | 'price'>[]): number {
  return Math.round(
    clinics
      .filter((clinic) => clinic.status === 'active' && clinic.plan !== 'trial')
      .reduce((sum, clinic) => sum + clinic.price / planMonths[clinic.plan], 0),
  );
}
