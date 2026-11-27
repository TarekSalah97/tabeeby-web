import type { Frequency, Timing } from './clinical.js';
import { addDays, isValidDate, isValidTime, normalizeTime, toZoned, weekdayOf, zonedToUtc } from './time.js';

/*
 * Medicine reminders: the doctor's frequency gives suggested clock times; the patient may change
 * them. Pure rules only (no database), so they are easy to test.
 */

export const MAX_TIMES = 8;
export const MAX_DAYS = 365;

/** Suggested times for a frequency, or null when the medicine is not taken on a schedule. */
export function suggestedTimes(frequency: Frequency | null, timing: Timing | null): string[] | null {
  switch (frequency) {
    case 'once_daily':
      return [timing === 'bedtime' ? '22:00' : timing === 'morning' || timing === 'empty_stomach' ? '08:00' : '09:00'];
    case 'twice_daily':
    case 'every_12h':
      return ['09:00', '21:00'];
    case 'three_daily':
      return ['08:00', '14:00', '20:00'];
    case 'four_daily':
      return ['08:00', '13:00', '18:00', '23:00'];
    case 'every_8h':
      return ['06:00', '14:00', '22:00'];
    case 'every_6h':
      return ['06:00', '12:00', '18:00', '00:00'];
    case 'every_4h':
      return ['06:00', '10:00', '14:00', '18:00', '22:00', '02:00'];
    case 'weekly':
      return ['09:00'];
    case 'see_instructions':
      return ['09:00']; // the patient sets times from the doctor's instructions
    case null: // not given by the doctor
    case 'as_needed':
    case 'single_dose':
      return null;
  }
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));

/**
 * Days in a course written as free text ("7 days", "أسبوعين", "2 weeks", "شهر"), or null when it
 * can't be read (the patient then chooses).
 */
export function durationDays(text: string | null): number | null {
  if (!text) return null;
  const s = toLatin(text.trim().toLowerCase());
  const words: [RegExp, number][] = [
    [/^يومين$/, 2], [/^أسبوعين$|^اسبوعين$/, 14], [/^شهرين$/, 60],
    [/^(a |one )?week$|^أسبوع$|^اسبوع$/, 7], [/^(a |one )?month$|^شهر$/, 30], [/^(a |one )?day$|^يوم$/, 1],
  ];
  for (const [re, n] of words) if (re.test(s)) return n;
  const m = /^(\d{1,3})\s*(days?|d|يوم|أيام|ايام|weeks?|w|أسبوع|اسبوع|أسابيع|اسابيع|months?|شهر|شهور|أشهر|اشهر)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? 'days';
  const mult = /^(weeks?|w|أسبوع|اسبوع|أسابيع|اسابيع)$/.test(unit) ? 7 : /^(months?|شهر|شهور|أشهر|اشهر)$/.test(unit) ? 30 : 1;
  const days = n * mult;
  return days >= 1 && days <= MAX_DAYS ? days : null;
}

/** "Long term", "مستمر", "مدى الحياة"… : a medicine taken until the doctor says stop. */
export function isOngoing(text: string | null): boolean {
  if (!text) return false;
  return /long[\s-]?term|ongoing|continu|chronic|lifelong|for life|regular|indefinite|مستمر|باستمرار|مدى الحياة|دائم|على طول|مزمن/i.test(text.trim());
}

/** Cleans a list of "HH:MM" times: valid, unique, sorted; null if none are valid or too many. */
export function cleanTimes(raw: readonly string[]): string[] | null {
  const times = [...new Set(raw.map((t) => normalizeTime(t)).filter((t) => isValidTime(t)))].sort();
  return times.length >= 1 && times.length <= MAX_TIMES ? times : null;
}

export interface ReminderSchedule {
  times: readonly string[];
  /** 0 = Sunday … 6 = Saturday, for once-a-week medicines; null = every day. */
  weekday: number | null;
  startDate: string;
  /** Last day (inclusive), or null for "until I stop". */
  endDate: string | null;
}

/** Is this local date one of the reminder's days? */
export function isDoseDay(s: ReminderSchedule, date: string): boolean {
  if (date < s.startDate) return false;
  if (s.endDate && date > s.endDate) return false;
  return s.weekday === null || weekdayOf(date) === s.weekday;
}

/** Dose instants in (from, to], in the given time zone. Windows are short (minutes to a day). */
export function dueBetween(s: ReminderSchedule, from: Date, to: Date, tz: string): Date[] {
  const out: Date[] = [];
  const first = addDays(toZoned(from, tz).date, -1);
  const last = toZoned(to, tz).date;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    if (!isDoseDay(s, d)) continue;
    for (const t of s.times) {
      const at = zonedToUtc(d, t, tz);
      if (at > from && at <= to) out.push(at);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** Doses on one local day. */
export function dosesOn(s: ReminderSchedule, date: string, tz: string): Date[] {
  if (!isValidDate(date) || !isDoseDay(s, date)) return [];
  return [...s.times].sort().map((t) => zonedToUtc(date, t, tz));
}
