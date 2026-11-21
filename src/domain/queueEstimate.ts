import type { AppointmentStatus } from './appointmentStatus.js';

/*
 * "How long until I'm seen?" — a Talabat-style estimate for a patient's visit today.
 *
 * Inputs are the doctor's visits at that clinic on that day (no names, only times and
 * statuses). The estimate uses how fast the doctor is actually going today when there
 * is enough evidence, and the booked slot length otherwise. It never promises a time
 * earlier than the booked slot: patients are told to be there for their slot.
 */

export interface QueueVisit {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  consultStartedAt: Date | null;
  completedAt: Date | null;
}

export type QueueStage = 'booked' | 'arrived' | 'next' | 'with_doctor' | 'done' | 'closed';

export interface QueueEstimate {
  stage: QueueStage;
  /** Patients who will be seen before this one (including the one inside now). */
  ahead: number;
  /** Minutes until this patient should go in, as a range for display ("25–35 min"). Null when not waiting. */
  waitMin: number | null;
  waitMax: number | null;
  /** Expected time the patient goes in. */
  expectedAt: Date | null;
  /** How far behind the booked slot the clinic is running, in minutes (0 when on time). */
  delayMinutes: number;
  /** Average visit length used for the estimate, and whether it came from today's real visits. */
  visitMinutes: number;
  paceFromToday: boolean;
}

const MINUTE = 60_000;
/** Real visits are trusted for the pace only once this many are finished today. */
export const PACE_MIN_SAMPLES = 2;
const MIN_VISIT = 5;
const MAX_VISIT = 90;
/** Someone who has been inside longer than the average is assumed to need at least this much more. */
const MIN_REMAINING = 3;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const roundUpTo5 = (n: number) => Math.max(0, Math.ceil(n / 5) * 5);

export function estimateQueue(visits: QueueVisit[], mineId: string, now: Date): QueueEstimate | null {
  const mine = visits.find((v) => v.id === mineId);
  if (!mine) return null;
  const slotMinutes = clamp((mine.endsAt.getTime() - mine.startsAt.getTime()) / MINUTE, MIN_VISIT, MAX_VISIT);

  // Pace: average length of today's finished consultations, once there are enough of them.
  const durations = visits
    .filter((v) => v.status === 'completed' && v.consultStartedAt && v.completedAt)
    .map((v) => (v.completedAt!.getTime() - v.consultStartedAt!.getTime()) / MINUTE)
    .filter((m) => m > 0);
  const paceFromToday = durations.length >= PACE_MIN_SAMPLES;
  const visitMinutes = Math.round(paceFromToday ? clamp(durations.reduce((a, b) => a + b, 0) / durations.length, MIN_VISIT, MAX_VISIT) : slotMinutes);

  const base = { visitMinutes, paceFromToday };
  if (mine.status === 'completed') return { ...base, stage: 'done', ahead: 0, waitMin: null, waitMax: null, expectedAt: null, delayMinutes: 0 };
  if (mine.status === 'cancelled' || mine.status === 'no_show') return { ...base, stage: 'closed', ahead: 0, waitMin: null, waitMax: null, expectedAt: null, delayMinutes: 0 };
  if (mine.status === 'in_consultation') return { ...base, stage: 'with_doctor', ahead: 0, waitMin: 0, waitMax: 0, expectedAt: now, delayMinutes: 0 };

  // Everyone still to be seen before me, in booked order (the order clinics in Egypt work by).
  const before = visits
    .filter((v) => v.id !== mine.id && v.startsAt.getTime() < mine.startsAt.getTime())
    .filter((v) => v.status === 'confirmed' || v.status === 'arrived' || v.status === 'in_consultation');
  const inside = visits.find((v) => v.status === 'in_consultation' && v.id !== mine.id) ?? null;
  const waitingBefore = before.filter((v) => v.status !== 'in_consultation');

  // Time left for whoever is inside now.
  let remainingInside = 0;
  if (inside) {
    const elapsed = inside.consultStartedAt ? (now.getTime() - inside.consultStartedAt.getTime()) / MINUTE : 0;
    remainingInside = Math.max(visitMinutes - elapsed, MIN_REMAINING);
  }

  // The doctor cannot start before the first booked slot of the day still to be seen.
  const firstStart = Math.min(...[...before, mine].map((v) => v.startsAt.getTime()));
  const doctorFreeAt = Math.max(now.getTime(), inside ? now.getTime() : firstStart) + remainingInside * MINUTE;
  const byQueue = doctorFreeAt + waitingBefore.length * visitMinutes * MINUTE;
  const expected = Math.max(byQueue, mine.startsAt.getTime(), now.getTime());

  const wait = (expected - now.getTime()) / MINUTE;
  // Uncertainty grows with the number of people ahead (about a fifth of the wait, at least 5 min).
  const spread = Math.max(5, Math.round(wait * 0.2));
  const waitMin = roundUpTo5(wait);
  const delayMinutes = Math.max(0, Math.round((expected - mine.startsAt.getTime()) / MINUTE));

  const ahead = before.length;
  const stage: QueueStage = ahead === 0 ? 'next' : mine.status === 'arrived' ? 'arrived' : 'booked';
  return { ...base, stage, ahead, waitMin, waitMax: waitMin + roundUpTo5(spread), expectedAt: new Date(expected), delayMinutes };
}
