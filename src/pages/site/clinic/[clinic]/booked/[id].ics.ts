/**
 * The appointment as a calendar file, so the patient's phone can remind them.
 * Times are written as local clock time with the clinic's timezone, which is
 * how the appointment is stored.
 */
import type { APIRoute } from 'astro';
import { getAppointment } from '../../../../../lib/appointments';
import { getClinicBySlug } from '../../../../../lib/clinics';

/** 20261128 and 1050 -> "20261128T173000" */
function stamp(day: string, minute: number): string {
  const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}${String(minute % 60).padStart(2, '0')}00`;
  return `${day.replaceAll('-', '')}T${time}`;
}

/** Commas, semicolons, backslashes and line breaks have a meaning in the format. */
function escape(value: string): string {
  return value.replace(/[\\;,]/g, (char) => `\\${char}`).replace(/\r?\n/g, '\\n');
}

export const GET: APIRoute = async ({ params }) => {
  const clinic = await getClinicBySlug(params.clinic ?? '');
  const appointment = clinic && (await getAppointment(clinic.id, params.id ?? ''));
  if (!clinic || !appointment || appointment.status === 'cancelled') return new Response(null, { status: 404 });

  const end = appointment.start_minute + clinic.slot_minutes;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BuildTech//Clinic Booking//AR',
    'BEGIN:VEVENT',
    `UID:${appointment.id}@clinic-booking`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')}`,
    `DTSTART;TZID=${clinic.timezone}:${stamp(appointment.day, appointment.start_minute)}`,
    `DTEND;TZID=${clinic.timezone}:${stamp(appointment.day, end)}`,
    `SUMMARY:${escape(`${appointment.service_name} · ${clinic.name}`)}`,
    `LOCATION:${escape(clinic.address)}`,
    // Reminds the patient an hour before.
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escape(clinic.name)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return new Response(lines.join('\r\n'), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="appointment.ics"' },
  });
};
