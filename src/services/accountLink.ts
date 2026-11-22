import crypto from 'node:crypto';
import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import type { MessageKey } from '../i18n/index.js';
import { hitRateLimit } from '../auth/rateLimit.js';
import { notFound, tooManyRequests } from '../http/errors.js';
import { audit } from './audit.js';

/*
 * Linking a doctor's walk-in file to the patient's own Tabeeby account with a short code the patient
 * shows at the clinic. Only the account owner can make a code, so a file never reaches the wrong
 * person's account (unlike matching by a phone number that may be shared or reused).
 *
 * Security: 6 characters from a 31-letter alphabet (~887 million codes), 10-minute life, single use,
 * only a hash stored, at most 10 tries per doctor per hour, and the doctor confirms the account's
 * name before anything is linked.
 */

export const LINK_CODE_MINUTES = 10;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1 (easy to misread)
const CODE_LEN = 6;
const DOCTOR_TRIES = { limit: 10, window: 60 * 60 };
const PATIENT_CODES = { limit: 10, window: 60 * 60 };

const hashCode = (code: string) => crypto.createHash('sha256').update(`account-link:${code}`).digest();

/** Upper case, without spaces or dashes, Arabic-keyboard digits converted; null if not a code shape. */
export function normaliseLinkCode(raw: string): string | null {
  const c = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toUpperCase()
    .replace(/[\s-]/g, '');
  if (c.length !== CODE_LEN || [...c].some((ch) => !ALPHABET.includes(ch))) return null;
  return c;
}

export const formatLinkCode = (c: string) => `${c.slice(0, 3)}-${c.slice(3)}`;

function newCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

/** A fresh code for the signed-in patient; any earlier unused code stops working. */
export async function createLinkCode(deps: Deps, patientId: string, ip: string): Promise<{ code: string; expiresAt: Date }> {
  if (!(await hitRateLimit(deps.db, `link-code:${patientId}`, PATIENT_CODES.limit, PATIENT_CODES.window))) throw tooManyRequests();
  const expiresAt = new Date(deps.now().getTime() + LINK_CODE_MINUTES * 60_000);
  return deps.db.transaction(async (tx) => {
    await tx.query('update account_link_codes set consumed_at = $2 where patient_id = $1 and consumed_at is null', [patientId, deps.now()]);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newCode();
      const ins = await tx.query(
        `insert into account_link_codes (patient_id, code_hash, expires_at) values ($1, $2, $3)
         on conflict (code_hash) where consumed_at is null do nothing`,
        [patientId, hashCode(code), expiresAt],
      );
      if (ins.rowCount) {
        await audit(tx, { actorId: patientId, action: 'account_link.code_created', entityType: 'user', entityId: patientId, ip });
        return { code, expiresAt };
      }
    }
    throw new Error('could not create a unique link code');
  });
}

interface CodeOwner {
  code_id: string;
  patient_id: string;
  full_name: string;
  phone_e164: string;
}

async function findCode(db: Queryable, code: string, now: Date): Promise<CodeOwner | null> {
  const { rows } = await db.query<CodeOwner>(
    `select c.id as code_id, u.id as patient_id, u.full_name, u.phone_e164
       from account_link_codes c join users u on u.id = c.patient_id
      where c.code_hash = $1 and c.consumed_at is null and c.expires_at > $2 and u.role = 'patient' and u.status = 'active'`,
    [hashCode(code), now],
  );
  return rows[0] ?? null;
}

async function ownUnlinkedFile(db: Queryable, doctorId: string, recordId: string): Promise<{ patient_user_id: string | null }> {
  const { rows } = await db.query<{ patient_user_id: string | null }>('select patient_user_id from patient_records where id = $1 and doctor_id = $2', [recordId, doctorId]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

export type LinkCheck = { ok: true; owner: { name: string; phone: string }; code: string } | { ok: false; error: MessageKey };

/** Step 1 (doctor): check the code and show whose account it is, without linking yet. */
export async function checkLinkCode(deps: Deps, doctorId: string, recordId: string, raw: string): Promise<LinkCheck> {
  const file = await ownUnlinkedFile(deps.db, doctorId, recordId);
  if (file.patient_user_id) return { ok: false, error: 'link.err.alreadyLinked' };
  if (!(await hitRateLimit(deps.db, `link-try:${doctorId}`, DOCTOR_TRIES.limit, DOCTOR_TRIES.window))) return { ok: false, error: 'link.err.tooMany' };
  const code = normaliseLinkCode(raw);
  const owner = code ? await findCode(deps.db, code, deps.now()) : null;
  if (!code || !owner) return { ok: false, error: 'link.err.invalid' };
  const other = await deps.db.query('select 1 from patient_records where doctor_id = $1 and patient_user_id = $2', [doctorId, owner.patient_id]);
  if (other.rows.length) return { ok: false, error: 'link.err.hasOtherFile' };
  return { ok: true, owner: { name: owner.full_name, phone: owner.phone_e164 }, code };
}

/** Step 2 (doctor confirms the name): link the file to the account and use up the code. */
export async function confirmLinkCode(deps: Deps, doctorId: string, recordId: string, raw: string, ip: string): Promise<MessageKey | null> {
  const code = normaliseLinkCode(raw);
  if (!code) return 'link.err.invalid';
  return deps.db.transaction(async (tx) => {
    const file = await tx.query<{ patient_user_id: string | null }>('select patient_user_id from patient_records where id = $1 and doctor_id = $2 for update', [recordId, doctorId]);
    if (!file.rows[0]) throw notFound();
    if (file.rows[0].patient_user_id) return 'link.err.alreadyLinked';
    const { rows } = await tx.query<{ id: string; patient_id: string }>(
      `select c.id, c.patient_id from account_link_codes c join users u on u.id = c.patient_id
        where c.code_hash = $1 and c.consumed_at is null and c.expires_at > $2 and u.role = 'patient' and u.status = 'active' for update of c`,
      [hashCode(code), deps.now()],
    );
    const c = rows[0];
    if (!c) return 'link.err.invalid';
    const other = await tx.query('select 1 from patient_records where doctor_id = $1 and patient_user_id = $2', [doctorId, c.patient_id]);
    if (other.rows.length) return 'link.err.hasOtherFile';
    await tx.query('update patient_records set patient_user_id = $3, updated_at = now() where id = $1 and doctor_id = $2', [recordId, doctorId, c.patient_id]);
    await tx.query('update account_link_codes set consumed_at = $2, consumed_by = $3, record_id = $4 where id = $1', [c.id, deps.now(), doctorId, recordId]);
    await audit(tx, { actorId: doctorId, action: 'record.link_by_code', entityType: 'patient_record', entityId: recordId, metadata: { patientId: c.patient_id }, ip });
    return null;
  });
}
