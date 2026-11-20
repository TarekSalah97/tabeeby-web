import type { Queryable } from '../db/db.js';
import { randomToken, sha256 } from './tokens.js';

export type Role = 'patient' | 'doctor' | 'admin';

export interface SessionUser {
  id: string;
  role: Role;
  fullName: string;
  phone: string;
  phoneVerified: boolean;
  locale: 'ar' | 'en';
}

export interface Session {
  id: string;
  user: SessionUser;
}

/** Absolute lifetime and idle timeout per role. Staff accounts expire sooner. */
const POLICY: Record<Role, { absoluteHours: number; idleHours: number }> = {
  patient: { absoluteHours: 24 * 30, idleHours: 24 * 14 },
  doctor: { absoluteHours: 24 * 7, idleHours: 12 },
  admin: { absoluteHours: 12, idleHours: 1 },
};

export const SESSION_COOKIE = 'tb_session';

export function sessionMaxAgeSeconds(role: Role): number {
  return POLICY[role].absoluteHours * 3600;
}

export async function createSession(db: Queryable, userId: string, role: Role): Promise<string> {
  const token = randomToken();
  await db.query(
    `insert into sessions (user_id, token_hash, expires_at) values ($1, $2, now() + make_interval(hours => $3::int))`,
    [userId, sha256(token), POLICY[role].absoluteHours],
  );
  return token;
}

export async function loadSession(db: Queryable, token: string): Promise<Session | null> {
  if (!token || token.length > 100) return null;
  const { rows } = await db.query<{
    session_id: string;
    last_seen_at: Date;
    id: string;
    role: Role;
    full_name: string;
    phone_e164: string;
    phone_verified_at: Date | null;
    preferred_locale: 'ar' | 'en';
  }>(
    `select s.id as session_id, s.last_seen_at, u.id, u.role, u.full_name, u.phone_e164, u.phone_verified_at, u.preferred_locale
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now() and u.status = 'active'`,
    [sha256(token)],
  );
  const r = rows[0];
  if (!r) return null;
  const idleMs = POLICY[r.role].idleHours * 3600_000;
  if (Date.now() - r.last_seen_at.getTime() > idleMs) {
    await db.query('delete from sessions where id = $1', [r.session_id]);
    return null;
  }
  // Avoid a write on every request: refresh activity at most every 5 minutes.
  if (Date.now() - r.last_seen_at.getTime() > 5 * 60_000) {
    await db.query('update sessions set last_seen_at = now() where id = $1', [r.session_id]);
  }
  return {
    id: r.session_id,
    user: {
      id: r.id,
      role: r.role,
      fullName: r.full_name,
      phone: r.phone_e164,
      phoneVerified: r.phone_verified_at !== null,
      locale: r.preferred_locale,
    },
  };
}

export async function destroySession(db: Queryable, sessionId: string): Promise<void> {
  await db.query('delete from sessions where id = $1', [sessionId]);
}

export async function destroyUserSessions(db: Queryable, userId: string): Promise<void> {
  await db.query('delete from sessions where user_id = $1', [userId]);
}
