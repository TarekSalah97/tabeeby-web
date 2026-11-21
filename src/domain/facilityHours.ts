import { addDays, timeToMinutes, toZoned, weekdayOf } from './time.js';

export interface OpeningHours {
  open24h: boolean;
  days: number[]; // 0 = Sunday
  opens: string; // 'HH:MM' local
  closes: string; // earlier than or equal to opens = closes after midnight
}

/**
 * Open right now? Handles "24 hours" and late-night places that close after midnight:
 * a pharmacy open Thursday 18:00–02:00 is open at 01:00 on Friday morning.
 */
export function isOpenAt(h: OpeningHours, now: Date, tz: string): boolean {
  const z = toZoned(now, tz);
  if (h.open24h) return h.days.includes(z.weekday);
  const t = timeToMinutes(z.time);
  const opens = timeToMinutes(h.opens);
  const closes = timeToMinutes(h.closes);
  if (closes > opens) return h.days.includes(z.weekday) && t >= opens && t < closes;
  // Crosses midnight: the evening part belongs to today, the early-morning part to yesterday.
  const yesterday = weekdayOf(addDays(z.date, -1));
  return (h.days.includes(z.weekday) && t >= opens) || (h.days.includes(yesterday) && t < closes);
}
