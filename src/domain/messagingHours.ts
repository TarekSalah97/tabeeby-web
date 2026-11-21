import { toZoned, timeToMinutes } from './time.js';

export interface MessagingHours {
  days: number[]; // 0 = Sunday
  start: string; // 'HH:MM' clinic-local
  end: string;
}

/** Whether patients may send a message right now (clinic-local time). */
export function isOpenNow(h: MessagingHours, now: Date, tz: string): boolean {
  const z = toZoned(now, tz);
  if (!h.days.includes(z.weekday)) return false;
  const m = timeToMinutes(z.time);
  return m >= timeToMinutes(h.start) && m < timeToMinutes(h.end);
}
