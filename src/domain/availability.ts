import { addDays, timeToMinutes, minutesToTime, weekdayOf, zonedToUtc } from './time.js';

export interface ScheduleRule {
  clinicId: string;
  weekday: number; // 0 = Sunday
  startTime: string; // 'HH:MM' clinic-local
  endTime: string;
  slotMinutes: number;
}

export interface Interval {
  start: Date;
  end: Date;
}

export interface Slot {
  clinicId: string;
  date: string; // local
  time: string; // local
  startsAt: Date;
  endsAt: Date;
}

export interface SlotQuery {
  rules: ScheduleRule[];
  /** Live appointments and blocked time: anything that makes the doctor unavailable. */
  busy: Interval[];
  fromDate: string;
  days: number;
  tz: string;
  now: Date;
  minLeadMinutes: number;
}

/**
 * Does [start, end) overlap any busy interval? `busy` is sorted by start, so the scan stops at the
 * first interval starting at or after `end` (later ones can't overlap).
 */
function overlapsAny(busy: readonly Interval[], start: number, end: number): boolean {
  for (const b of busy) {
    if (b.start.getTime() >= end) return false;
    if (b.end.getTime() > start) return true;
  }
  return false;
}

/**
 * Bookable slots generated from weekly rules, minus anything busy or too soon.
 * Pure function: the same inputs always give the same slots, so the booking
 * service re-runs it server-side to validate a requested time.
 */
export function computeSlots(q: SlotQuery): Slot[] {
  const earliest = q.now.getTime() + q.minLeadMinutes * 60000;
  const busy = [...q.busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  const slots: Slot[] = [];

  for (let i = 0; i < q.days; i++) {
    const date = addDays(q.fromDate, i);
    const weekday = weekdayOf(date);
    for (const rule of q.rules) {
      if (rule.weekday !== weekday) continue;
      const end = timeToMinutes(rule.endTime);
      for (let m = timeToMinutes(rule.startTime); m + rule.slotMinutes <= end; m += rule.slotMinutes) {
        const time = minutesToTime(m);
        const startsAt = zonedToUtc(date, time, q.tz);
        if (startsAt.getTime() < earliest) continue;
        const endsAt = new Date(startsAt.getTime() + rule.slotMinutes * 60000);
        if (overlapsAny(busy, startsAt.getTime(), endsAt.getTime())) continue;
        slots.push({ clinicId: rule.clinicId, date, time, startsAt, endsAt });
      }
    }
  }
  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** True when two rules on the same weekday overlap (a doctor cannot be in two clinics at once). */
export function rulesOverlap(a: Pick<ScheduleRule, 'weekday' | 'startTime' | 'endTime'>, b: Pick<ScheduleRule, 'weekday' | 'startTime' | 'endTime'>): boolean {
  return a.weekday === b.weekday && timeToMinutes(a.startTime) < timeToMinutes(b.endTime) && timeToMinutes(b.startTime) < timeToMinutes(a.endTime);
}
