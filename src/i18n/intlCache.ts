/**
 * Reused Intl formatters. Creating an Intl formatter is expensive and each one holds native (ICU)
 * memory that is only released when the garbage collector happens to run; making new ones for every
 * date on a page grew the server's memory by about 1 MB per page view under load. The set of
 * locale/option combinations is small and fixed, so this cache stays tiny.
 */
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();

export function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = dateFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    dateFormatters.set(key, f);
  }
  return f;
}

export function numberFormatter(locale: string, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = numberFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    numberFormatters.set(key, f);
  }
  return f;
}

const collators = new Map<string, Intl.Collator>();

/** A reused sorter for a language (a.localeCompare(b, lang) may build one per comparison). */
export function collator(locale: string): Intl.Collator {
  let c = collators.get(locale);
  if (!c) {
    c = new Intl.Collator(locale);
    collators.set(locale, c);
  }
  return c;
}
