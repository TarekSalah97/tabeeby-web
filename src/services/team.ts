import crypto from 'node:crypto';
import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import { isUniqueViolation } from '../db/db.js';
import { normalizeEgyptMobile } from '../domain/phone.js';
import { hashPassword, checkPasswordPolicy } from '../auth/password.js';
import { randomToken, sha256 } from '../auth/tokens.js';
import { destroyUserSessions, type StaffAccess } from '../auth/sessions.js';
import type { MessageKey } from '../i18n/index.js';
import { notFound } from '../http/errors.js';
import { validateName, type FieldErrors } from './accounts.js';
import { audit } from './audit.js';

/**
 * A doctor's secretaries/assistants. Each has their own account (role 'assistant') linked to one
 * doctor. The doctor creates it and sends a one-time invite link; the secretary chooses a password.
 */
export const MAX_TEAM = 5;
export const INVITE_DAYS = 7;
export const isStaffAccess = (s: string): s is StaffAccess => s === 'schedule' || s === 'files';

export interface TeamMember {
  user_id: string;
  full_name: string;
  phone_e164: string;
  access: StaffAccess;
  invited: boolean;
  last_seen: Date | null;
}

export async function listTeam(db: Queryable, doctorId: string): Promise<TeamMember[]> {
  return (
    await db.query<TeamMember>(
      `select a.user_id, u.full_name, u.phone_e164, a.access, a.invite_hash is not null as invited,
              (select max(s.last_seen_at) from sessions s where s.user_id = u.id) as last_seen
         from doctor_assistants a join users u on u.id = a.user_id
        where a.doctor_id = $1 and u.status = 'active' order by a.created_at`,
      [doctorId],
    )
  ).rows;
}

async function newInvite(tx: Queryable, userId: string): Promise<string> {
  const token = randomToken();
  await tx.query(
    `update doctor_assistants set invite_hash = $2, invite_expires_at = now() + make_interval(days => $3) where user_id = $1`,
    [userId, sha256(token), INVITE_DAYS],
  );
  return token;
}

/** Creates the secretary's account and returns the one-time invite token (shown to the doctor once). */
export async function addTeamMember(
  deps: Deps,
  doctorId: string,
  input: { fullName: string; phone: string; access: string },
  ip: string,
): Promise<{ token: string; name: string } | { errors: FieldErrors }> {
  const errors: FieldErrors = {};
  const fullName = input.fullName.trim().replace(/\s+/g, ' ');
  const nameErr = validateName(fullName);
  if (nameErr) errors['fullName'] = nameErr;
  const phone = normalizeEgyptMobile(input.phone);
  if (!phone) errors['phone'] = 'phone.invalid';
  if (!isStaffAccess(input.access)) errors['access'] = 'team.err.access';
  if (Object.keys(errors).length || !phone || !isStaffAccess(input.access)) return { errors };
  const unusable = await hashPassword(crypto.randomBytes(32).toString('base64url'));
  try {
    return await deps.db.transaction(async (tx) => {
      await tx.query('select 1 from doctors where user_id = $1 for update', [doctorId]);
      const n = await tx.query<{ n: number }>(
        `select count(*)::int as n from doctor_assistants a join users u on u.id = a.user_id where a.doctor_id = $1 and u.status = 'active'`,
        [doctorId],
      );
      if ((n.rows[0]?.n ?? 0) >= MAX_TEAM) return { errors: { fullName: 'team.err.tooMany' as MessageKey } };
      const { rows } = await tx.query<{ id: string }>(
        `insert into users (role, full_name, phone_e164, password_hash, has_password, preferred_locale)
         values ('assistant', $1, $2, $3, false, 'ar') returning id`,
        [fullName, phone, unusable],
      );
      const id = rows[0]!.id;
      await tx.query('insert into doctor_assistants (user_id, doctor_id, access) values ($1, $2, $3)', [id, doctorId, input.access]);
      const token = await newInvite(tx, id);
      await audit(tx, { actorId: doctorId, action: 'team.add', entityType: 'user', entityId: id, metadata: { access: input.access }, ip });
      return { token, name: fullName };
    });
  } catch (e) {
    if (isUniqueViolation(e, 'users_phone_e164_key')) return { errors: { phone: 'team.err.phoneTaken' } };
    throw e;
  }
}

async function ownMember(tx: Queryable, doctorId: string, userId: string): Promise<{ full_name: string }> {
  const { rows } = await tx.query<{ full_name: string }>(
    `select u.full_name from doctor_assistants a join users u on u.id = a.user_id
      where a.user_id = $1 and a.doctor_id = $2 and u.status = 'active' for update of a`,
    [userId, doctorId],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

export async function setTeamAccess(deps: Deps, doctorId: string, userId: string, access: string, ip: string): Promise<MessageKey | null> {
  if (!isStaffAccess(access)) return 'team.err.access';
  await deps.db.transaction(async (tx) => {
    await ownMember(tx, doctorId, userId);
    await tx.query('update doctor_assistants set access = $2 where user_id = $1', [userId, access]);
    await audit(tx, { actorId: doctorId, action: 'team.access', entityType: 'user', entityId: userId, metadata: { access }, ip });
  });
  return null;
}

/** A fresh invite link (the old one stops working), e.g. if the first was lost or expired. */
export async function reinviteTeamMember(deps: Deps, doctorId: string, userId: string, ip: string): Promise<{ token: string; name: string }> {
  return deps.db.transaction(async (tx) => {
    const m = await ownMember(tx, doctorId, userId);
    const token = await newInvite(tx, userId);
    await audit(tx, { actorId: doctorId, action: 'team.reinvite', entityType: 'user', entityId: userId, ip });
    return { token, name: m.full_name };
  });
}

/** Removes a secretary: signed out at once, the account closed, the mobile free again. */
export async function removeTeamMember(deps: Deps, doctorId: string, userId: string, ip: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    await ownMember(tx, doctorId, userId);
    await tx.query(
      `update users set status = 'removed', full_name = 'Removed account', phone_e164 = 'removed:' || id::text, email = null,
              password_hash = 'removed', updated_at = now() where id = $1`,
      [userId],
    );
    await tx.query('update doctor_assistants set invite_hash = null, invite_expires_at = null where user_id = $1', [userId]);
    await destroyUserSessions(tx, userId);
    await audit(tx, { actorId: doctorId, action: 'team.remove', entityType: 'user', entityId: userId, ip });
  });
}

export interface InviteInfo {
  user_id: string;
  full_name: string;
  phone_e164: string;
  doctor_name: string;
}

export async function findInvite(db: Queryable, token: string): Promise<InviteInfo | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const { rows } = await db.query<InviteInfo>(
    `select a.user_id, u.full_name, u.phone_e164, du.full_name as doctor_name
       from doctor_assistants a join users u on u.id = a.user_id join users du on du.id = a.doctor_id
      where a.invite_hash = $1 and a.invite_expires_at > now() and u.status = 'active' and du.status = 'active'`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

/** The secretary chooses a password; the link stops working. Returns their user id. */
export async function acceptInvite(deps: Deps, token: string, password: string, ip: string): Promise<{ userId: string } | { error: MessageKey }> {
  const invite = await findInvite(deps.db, token);
  if (!invite) return { error: 'team.joinExpired' };
  const pwErr = checkPasswordPolicy(password, [invite.full_name]);
  if (pwErr) return { error: pwErr };
  const hash = await hashPassword(password);
  return deps.db.transaction(async (tx) => {
    const r = await tx.query(
      `update doctor_assistants set invite_hash = null, invite_expires_at = null where user_id = $1 and invite_hash = $2 and invite_expires_at > now()`,
      [invite.user_id, sha256(token)],
    );
    if (!r.rowCount) return { error: 'team.joinExpired' as MessageKey };
    await tx.query('update users set password_hash = $2, has_password = true, phone_verified_at = coalesce(phone_verified_at, now()), updated_at = now() where id = $1', [invite.user_id, hash]);
    await audit(tx, { actorId: invite.user_id, action: 'team.joined', entityType: 'user', entityId: invite.user_id, ip });
    return { userId: invite.user_id };
  });
}
