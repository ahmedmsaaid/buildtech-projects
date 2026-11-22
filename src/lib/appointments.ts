/** Booking rules: which slots are free, taking one, and the staff's view of a day. */
import { getServices, getWorkingWeek, type Clinic } from './clinics';
import { isUniqueViolation, newId, query } from './db';
import { addDays, isDay, nowIn, weekdayOf } from './time';

export const appointmentStatuses = ['booked', 'arrived', 'done', 'no_show', 'cancelled'] as const;
export type AppointmentStatus = (typeof appointmentStatuses)[number];

export const statusLabels: Record<AppointmentStatus, string> = {
  booked: 'محجوز',
  arrived: 'وصل',
  done: 'تم الكشف',
  no_show: 'ما جاش',
  cancelled: 'ملغي',
};

export interface Appointment {
  id: string;
  service_name: string;
  price: number;
  day: string;
  start_minute: number;
  patient_name: string;
  patient_phone: string;
  note: string;
  status: AppointmentStatus;
  source: 'online' | 'staff';
}

/** Patients cannot book a slot that starts sooner than this, so the clinic is never surprised. */
const NOTICE_MINUTES = 30;

/** The days a patient may choose from: today onward, open days only. */
export async function getBookableDays(clinic: Clinic): Promise<string[]> {
  const week = await getWorkingWeek(clinic.id);
  const { day: today } = nowIn(clinic.timezone);
  return Array.from({ length: clinic.booking_days }, (_, offset) => addDays(today, offset)).filter((day) => week[weekdayOf(day)].is_open);
}

/**
 * Every slot of a day with whether it is still free.
 * `forStaff` drops the notice period: the desk may fit someone in right now.
 */
export async function getSlots(clinic: Clinic, day: string, options: { forStaff?: boolean } = {}): Promise<{ minute: number; free: boolean }[]> {
  const hours = (await getWorkingWeek(clinic.id))[weekdayOf(day)];
  if (!hours.is_open) return [];

  const taken = await query<{ start_minute: number }>(
    "select start_minute from appointments where clinic_id = $1 and day = $2 and status <> 'cancelled'",
    [clinic.id, day],
  );
  // A slot is taken when a booking overlaps it, not only when one starts at
  // the same minute: bookings made before the clinic changed its appointment
  // length no longer line up with the current slots.
  const length = clinic.slot_minutes;
  const isTaken = (minute: number) => taken.some((row) => row.start_minute < minute + length && row.start_minute + length > minute);

  const now = nowIn(clinic.timezone);
  const earliest = day === now.day ? now.minute + (options.forStaff ? 0 : NOTICE_MINUTES) : 0;

  const slots = [];
  for (let minute = hours.open_minute; minute + length <= hours.close_minute; minute += length) {
    slots.push({ minute, free: !isTaken(minute) && (day > now.day || (day === now.day && minute >= earliest)) });
  }
  return slots;
}

export interface BookingRequest {
  day: string;
  minute: number;
  serviceId: string;
  patientName: string;
  patientPhone: string;
  note?: string;
  source: 'online' | 'staff';
}

export type BookingResult = { ok: true; id: string } | { ok: false; reason: 'slot_taken' | 'slot_unavailable' | 'unknown_service' };

/**
 * Takes a slot. The slot is checked against the clinic's hours here, and the
 * database's unique index settles the race when two people pick the same one.
 */
export async function bookAppointment(clinic: Clinic, request: BookingRequest): Promise<BookingResult> {
  if (!isDay(request.day)) return { ok: false, reason: 'slot_unavailable' };

  const service = (await getServices(clinic.id)).find((candidate) => candidate.id === request.serviceId);
  if (!service) return { ok: false, reason: 'unknown_service' };

  const forStaff = request.source === 'staff';
  if (!forStaff && !(await getBookableDays(clinic)).includes(request.day)) return { ok: false, reason: 'slot_unavailable' };

  const slot = (await getSlots(clinic, request.day, { forStaff })).find((candidate) => candidate.minute === request.minute);
  if (!slot) return { ok: false, reason: 'slot_unavailable' };
  if (!slot.free) return { ok: false, reason: 'slot_taken' };

  const id = newId();
  try {
    await query(
      `insert into appointments (id, clinic_id, service_id, service_name, price, day, start_minute, patient_name, patient_phone, note, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, clinic.id, service.id, service.name, service.price, request.day, request.minute, request.patientName, request.patientPhone, request.note ?? '', request.source],
    );
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'slot_taken' };
    throw error;
  }
  return { ok: true, id };
}

const APPOINTMENT_COLUMNS = 'id, service_name, price, day, start_minute, patient_name, patient_phone, note, status, source';

export function getAppointmentsOn(clinicId: string, day: string): Promise<Appointment[]> {
  return query<Appointment>(`select ${APPOINTMENT_COLUMNS} from appointments where clinic_id = $1 and day = $2 order by start_minute, created_at`, [
    clinicId,
    day,
  ]);
}

export async function getAppointment(clinicId: string, id: string): Promise<Appointment | null> {
  const [appointment] = await query<Appointment>(`select ${APPOINTMENT_COLUMNS} from appointments where clinic_id = $1 and id = $2`, [clinicId, id]);
  return appointment ?? null;
}

export type StatusChange = 'done' | 'slot_taken';

/**
 * Changes an appointment's status. Un-cancelling can fail: someone else may
 * have taken the slot in the meantime.
 */
export async function setAppointmentStatus(clinicId: string, id: string, status: AppointmentStatus): Promise<StatusChange> {
  try {
    await query('update appointments set status = $3 where clinic_id = $1 and id = $2', [clinicId, id, status]);
  } catch (error) {
    if (isUniqueViolation(error)) return 'slot_taken';
    throw error;
  }
  return 'done';
}

export interface Patient {
  patient_name: string;
  patient_phone: string;
  visits: number;
  no_shows: number;
  last_day: string;
}

/** Everyone who has booked, one row per phone number, most recent first. */
export function getPatients(clinicId: string, search: string): Promise<Patient[]> {
  return query<Patient>(
    `select
       (array_agg(patient_name order by day desc, start_minute desc))[1] as patient_name,
       patient_phone,
       count(*) filter (where status <> 'cancelled')::int as visits,
       count(*) filter (where status = 'no_show')::int as no_shows,
       max(day) as last_day
     from appointments
     where clinic_id = $1 and ($2 = '' or patient_name ilike '%' || $2 || '%' or patient_phone like '%' || $2 || '%')
     group by patient_phone
     order by last_day desc
     limit 200`,
    [clinicId, search],
  );
}
