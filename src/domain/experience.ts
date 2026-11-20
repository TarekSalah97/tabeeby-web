/**
 * Years of experience from a doctor's positions. Overlapping periods count once:
 * 2021–2023 and 2022–2024 give 3 years, not 4. Months are 'YYYY-MM'; a range is
 * [start, end) so "Jan 2021 → Jan 2023" is 24 months. end = null means present.
 */
export interface PositionRange {
  start: string;
  end: string | null;
}

export const isValidMonth = (m: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

export function monthIndex(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return y * 12 + (m - 1);
}

export function currentMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export type PositionError = 'experience.invalidMonth' | 'experience.startInFuture' | 'experience.endInFuture' | 'experience.endBeforeStart';

export function validatePosition(p: PositionRange, now: Date): PositionError | null {
  if (!isValidMonth(p.start) || (p.end !== null && !isValidMonth(p.end))) return 'experience.invalidMonth';
  const nowIdx = monthIndex(currentMonth(now));
  if (monthIndex(p.start) > nowIdx) return 'experience.startInFuture';
  if (p.end !== null && monthIndex(p.end) > nowIdx) return 'experience.endInFuture';
  if (p.end !== null && monthIndex(p.end) < monthIndex(p.start)) return 'experience.endBeforeStart';
  return null;
}

export function experienceMonths(positions: PositionRange[], now: Date): number {
  const nowIdx = monthIndex(currentMonth(now));
  const ranges = positions
    .filter((p) => validatePosition(p, now) === null)
    .map((p) => [monthIndex(p.start), p.end === null ? nowIdx : monthIndex(p.end)] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  let total = 0;
  let curStart: number | null = null;
  let curEnd = 0;
  for (const [s, e] of ranges) {
    if (curStart === null) {
      curStart = s;
      curEnd = e;
    } else if (s <= curEnd) {
      curEnd = Math.max(curEnd, e);
    } else {
      total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    }
  }
  if (curStart !== null) total += curEnd - curStart;
  return total;
}

/** Whole years, rounded down: what profiles display. */
export function experienceYears(positions: PositionRange[], now: Date): number {
  return Math.floor(experienceMonths(positions, now) / 12);
}
