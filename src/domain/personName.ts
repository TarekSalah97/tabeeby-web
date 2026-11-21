/**
 * Whether two names written for the same mobile number are the same person.
 * Case, extra spaces and Arabic letter variants (أ/إ/آ/ا, ة/ه, ى/ي) are ignored, and a shorter
 * name matches a longer one that starts with it ("Tarek" = "Tarek Tarahony"), because clinics
 * often write only the first name or two. Different first names never match (a family sharing a phone).
 */
export function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[ً-ٰٟـ]/g, '') // Arabic diacritics and tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function sameName(a: string, b: string): boolean {
  const x = normaliseName(a).split(' ').filter(Boolean);
  const y = normaliseName(b).split(' ').filter(Boolean);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((w, i) => long[i] === w);
}
