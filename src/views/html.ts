/**
 * Auto-escaping HTML templates. Every interpolated value is escaped unless it
 * is already SafeHtml produced by this module. This is the app's XSS defence:
 * never build HTML with string concatenation outside `html```.
 */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (c) => ESCAPES[c]!);
}

export type HtmlValue = SafeHtml | string | number | boolean | null | undefined | HtmlValue[];

function render(value: HtmlValue): string {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: HtmlValue[]): SafeHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) out += render(values[i]!) + (strings[i + 1] ?? '');
  return new SafeHtml(out);
}

/** Only for trusted, constant markup (e.g. inline SVG icons defined in code). */
export function trusted(markup: string): SafeHtml {
  return new SafeHtml(markup);
}

export function attrIf(condition: boolean, name: string): SafeHtml {
  return new SafeHtml(condition ? ` ${name}` : '');
}
