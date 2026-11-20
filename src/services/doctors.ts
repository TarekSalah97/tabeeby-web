import crypto from 'node:crypto';
import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import { isUniqueViolation } from '../db/db.js';
import type { Locale, MessageKey } from '../i18n/index.js';
import { normalizeEgyptMobile, normalizeDigits } from '../domain/phone.js';
import { checkPasswordPolicy, hashPassword } from '../auth/password.js';
import { hitRateLimit, LIMITS } from '../auth/rateLimit.js';
import { validatePosition, type PositionRange } from '../domain/experience.js';
import { rulesOverlap } from '../domain/availability.js';
import { isValidDate, isValidTime, zonedToUtc, addDays } from '../domain/time.js';
import { sniffDocumentType } from '../storage/files.js';
import type { UploadedFile } from '../http/body.js';
import { audit } from './audit.js';
import { getReference } from './reference.js';
import { validateName, type FieldErrors } from './accounts.js';
import { tooManyRequests, notFound } from '../http/errors.js';

export const LANGUAGES = ['ar', 'en', 'fr', 'de'] as const;
export const SLOT_LENGTHS = [10, 15, 20, 30, 45, 60] as const;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export interface PositionInput {
  title: string;
  workplace: string;
  start: string; // YYYY-MM
  end: string; // '' = present
}

export interface DoctorSignup {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  kind: string;
  specialtyId: number;
  subspecialtyIds: number[];
  graduationYear: number;
  positions: PositionInput[];
  card: UploadedFile | undefined;
  consent: boolean;
  locale: Locale;
  ip: string;
}

/** Rows the doctor left completely empty are ignored; half-filled rows are an error. */
export function cleanPositions(rows: PositionInput[], now: Date): { positions: PositionInput[]; error: MessageKey | null } {
  const positions: PositionInput[] = [];
  for (const r of rows) {
    const filled = [r.title, r.workplace, r.start, r.end].filter((v) => v.trim() !== '').length;
    if (filled === 0) continue;
    if (!r.title.trim() || !r.workplace.trim() || !r.start) return { positions, error: 'join.positionIncomplete' };
    const err = validatePosition({ start: r.start, end: r.end || null }, now);
    if (err) return { positions, error: err };
    positions.push({ ...r, title: r.title.trim().slice(0, 120), workplace: r.workplace.trim().slice(0, 160) });
  }
  return { positions, error: null };
}

function slugBase(name: string): string {
  const latin = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^dr\.?\s+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return latin.length >= 3 ? `dr-${latin}` : 'dr';
}

export async function registerDoctor(deps: Deps, input: DoctorSignup): Promise<{ userId: string } | { errors: FieldErrors }> {
  const { db, cfg, storage } = deps;
  const ref = await getReference(db);
  const errors: FieldErrors = {};
  const now = deps.now();

  const phone = normalizeEgyptMobile(input.phone);
  const email = input.email.trim().toLowerCase();
  const nameErr = validateName(input.fullName);
  if (nameErr) errors['fullName'] = nameErr;
  if (!phone) errors['phone'] = 'phone.invalid';
  if (!EMAIL_RE.test(email)) errors['email'] = 'email.invalid';
  const pwErr = checkPasswordPolicy(input.password, [input.fullName, email.split('@')[0] ?? '']);
  if (pwErr) errors['password'] = pwErr;
  if (input.kind !== 'medical' && input.kind !== 'dental') errors['kind'] = 'join.specialtyInvalid';

  const specialty = ref.specialtyById.get(input.specialtyId);
  if (!specialty) errors['specialty'] = 'join.specialtyInvalid';
  else if (specialty.kind !== input.kind) errors['specialty'] = 'join.specialtyInvalid';
  const validSubs = new Set(specialty?.subspecialties.map((s) => s.id) ?? []);
  if (input.subspecialtyIds.some((id) => !validSubs.has(id))) errors['subspecialties'] = 'join.subsMismatch';

  const year = now.getUTCFullYear();
  if (!Number.isInteger(input.graduationYear) || input.graduationYear < 1950 || input.graduationYear > year) errors['graduationYear'] = 'join.gradYearInvalid';

  const { positions, error: posErr } = cleanPositions(input.positions, now);
  if (posErr) errors['positions'] = posErr;

  let cardType: ReturnType<typeof sniffDocumentType> = null;
  if (!input.card) errors['card'] = 'join.cardRequired';
  else if (input.card.data.length > cfg.MAX_UPLOAD_BYTES) errors['card'] = 'join.cardTooLarge';
  else if (!(cardType = sniffDocumentType(input.card.data))) errors['card'] = 'join.cardInvalid';

  if (!input.consent) errors['consent'] = 'auth.consentRequired';
  if (Object.keys(errors).length || !phone || !input.card || !cardType) return { errors };

  if (!(await hitRateLimit(db, `signup:ip:${input.ip}`, LIMITS.signupPerIp.limit, LIMITS.signupPerIp.window))) throw tooManyRequests();

  const passwordHash = await hashPassword(input.password);
  const storageKey = await storage.put(input.card.data, cardType.ext);
  try {
    const userId = await db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into users (role, full_name, phone_e164, email, password_hash, preferred_locale)
         values ('doctor', $1, $2, $3, $4, $5) returning id`,
        [input.fullName.trim().replace(/\s+/g, ' '), phone, email, passwordHash, input.locale],
      );
      const id = rows[0]!.id;
      const slug = `${slugBase(input.fullName)}-${crypto.randomBytes(3).toString('hex')}`;
      await tx.query(
        `insert into doctors (user_id, slug, kind, specialty_id, graduation_year, trial_ends_at)
         values ($1, $2, $3, $4, $5, now() + interval '3 months')`,
        [id, slug, input.kind, input.specialtyId, input.graduationYear],
      );
      if (input.subspecialtyIds.length) {
        await tx.query(
          `insert into doctor_subspecialties (doctor_id, subspecialty_id) select $1, unnest($2::int[]) on conflict do nothing`,
          [id, input.subspecialtyIds],
        );
      }
      for (const p of positions) await insertPosition(tx, id, p);
      await tx.query(
        `insert into verification_documents (doctor_id, kind, storage_key, mime_type, size_bytes, sha256)
         values ($1, 'syndicate_card', $2, $3, $4, $5)`,
        [id, storageKey, cardType!.mime, input.card!.data.length, crypto.createHash('sha256').update(input.card!.data).digest('hex')],
      );
      await audit(tx, { actorId: id, action: 'doctor.signup', entityType: 'doctor', entityId: id, ip: input.ip });
      return id;
    });
    return { userId };
  } catch (e) {
    await storage.remove(storageKey);
    if (isUniqueViolation(e, 'users_phone_e164_key')) return { errors: { phone: 'auth.phoneTaken' } };
    if (isUniqueViolation(e, 'users_email_key')) return { errors: { email: 'join.emailTaken' } };
    throw e;
  }
}

async function insertPosition(db: Queryable, doctorId: string, p: PositionInput): Promise<void> {
  await db.query(
    `insert into doctor_positions (doctor_id, title, workplace, start_month, end_month) values ($1, $2, $3, $4::date, $5::date)`,
    [doctorId, p.title, p.workplace, `${p.start}-01`, p.end ? `${p.end}-01` : null],
  );
}

// ---------------------------------------------------------------------------
// The signed-in doctor's own data. Every query is scoped by doctor_id = the
// session user, so one doctor can never read or change another's records.
// ---------------------------------------------------------------------------

export interface OwnDoctor {
  user_id: string;
  slug: string;
  kind: 'medical' | 'dental';
  full_name: string;
  title_en: string;
  title_ar: string;
  bio: string;
  specialty_id: number;
  graduation_year: number;
  gender: 'female' | 'male' | null;
  languages: string[];
  verification_status: 'pending' | 'approved' | 'rejected' | 'suspended';
  verification_note: string | null;
}

export async function getOwnDoctor(db: Queryable, userId: string): Promise<OwnDoctor> {
  const { rows } = await db.query<OwnDoctor>(
    `select d.user_id, d.slug, d.kind, u.full_name, d.title_en, d.title_ar, d.bio, d.specialty_id, d.graduation_year,
            d.gender, d.languages, d.verification_status, d.verification_note
       from doctors d join users u on u.id = d.user_id where d.user_id = $1`,
    [userId],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

export interface ClinicRow {
  id: string;
  name: string;
  district_id: number;
  address: string;
  phone_e164: string | null;
  fee_egp: number;
  is_active: boolean;
}

export async function listOwnClinics(db: Queryable, doctorId: string): Promise<ClinicRow[]> {
  return (
    await db.query<ClinicRow>(
      'select id, name, district_id, address, phone_e164, fee_egp, is_active from clinics where doctor_id = $1 order by created_at',
      [doctorId],
    )
  ).rows;
}

export interface ClinicInput {
  name: string;
  districtId: number;
  address: string;
  phone: string;
  fee: string;
  isActive: boolean;
}

export async function validateClinic(db: Queryable, input: ClinicInput): Promise<{ errors: FieldErrors; phone: string | null; fee: number }> {
  const errors: FieldErrors = {};
  const ref = await getReference(db);
  if (input.name.trim().length < 2 || input.name.trim().length > 120) errors['name'] = 'clinics.nameInvalid';
  if (!ref.districtById.has(input.districtId)) errors['district'] = 'clinics.districtInvalid';
  if (input.address.trim().length < 5 || input.address.trim().length > 300) errors['address'] = 'clinics.addressInvalid';
  const feeDigits = normalizeDigits(input.fee).replace(/[,\s]/g, '');
  const fee = /^\d{1,6}$/.test(feeDigits) ? Number(feeDigits) : NaN;
  if (!Number.isInteger(fee) || fee < 0 || fee > 100000) errors['fee'] = 'clinics.feeInvalid';
  let phone: string | null = null;
  if (input.phone.trim()) {
    const digits = normalizeDigits(input.phone).replace(/[\s\-()]/g, '').replace(/^(\+20|0020|0)/, '');
    if (/^\d{8,10}$/.test(digits)) phone = `+20${digits}`;
    else errors['phone'] = 'phone.invalid';
  }
  return { errors, phone, fee };
}

export async function saveClinic(deps: Deps, doctorId: string, clinicId: string | null, input: ClinicInput): Promise<FieldErrors> {
  const { errors, phone, fee } = await validateClinic(deps.db, input);
  if (Object.keys(errors).length) return errors;
  const values = [doctorId, input.name.trim(), input.districtId, input.address.trim(), phone, fee, input.isActive];
  if (clinicId) {
    const r = await deps.db.query(
      `update clinics set name = $2, district_id = $3, address = $4, phone_e164 = $5, fee_egp = $6, is_active = $7, updated_at = now()
        where id = $8 and doctor_id = $1`,
      [...values, clinicId],
    );
    if (r.rowCount === 0) throw notFound();
  } else {
    await deps.db.query(
      `insert into clinics (doctor_id, name, district_id, address, phone_e164, fee_egp, is_active) values ($1, $2, $3, $4, $5, $6, $7)`,
      values,
    );
  }
  return {};
}

export interface RuleRow {
  id: string;
  clinic_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  slot_minutes: number;
}

export async function listOwnRules(db: Queryable, doctorId: string): Promise<RuleRow[]> {
  return (
    await db.query<RuleRow>(
      `select r.id, r.clinic_id, r.weekday, to_char(r.start_time, 'HH24:MI') as start_time, to_char(r.end_time, 'HH24:MI') as end_time, r.slot_minutes
         from schedule_rules r join clinics c on c.id = r.clinic_id
        where c.doctor_id = $1 order by r.weekday, r.start_time`,
      [doctorId],
    )
  ).rows;
}

export interface DayHours {
  weekday: number;
  start: string;
  end: string;
}

/** A problem with a schedule submission; `weekday` names the day it concerns, when there is one. */
export interface RuleProblem {
  key: MessageKey;
  weekday?: number;
}

/**
 * Adds working hours for one clinic on several days at once. All or nothing:
 * if any day is invalid or overlaps hours the doctor already has (at any of
 * their clinics) or another day in the same submission, nothing is saved.
 */
export async function addRules(
  deps: Deps,
  doctorId: string,
  input: { clinicId: string; slotMinutes: number; days: DayHours[] },
): Promise<RuleProblem | null> {
  if (input.days.length === 0) return { key: 'hours.noDays' };
  if (!(SLOT_LENGTHS as readonly number[]).includes(input.slotMinutes)) return { key: 'hours.invalidTimes' };
  const seen = new Set<number>();
  for (const d of input.days) {
    if (!Number.isInteger(d.weekday) || d.weekday < 0 || d.weekday > 6 || seen.has(d.weekday)) return { key: 'hours.invalidTimes' };
    seen.add(d.weekday);
    if (!isValidTime(d.start) || !isValidTime(d.end) || d.end <= d.start) return { key: 'hours.invalidTimesDay', weekday: d.weekday };
  }
  return deps.db.transaction(async (tx) => {
    // Lock the doctor row so two concurrent additions cannot both pass the overlap check.
    await tx.query('select 1 from doctors where user_id = $1 for update', [doctorId]);
    const clinic = await tx.query('select 1 from clinics where id = $1 and doctor_id = $2', [input.clinicId, doctorId]);
    if (!clinic.rows[0]) throw notFound();
    const existing = (await listOwnRules(tx, doctorId)).map((r) => ({ weekday: r.weekday, startTime: r.start_time, endTime: r.end_time }));
    for (const d of input.days) {
      const candidate = { weekday: d.weekday, startTime: d.start, endTime: d.end };
      if (existing.some((r) => rulesOverlap(candidate, r))) return { key: 'hours.overlapDay', weekday: d.weekday };
    }
    for (const d of input.days) {
      await tx.query(
        `insert into schedule_rules (clinic_id, weekday, start_time, end_time, slot_minutes) values ($1, $2, $3::time, $4::time, $5)`,
        [input.clinicId, d.weekday, d.start, d.end, input.slotMinutes],
      );
    }
    return null;
  });
}

export async function deleteRule(db: Queryable, doctorId: string, ruleId: string): Promise<void> {
  const r = await db.query(
    `delete from schedule_rules r using clinics c where r.id = $1 and r.clinic_id = c.id and c.doctor_id = $2`,
    [ruleId, doctorId],
  );
  if (r.rowCount === 0) throw notFound();
}

export interface BlockRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
  note: string | null;
}

export async function listOwnBlocks(db: Queryable, doctorId: string): Promise<BlockRow[]> {
  return (
    await db.query<BlockRow>(
      `select id, starts_at, ends_at, note from schedule_blocks where doctor_id = $1 and ends_at > now() order by starts_at`,
      [doctorId],
    )
  ).rows;
}

/** A block covers whole days in clinic-local time: [fromDate 00:00, toDate+1 00:00). */
export async function addBlock(deps: Deps, doctorId: string, input: { fromDate: string; toDate: string; note: string }): Promise<MessageKey | null> {
  const to = input.toDate || input.fromDate;
  if (!isValidDate(input.fromDate) || !isValidDate(to) || to < input.fromDate) return 'hours.blockInvalid';
  const tz = deps.cfg.TIME_ZONE;
  const startsAt = zonedToUtc(input.fromDate, '00:00', tz);
  const endsAt = zonedToUtc(addDays(to, 1), '00:00', tz);
  if (endsAt.getTime() - startsAt.getTime() > 366 * 86400_000) return 'hours.blockInvalid';
  await deps.db.query(`insert into schedule_blocks (doctor_id, starts_at, ends_at, note) values ($1, $2, $3, $4)`, [
    doctorId,
    startsAt,
    endsAt,
    input.note.trim().slice(0, 200) || null,
  ]);
  return null;
}

export async function deleteBlock(db: Queryable, doctorId: string, blockId: string): Promise<void> {
  const r = await db.query('delete from schedule_blocks where id = $1 and doctor_id = $2', [blockId, doctorId]);
  if (r.rowCount === 0) throw notFound();
}

export interface PositionRow {
  id: string;
  title: string;
  workplace: string;
  start: string;
  end: string | null;
}

export async function listPositions(db: Queryable, doctorIds: string[]): Promise<Map<string, PositionRow[]>> {
  const { rows } = await db.query<PositionRow & { doctor_id: string }>(
    `select id, doctor_id, title, workplace, to_char(start_month, 'YYYY-MM') as start, to_char(end_month, 'YYYY-MM') as "end"
       from doctor_positions where doctor_id = any($1::uuid[]) order by start_month desc`,
    [doctorIds],
  );
  const map = new Map<string, PositionRow[]>();
  for (const r of rows) {
    const list = map.get(r.doctor_id) ?? [];
    list.push({ id: r.id, title: r.title, workplace: r.workplace, start: r.start, end: r.end });
    map.set(r.doctor_id, list);
  }
  return map;
}

export const toRanges = (rows: PositionRow[]): PositionRange[] => rows.map((r) => ({ start: r.start, end: r.end }));

export async function addPosition(deps: Deps, doctorId: string, p: PositionInput): Promise<MessageKey | null> {
  const { positions, error } = cleanPositions([p], deps.now());
  if (error) return error;
  if (!positions[0]) return 'join.positionIncomplete';
  await insertPosition(deps.db, doctorId, positions[0]);
  return null;
}

export async function deletePosition(db: Queryable, doctorId: string, positionId: string): Promise<void> {
  const r = await db.query('delete from doctor_positions where id = $1 and doctor_id = $2', [positionId, doctorId]);
  if (r.rowCount === 0) throw notFound();
}

export interface ProfileInput {
  titleEn: string;
  titleAr: string;
  bio: string;
  gender: string;
  languages: string[];
  subspecialtyIds: number[];
  insurerIds: number[];
}

export async function updateProfile(deps: Deps, doctorId: string, input: ProfileInput): Promise<FieldErrors> {
  const ref = await getReference(deps.db);
  const doctor = await getOwnDoctor(deps.db, doctorId);
  const errors: FieldErrors = {};
  if (input.bio.length > 2000) errors['bio'] = 'profile.bioTooLong';
  const validSubs = new Set(ref.specialtyById.get(doctor.specialty_id)?.subspecialties.map((s) => s.id) ?? []);
  if (input.subspecialtyIds.some((id) => !validSubs.has(id))) errors['subspecialties'] = 'join.subsMismatch';
  if (Object.keys(errors).length) return errors;
  const validInsurers = new Set(ref.insurers.map((i) => i.id));
  const languages = input.languages.filter((l): l is (typeof LANGUAGES)[number] => (LANGUAGES as readonly string[]).includes(l));
  const gender = input.gender === 'female' || input.gender === 'male' ? input.gender : null;

  await deps.db.transaction(async (tx) => {
    await tx.query(
      `update doctors set title_en = $2, title_ar = $3, bio = $4, gender = $5, languages = $6::text[], updated_at = now() where user_id = $1`,
      [doctorId, input.titleEn.trim().slice(0, 160), input.titleAr.trim().slice(0, 160), input.bio.trim(), gender, languages.length ? languages : ['ar']],
    );
    await tx.query('delete from doctor_subspecialties where doctor_id = $1', [doctorId]);
    if (input.subspecialtyIds.length) {
      await tx.query('insert into doctor_subspecialties (doctor_id, subspecialty_id) select $1, unnest($2::int[]) on conflict do nothing', [
        doctorId,
        input.subspecialtyIds,
      ]);
    }
    await tx.query('delete from doctor_insurers where doctor_id = $1', [doctorId]);
    const insurers = input.insurerIds.filter((id) => validInsurers.has(id));
    if (insurers.length) {
      await tx.query('insert into doctor_insurers (doctor_id, insurer_id) select $1, unnest($2::smallint[]) on conflict do nothing', [doctorId, insurers]);
    }
  });
  return {};
}

export async function getOwnSelections(db: Queryable, doctorId: string): Promise<{ subspecialtyIds: number[]; insurerIds: number[] }> {
  const [subs, ins] = await Promise.all([
    db.query<{ id: number }>('select subspecialty_id as id from doctor_subspecialties where doctor_id = $1', [doctorId]),
    db.query<{ id: number }>('select insurer_id as id from doctor_insurers where doctor_id = $1', [doctorId]),
  ]);
  return { subspecialtyIds: subs.rows.map((r) => r.id), insurerIds: ins.rows.map((r) => r.id) };
}

