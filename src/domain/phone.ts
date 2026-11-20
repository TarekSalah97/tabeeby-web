/**
 * Egyptian mobile numbers: 11 digits locally (01X XXXX XXXX), where X is
 * 0 (Vodafone), 1 (Etisalat/e&), 2 (Orange) or 5 (WE). Stored as E.164.
 */
const MOBILE = /^1[0125]\d{8}$/;

/** Arabic-Indic and Eastern Arabic-Indic digits → ASCII, so "٠١٠..." works. */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function normalizeEgyptMobile(input: string): string | null {
  let digits = normalizeDigits(input).replace(/[\s\-().]/g, '');
  if (digits.startsWith('+20')) digits = digits.slice(3);
  else if (digits.startsWith('0020')) digits = digits.slice(4);
  else if (digits.startsWith('20') && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (!MOBILE.test(digits)) return null;
  return '+20' + digits;
}

/** "+201012345678" → "010 1234 5678" for display. */
export function formatEgyptMobile(e164: string): string {
  const local = '0' + e164.replace(/^\+20/, '');
  return `${local.slice(0, 3)} ${local.slice(3, 7)} ${local.slice(7)}`;
}

/** Masked for places where the full number is not needed: "010 •••• 5678". */
export function maskEgyptMobile(e164: string): string {
  const f = formatEgyptMobile(e164);
  return f.slice(0, 4) + '•••• ' + f.slice(-4);
}
