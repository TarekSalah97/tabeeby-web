/*
 * First line of defence, before any database work:
 *  - a per-IP request budget (sliding one-minute window, kept in memory) so one address cannot
 *    flood the site or hammer forms; form submissions get a much smaller budget than page views;
 *  - instant 404 for common attack probes (WordPress, PHP, .env, .git, …) — this site has none of them.
 * Per-feature limits (sign-in, codes, bookings, messages) still apply on top, in the database.
 */

export interface ShieldLimits {
  /** Requests per minute per IP for pages (static files are not counted). */
  pagesPerMinute: number;
  /** Form submissions (POST) per minute per IP. */
  postsPerMinute: number;
}

export const DEFAULT_SHIELD: ShieldLimits = { pagesPerMinute: 240, postsPerMinute: 40 };

const WINDOW_MS = 60_000;
/** Above this many tracked addresses, old entries are dropped (memory stays bounded under attack). */
const MAX_TRACKED = 50_000;

interface Bucket {
  start: number;
  pages: number;
  posts: number;
}

export class RequestShield {
  private buckets = new Map<string, Bucket>();
  constructor(private limits: ShieldLimits = DEFAULT_SHIELD, private now: () => number = Date.now) {}

  /** True when this request is allowed; false when the IP is over its budget for this minute. */
  allow(ip: string, isPost: boolean): boolean {
    const t = this.now();
    let b = this.buckets.get(ip);
    if (!b || t - b.start >= WINDOW_MS) {
      if (!b && this.buckets.size >= MAX_TRACKED) this.prune(t);
      b = { start: t, pages: 0, posts: 0 };
      this.buckets.set(ip, b);
    }
    if (isPost) {
      b.posts++;
      return b.posts <= this.limits.postsPerMinute;
    }
    b.pages++;
    return b.pages <= this.limits.pagesPerMinute;
  }

  private prune(t: number): void {
    for (const [ip, b] of this.buckets) if (t - b.start >= WINDOW_MS) this.buckets.delete(ip);
    // Still full (a real flood from many addresses): start over rather than grow without limit.
    if (this.buckets.size >= MAX_TRACKED) this.buckets.clear();
  }
}

const PROBES = [
  /\.(php\d?|asp|aspx|jsp|cgi|env|ini|bak|sql|swp|ds_store)$/i,
  /^\/(wp-|wordpress|xmlrpc|phpmyadmin|pma|cgi-bin|vendor\/|actuator|boaform|HNAP1|owa\/|autodiscover)/i,
  /(^|\/)\.(git|svn|hg|env|aws|ssh|htaccess|htpasswd|vscode|idea)(\/|$)/i,
  /\.\.(\/|\\|%2f|%5c)/i,
];

/** Paths only attack tools ask for. */
export function isProbe(path: string): boolean {
  let p = path;
  try {
    p = decodeURIComponent(path);
  } catch {
    return true; // broken encoding is never a real visitor
  }
  return PROBES.some((r) => r.test(p) || r.test(path));
}
