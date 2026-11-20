import type { Queryable } from '../db/db.js';

/**
 * Fixed-window counter stored in Postgres so limits hold across all app
 * instances. Returns true when the action is allowed.
 */
export async function hitRateLimit(db: Queryable, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { rows } = await db.query<{ hits: number }>(
    `insert into rate_limits (key, window_start, hits)
     values ($1, to_timestamp(floor(extract(epoch from now()) / $2::int) * $2::int), 1)
     on conflict (key, window_start) do update set hits = rate_limits.hits + 1
     returning hits`,
    [key, windowSeconds],
  );
  return (rows[0]?.hits ?? 0) <= limit;
}

export const LIMITS = {
  loginPerIp: { limit: 30, window: 15 * 60 },
  loginPerPhone: { limit: 8, window: 15 * 60 },
  signupPerIp: { limit: 10, window: 60 * 60 },
  otpSendPerUser: { limit: 3, window: 10 * 60 },
  otpSendPerUserDaily: { limit: 10, window: 24 * 60 * 60 },
  bookingPerUser: { limit: 10, window: 60 * 60 },
  reviewPerUser: { limit: 20, window: 60 * 60 },
  waitlistPerUser: { limit: 20, window: 60 * 60 },
  guestStartPerIp: { limit: 10, window: 60 * 60 },
  emailCodePerAddress: { limit: 5, window: 60 * 60 },
} as const;
