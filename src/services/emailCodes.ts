import crypto from 'node:crypto';
import type { Queryable, Tx } from '../db/db.js';
import { sha256 } from '../auth/tokens.js';
import type { MessageKey } from '../i18n/index.js';

/** One-time 6-digit codes sent by email; only a hash is stored, bound to the code's own id. */
export const EMAIL_CODE_TTL_MINUTES = 15;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;

export type EmailCodePurpose = 'guest_booking' | 'login';

const hashCode = (id: string, code: string) => sha256(`email:${id}:${code}`);

export const newCode = (): string => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/** Valid email shape (deliberately simple: the emailed code is the real check). */
export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  if (e.length < 6 || e.length > 254) return null;
  return /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i.test(e) ? e : null;
}

/** "a•••@gmail.com" — enough for the person to recognise their address, not to reveal it. */
export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  // Wrapped in a left-to-right isolate so it reads correctly inside Arabic sentences.
  return `\u2066${user.slice(0, 1)}•••@${domain}\u2069`;
}

/** Stores a new code (older unused codes for the same email and purpose stop working) and returns its id. */
export async function createEmailCode(tx: Queryable, email: string, purpose: EmailCodePurpose, code: string, payload: Record<string, unknown>): Promise<string> {
  await tx.query(`update email_codes set consumed_at = now() where email = $1 and purpose = $2 and consumed_at is null`, [email, purpose]);
  const id = crypto.randomUUID();
  await tx.query(
    `insert into email_codes (id, email, purpose, code_hash, payload, expires_at) values ($1, $2, $3, $4, $5, now() + make_interval(mins => $6::int))`,
    [id, email, purpose, hashCode(id, code), payload, EMAIL_CODE_TTL_MINUTES],
  );
  return id;
}

export interface EmailCodeRow {
  id: string;
  email: string;
  purpose: EmailCodePurpose;
  payload: Record<string, unknown>;
}

/** Public view of a pending code, for the "enter your code" page. Null when unknown or no longer usable. */
export async function pendingEmailCode(db: Queryable, id: string, purpose: EmailCodePurpose): Promise<EmailCodeRow | null> {
  const { rows } = await db.query<EmailCodeRow>(
    `select id, email, purpose, payload from email_codes
      where id = $1 and purpose = $2 and consumed_at is null and expires_at > now() and attempts < $3`,
    [id, purpose, EMAIL_CODE_MAX_ATTEMPTS],
  );
  return rows[0] ?? null;
}

/**
 * Checks a code inside the caller's transaction. A wrong code counts an attempt (and is
 * committed by returning, not throwing); a right one consumes the code.
 */
export async function consumeEmailCode(
  tx: Tx,
  id: string,
  purpose: EmailCodePurpose,
  codeRaw: string,
): Promise<{ ok: true; row: EmailCodeRow } | { ok: false; error: MessageKey }> {
  const code = codeRaw.replace(/\D/g, '');
  const { rows } = await tx.query<EmailCodeRow & { code_hash: Buffer | string; attempts: number; expired: boolean; consumed: boolean }>(
    `select id, email, purpose, payload, code_hash, attempts, expires_at < now() as expired, consumed_at is not null as consumed
       from email_codes where id = $1 and purpose = $2 for update`,
    [id, purpose],
  );
  const row = rows[0];
  if (!row || row.consumed || row.expired) return { ok: false, error: 'emailCode.expired' };
  if (row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) return { ok: false, error: 'emailCode.tooManyAttempts' };
  // bytea arrives as '\x…' hex text from the driver.
  const stored = typeof row.code_hash === 'string' ? Buffer.from(row.code_hash.replace(/^\\x/, ''), 'hex') : row.code_hash;
  if (code.length !== 6 || !crypto.timingSafeEqual(stored, hashCode(id, code))) {
    await tx.query('update email_codes set attempts = attempts + 1 where id = $1', [id]);
    return { ok: false, error: row.attempts + 1 >= EMAIL_CODE_MAX_ATTEMPTS ? 'emailCode.tooManyAttempts' : 'emailCode.invalid' };
  }
  await tx.query('update email_codes set consumed_at = now() where id = $1', [id]);
  return { ok: true, row: { id: row.id, email: row.email, purpose: row.purpose, payload: row.payload } };
}
