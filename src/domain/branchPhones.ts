import { normalizeDigits } from './phone.js';

/** Most numbers one branch can list. */
export const MAX_BRANCH_PHONES = 5;

/**
 * Several phone numbers typed in one box, separated by dashes (as people write them), commas,
 * slashes or new lines: "01012345678 - 034567890". Mobiles and landlines; Arabic digits work.
 * Returns the numbers in order without repeats, or 'invalid' if any part isn't a phone number.
 */
export function parseBranchPhones(raw: string): string[] | 'invalid' {
  const parts = normalizeDigits(raw)
    .split(/[-–—,،/;|\n]+/)
    .map((p) => p.replace(/[\s()]/g, ''))
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const digits = part.replace(/^(\+20|0020|0)/, '');
    if (!/^\d{8,10}$/.test(digits)) return 'invalid';
    const e164 = `+20${digits}`;
    if (!out.includes(e164)) out.push(e164);
  }
  return out.length > MAX_BRANCH_PHONES ? 'invalid' : out;
}

/** 010 1234 5678 for mobiles, 03 4567890 for landlines. */
export function formatEgyptPhone(e164: string): string {
  const local = '0' + e164.replace(/^\+20/, '');
  if (/^01\d{9}$/.test(local)) return `${local.slice(0, 3)} ${local.slice(3, 7)} ${local.slice(7)}`;
  const area = /^0(2|3)/.test(local) ? 2 : 3; // Cairo 02, Alexandria 03; others 3-digit codes
  return `${local.slice(0, area)} ${local.slice(area)}`;
}

/** "9:00 AM" / "٩:٠٠ ص" from "09:00". */
export function format12h(hhmm: string, locale: 'ar' | 'en'): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' })
    .format(new Date(Date.UTC(2000, 0, 1, h ?? 0, m ?? 0)));
}
