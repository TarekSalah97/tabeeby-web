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

/**
 * Doctors enter years only ("2015" to "2019"). Stored as months with an exclusive end:
 * start 2015 → 2015-01, end 2019 → 2020-01 (so 2015–2019 counts as 5 years), and an end in
 * the current year → the current month. 'YYYY-MM' is still accepted as is. Anything else is
 * returned unchanged so validation reports it.
 */
export function yearToMonth(raw: string, which: 'start' | 'end', now: Date): string {
  const v = raw.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (!/^\d{4}$/.test(v)) return v;
  const year = Number(v);
  if (which === 'start') return `${year}-01`;
  const current = currentMonth(now);
  return year >= Number(current.slice(0, 4)) ? (year === Number(current.slice(0, 4)) ? current : `${year + 1}-01`) : `${year + 1}-01`;
}

/** The years to show for a stored range: "2015 – 2019" (end is exclusive, so January belongs to the year before). */
export function displayYears(p: PositionRange, now: Date): { from: string; to: string | null } {
  const to = p.end === null ? null : p.end === currentMonth(now) ? p.end.slice(0, 4) : String(Math.floor((monthIndex(p.end) - 1) / 12));
  return { from: p.start.slice(0, 4), to: to !== null && Number(to) < Number(p.start.slice(0, 4)) ? p.start.slice(0, 4) : to };
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
