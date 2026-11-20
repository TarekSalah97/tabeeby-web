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

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

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
        const candidate = { start: startsAt, end: endsAt };
        if (busy.some((b) => overlaps(b, candidate))) continue;
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
