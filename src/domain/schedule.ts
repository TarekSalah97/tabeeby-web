import type { AppointmentStatus } from './appointmentStatus.js';
import { normalizeDigits } from './phone.js';

/** Visits that are over for the day: finished, cancelled or missed. */
export const FINISHED: ReadonlySet<AppointmentStatus> = new Set(['completed', 'no_show', 'cancelled']);

/** How long a just-finished visit stays at the top, so the clinic can book a follow-up. */
export const JUST_FINISHED_MS = 3 * 60_000;

/** Finished in the last few minutes (and not missed or cancelled)? */
export function isJustFinished(a: { status: AppointmentStatus; completed_at?: Date | null }, now: Date): boolean {
  if (a.status !== 'completed' || !a.completed_at) return false;
  const age = now.getTime() - a.completed_at.getTime();
  return age >= 0 && age < JUST_FINISHED_MS;
}

const RANK: Record<AppointmentStatus, number> = {
  in_consultation: 0, // with the doctor now
  arrived: 1, // waiting in the clinic
  confirmed: 1, // still expected; arrived and confirmed keep their booked time order
  completed: 2,
  no_show: 3,
  cancelled: 4,
};

/**
 * The day's list in working order: a visit finished in the last 3 minutes first (time to book a
 * follow-up), then whoever is with the doctor, then everyone still to be seen in booked-time order,
 * and finished, missed and cancelled visits at the end. Stable for equal keys.
 */
export function orderSchedule<T extends { status: AppointmentStatus; starts_at: Date; completed_at?: Date | null }>(list: readonly T[], now?: Date): T[] {
  const rank = (a: T) => (now && isJustFinished(a, now) ? -1 : RANK[a.status]);
  return list
    .map((a, i) => ({ a, i, r: rank(a) }))
    .sort((x, y) => x.r - y.r || x.a.starts_at.getTime() - y.a.starts_at.getTime() || x.i - y.i)
    .map(({ a }) => a);
}

/** Folds Arabic spelling variants and case so "احمد" finds "أحمد" and "منه" finds "منة". */
export function foldName(s: string): string {
  return normalizeDigits(s)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '') // tashkeel and tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does this visit match the schedule search (name, or part of the mobile number)? */
export function matchesSchedule(q: string, name: string, phoneE164: string): boolean {
  const query = foldName(q);
  if (!query) return true;
  if (foldName(name).includes(query)) return true;
  const digits = query.replace(/\D/g, '');
  if (digits.length >= 3 && digits.length === query.replace(/\s/g, '').length) {
    const local = '0' + phoneE164.replace(/^\+20/, '');
    return local.includes(digits.replace(/^0020|^\+?20/, '0').replace(/^00/, '0')) || phoneE164.includes(digits);
  }
  return false;
}
