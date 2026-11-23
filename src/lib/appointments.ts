/** Booking rules: free slots, taking one, the waiting queue, payments, and the staff's views. */
import { getClosedDays, getServices, getWorkingWeek, isClosedDay, type Clinic } from './clinics';
import { isUniqueViolation, newId, query } from './db';
import { addDays, daysBetween, isDay, nowIn, weekdayOf } from './time';

export const appointmentStatuses = ['booked', 'arrived', 'done', 'no_show', 'cancelled'] as const;
export type AppointmentStatus = (typeof appointmentStatuses)[number];

export const statusLabels: Record<AppointmentStatus, string> = {
  booked: 'محجوز',
  arrived: 'في الانتظار',
  done: 'تم الكشف',
  no_show: 'ما جاش',
  cancelled: 'ملغي',
};

export interface Appointment {
  id: string;
  service_name: string;
  price: number;
  paid: number;
  day: string;
  start_minute: number;
  patient_name: string;
  patient_phone: string;
  note: string;
  status: AppointmentStatus;
  source: 'online' | 'staff';
  /** Set when the patient was marked as arrived; orders the waiting queue. */
  arrived_at: string | Date | null;
}

/** Patients cannot book a slot that starts sooner than this, so the clinic is never surprised. */
const NOTICE_MINUTES = 30;

/** The days a patient may choose from: today onward, open days only. */
export async function getBookableDays(clinic: Clinic): Promise<string[]> {
  const { day: today } = nowIn(clinic.timezone);
  const [week, closed] = await Promise.all([getWorkingWeek(clinic.id), getClosedDays(clinic.id, today)]);
  const closedDays = new Set(closed.map((entry) => entry.day));

  return Array.from({ length: clinic.booking_days }, (_, offset) => addDays(today, offset)).filter(
    (day) => week[weekdayOf(day)].is_open && !closedDays.has(day),
  );
}

/**
 * Every slot of a day with whether it is still free.
 * `forStaff` drops the notice period: the desk may fit someone in right now.
 */
export async function getSlots(clinic: Clinic, day: string, options: { forStaff?: boolean } = {}): Promise<{ minute: number; free: boolean }[]> {
  const hours = (await getWorkingWeek(clinic.id))[weekdayOf(day)];
  if (!hours.is_open || (await isClosedDay(clinic.id, day))) return [];

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

const APPOINTMENT_COLUMNS = 'id, service_name, price, paid, day, start_minute, patient_name, patient_phone, note, status, source, arrived_at';

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
 * Changes an appointment's status and keeps the queue and payment in step:
 * arriving joins the queue, finishing the visit records the price as paid,
 * and anything that undoes the visit clears both.
 * Un-cancelling can fail: someone else may have taken the slot meanwhile.
 */
export async function setAppointmentStatus(clinicId: string, id: string, status: AppointmentStatus): Promise<StatusChange> {
  try {
    await query(
      `update appointments set
         status = $3::text,
         arrived_at = case
           when $3::text = 'arrived' then coalesce(arrived_at, now())
           when $3::text = 'done' then arrived_at
           else null
         end,
         paid = case
           when $3::text = 'done' and paid = 0 then price
           when $3::text = 'done' then paid
           else 0
         end
       where clinic_id = $1 and id = $2`,
      [clinicId, id, status],
    );
  } catch (error) {
    if (isUniqueViolation(error)) return 'slot_taken';
    throw error;
  }
  return 'done';
}

/** Records what the patient actually paid for a finished visit. */
export async function setPaidAmount(clinicId: string, id: string, amount: number): Promise<void> {
  await query("update appointments set paid = $3 where clinic_id = $1 and id = $2 and status = 'done'", [clinicId, id, amount]);
}

/** Patients waiting right now on a day, first to arrive first. */
export function getQueue(clinicId: string, day: string): Promise<Appointment[]> {
  return query<Appointment>(
    `select ${APPOINTMENT_COLUMNS} from appointments
     where clinic_id = $1 and day = $2 and status = 'arrived'
     order by arrived_at, start_minute`,
    [clinicId, day],
  );
}

/**
 * What a patient sees about the queue on the day of their visit: how many
 * people are waiting, and how many of them are ahead once they have arrived.
 */
export async function getQueuePosition(clinicId: string, appointment: Appointment): Promise<{ waiting: number; ahead: number | null }> {
  const queue = await getQueue(clinicId, appointment.day);
  const place = queue.findIndex((entry) => entry.id === appointment.id);
  return { waiting: queue.length, ahead: place === -1 ? null : place };
}

/** Whether the patient may still cancel online: only a booked visit, and not at the last minute. */
export function canPatientCancel(clinic: Clinic, appointment: Appointment): boolean {
  if (appointment.status !== 'booked') return false;
  const now = nowIn(clinic.timezone);
  const minutesAway = daysBetween(now.day, appointment.day) * 1440 + appointment.start_minute - now.minute;
  return minutesAway >= clinic.cancel_hours * 60;
}

/** How many live bookings each day has, for the week strip. Days with none are absent. */
export async function getDayCounts(clinicId: string, fromDay: string, toDay: string): Promise<Map<string, number>> {
  const rows = await query<{ day: string; total: number }>(
    `select day, count(*)::int as total from appointments
     where clinic_id = $1 and day between $2 and $3 and status <> 'cancelled'
     group by day`,
    [clinicId, fromDay, toDay],
  );
  return new Map(rows.map((row) => [row.day, row.total]));
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

/** Every appointment a patient has had at the clinic, newest first. */
export function getPatientHistory(clinicId: string, phone: string): Promise<Appointment[]> {
  return query<Appointment>(
    `select ${APPOINTMENT_COLUMNS} from appointments where clinic_id = $1 and patient_phone = $2 order by day desc, start_minute desc`,
    [clinicId, phone],
  );
}

export async function getPatientNote(clinicId: string, phone: string): Promise<string> {
  const [row] = await query<{ note: string }>('select note from patient_notes where clinic_id = $1 and patient_phone = $2', [clinicId, phone]);
  return row?.note ?? '';
}

export async function savePatientNote(clinicId: string, phone: string, note: string): Promise<void> {
  await query(
    `insert into patient_notes (clinic_id, patient_phone, note) values ($1, $2, $3)
     on conflict (clinic_id, patient_phone) do update set note = excluded.note`,
    [clinicId, phone, note],
  );
}

export interface Report {
  totals: { bookings: number; done: number; no_shows: number; cancelled: number; revenue: number; online: number; patients: number };
  perDay: { day: string; bookings: number; revenue: number }[];
  services: { service_name: string; visits: number; revenue: number }[];
}

/** Figures for a range of days. Bookings count everything except cancellations. */
export async function getReport(clinicId: string, fromDay: string, toDay: string): Promise<Report> {
  const range = [clinicId, fromDay, toDay];
  const inRange = 'clinic_id = $1 and day between $2 and $3';

  const [[totals], perDay, services] = await Promise.all([
    query<Report['totals']>(
      `select
         count(*) filter (where status <> 'cancelled')::int as bookings,
         count(*) filter (where status = 'done')::int as done,
         count(*) filter (where status = 'no_show')::int as no_shows,
         count(*) filter (where status = 'cancelled')::int as cancelled,
         coalesce(sum(paid), 0)::int as revenue,
         count(*) filter (where status <> 'cancelled' and source = 'online')::int as online,
         count(distinct patient_phone) filter (where status <> 'cancelled')::int as patients
       from appointments where ${inRange}`,
      range,
    ),
    query<Report['perDay'][number]>(
      `select day, count(*) filter (where status <> 'cancelled')::int as bookings, coalesce(sum(paid), 0)::int as revenue
       from appointments where ${inRange} group by day order by day`,
      range,
    ),
    query<Report['services'][number]>(
      `select service_name, count(*)::int as visits, coalesce(sum(paid), 0)::int as revenue
       from appointments where ${inRange} and status <> 'cancelled'
       group by service_name order by visits desc`,
      range,
    ),
  ]);

  return { totals, perDay, services };
}
