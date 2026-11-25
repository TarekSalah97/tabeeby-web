import crypto from 'node:crypto';
import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import { isUniqueViolation } from '../db/db.js';
import type { Locale } from '../i18n/index.js';
import { translator } from '../i18n/index.js';
import { normalizeEgyptMobile, normalizeDigits } from '../domain/phone.js';
import { checkPasswordPolicy, hashPassword } from '../auth/password.js';
import { hitRateLimit, LIMITS } from '../auth/rateLimit.js';
import { destroyUserSessions } from '../auth/sessions.js';
import { isOpenAt, type OpeningHours } from '../domain/facilityHours.js';
import { labTest } from '../domain/clinical.js';
import { facilityDocs, type FacilityDocKind } from '../domain/documents.js';
import { checkDocuments, storeDocuments, removeDocuments, insertDocuments } from './documents.js';
import type { UploadedFile } from '../http/body.js';
import { audit } from './audit.js';
import { enqueueSms } from './outbox.js';
import { getReference } from './reference.js';
import { validateName, type FieldErrors } from './accounts.js';
import { DomainError, notFound, tooManyRequests } from '../http/errors.js';

export const FACILITY_KINDS = ['pharmacy', 'lab', 'radiology'] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];
export const isFacilityKind = (k: string): k is FacilityKind => (FACILITY_KINDS as readonly string[]).includes(k);
/** Kinds that offer tests from the built-in list with prices. */
export const offersTests = (k: FacilityKind): boolean => k === 'lab' || k === 'radiology';
/** Which built-in test groups each kind may price (scan centres do imaging; labs do the rest). */
export const testGroupsFor = (k: FacilityKind): string[] =>
  k === 'radiology' ? ['imaging', 'dental', 'cardiac'] : k === 'lab' ? ['blood', 'urine_stool', 'cardiac'] : [];

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_BRANCHES = 30;

/** Optional landline or mobile, stored as +20…; '' = none. */
function optionalPhone(raw: string): { value: string | null; ok: boolean } {
  if (!raw.trim()) return { value: null, ok: true };
  const digits = normalizeDigits(raw).replace(/[\s\-()]/g, '').replace(/^(\+20|0020|0)/, '');
  return /^\d{8,10}$/.test(digits) ? { value: `+20${digits}`, ok: true } : { value: null, ok: false };
}

function slugBase(name: string): string {
  const latin = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return latin.length >= 3 ? latin : 'place';
}

// ---------------------------------------------------------------------------
// Sign-up
// ---------------------------------------------------------------------------

export interface FacilitySignup {
  kind: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  password: string;
  licenceNumber: string;
  /** All uploaded sign-up documents (licence, manager's card and ID, ...). */
  files: UploadedFile[];
  consent: boolean;
  locale: Locale;
  ip: string;
}

export async function registerFacility(deps: Deps, input: FacilitySignup): Promise<{ userId: string } | { errors: FieldErrors }> {
  const { db, cfg, storage } = deps;
  const errors: FieldErrors = {};
  const phone = normalizeEgyptMobile(input.phone);
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim().replace(/\s+/g, ' ');
  const licence = normalizeDigits(input.licenceNumber).trim();
  if (!isFacilityKind(input.kind)) errors['kind'] = 'fac.kindInvalid';
  if (name.length < 2 || name.length > 120) errors['name'] = 'fac.nameInvalid';
  const nameErr = validateName(input.contactName);
  if (nameErr) errors['contactName'] = nameErr;
  if (!phone) errors['phone'] = 'phone.invalid';
  if (!EMAIL_RE.test(email)) errors['email'] = 'email.invalid';
  const pwErr = checkPasswordPolicy(input.password, [input.contactName, name, email.split('@')[0] ?? '']);
  if (pwErr) errors['password'] = pwErr;
  if (licence.length < 3 || licence.length > 40) errors['licenceNumber'] = 'fac.licenceInvalid';
  const docs = checkDocuments(cfg, facilityDocs(input.kind), input.files, errors);
  if (!input.consent) errors['consent'] = 'auth.consentRequired';
  if (Object.keys(errors).length || !phone || !isFacilityKind(input.kind)) return { errors };
  const kind = input.kind;

  if (!(await hitRateLimit(db, `signup:ip:${input.ip}`, LIMITS.signupPerIp.limit, LIMITS.signupPerIp.window))) throw tooManyRequests();
  const passwordHash = await hashPassword(input.password);
  const keys = await storeDocuments(storage, docs);
  try {
    const userId = await db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into users (role, full_name, phone_e164, email, password_hash, preferred_locale)
         values ('facility', $1, $2, $3, $4, $5) returning id`,
        [input.contactName.trim().replace(/\s+/g, ' '), phone, email, passwordHash, input.locale],
      );
      const id = rows[0]!.id;
      const slug = `${slugBase(name)}-${crypto.randomBytes(3).toString('hex')}`;
      await tx.query(
        `insert into facilities (user_id, kind, slug, name, licence_number, phone_e164) values ($1, $2, $3, $4, $5, $6)`,
        [id, kind, slug, name, licence, phone],
      );
      await insertDocuments(tx, 'facility_documents', id, docs, keys);
      await audit(tx, { actorId: id, action: 'facility.signup', entityType: 'facility', entityId: id, metadata: { kind }, ip: input.ip });
      return id;
    });
    return { userId };
  } catch (e) {
    await removeDocuments(storage, keys);
    if (isUniqueViolation(e, 'users_phone_e164_key')) return { errors: { phone: 'auth.phoneTaken' } };
    if (isUniqueViolation(e, 'users_email_key')) return { errors: { email: 'join.emailTaken' } };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// The facility's own profile, branches and prices
// ---------------------------------------------------------------------------

export interface OwnFacility {
  user_id: string;
  kind: FacilityKind;
  slug: string;
  name: string;
  description: string;
  licence_number: string;
  phone_e164: string | null;
  whatsapp_e164: string | null;
  home_service: boolean;
  verification_status: 'pending' | 'approved' | 'rejected' | 'suspended';
  verification_note: string | null;
  contact_name: string;
}

export async function getOwnFacility(db: Queryable, userId: string): Promise<OwnFacility> {
  const { rows } = await db.query<OwnFacility>(
    `select f.user_id, f.kind, f.slug, f.name, f.description, f.licence_number, f.phone_e164, f.whatsapp_e164, f.home_service,
            f.verification_status, f.verification_note, u.full_name as contact_name
       from facilities f join users u on u.id = f.user_id where f.user_id = $1`,
    [userId],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

export interface FacilityProfileInput {
  name: string;
  description: string;
  phone: string;
  whatsapp: string;
  homeService: boolean;
}

export async function updateFacilityProfile(deps: Deps, userId: string, input: FacilityProfileInput, ip: string): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  const name = input.name.trim().replace(/\s+/g, ' ');
  const description = input.description.trim();
  if (name.length < 2 || name.length > 120) errors['name'] = 'fac.nameInvalid';
  if (description.length > 1000) errors['description'] = 'fac.descriptionTooLong';
  const phone = optionalPhone(input.phone);
  const whatsapp = optionalPhone(input.whatsapp);
  if (!phone.ok) errors['phone'] = 'phone.invalid';
  if (!whatsapp.ok) errors['whatsapp'] = 'phone.invalid';
  if (Object.keys(errors).length) return errors;
  await deps.db.transaction(async (tx) => {
    await tx.query(
      `update facilities set name = $2, description = $3, phone_e164 = $4, whatsapp_e164 = $5, home_service = $6, updated_at = now() where user_id = $1`,
      [userId, name, description, phone.value, whatsapp.value, input.homeService],
    );
    await audit(tx, { actorId: userId, action: 'facility.profile', entityType: 'facility', entityId: userId, ip });
  });
  return {};
}

export interface BranchRow {
  id: string;
  name: string;
  district_id: number;
  address: string;
  phone_e164: string | null;
  open_24h: boolean;
  open_days: number[];
  opens: string;
  closes: string;
  is_active: boolean;
}

const BRANCH_COLUMNS = `b.id, b.name, b.district_id, b.address, b.phone_e164, b.open_24h, b.open_days,
  to_char(b.opens, 'HH24:MI') as opens, to_char(b.closes, 'HH24:MI') as closes, b.is_active`;

export async function listOwnBranches(db: Queryable, facilityId: string): Promise<BranchRow[]> {
  return (await db.query<BranchRow>(`select ${BRANCH_COLUMNS} from facility_branches b where b.facility_id = $1 order by b.created_at`, [facilityId])).rows;
}

export interface BranchInput {
  name: string;
  districtId: number;
  address: string;
  phone: string;
  open24h: boolean;
  days: string[];
  opens: string;
  closes: string;
  isActive: boolean;
}

export async function saveBranch(deps: Deps, facilityId: string, branchId: string | null, input: BranchInput, ip: string): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  const ref = await getReference(deps.db);
  const name = input.name.trim();
  const address = input.address.trim();
  if (name.length < 2 || name.length > 120) errors['name'] = 'fac.branchNameInvalid';
  if (!ref.districtById.has(input.districtId)) errors['district'] = 'clinics.districtInvalid';
  if (address.length < 5 || address.length > 300) errors['address'] = 'clinics.addressInvalid';
  const phone = optionalPhone(input.phone);
  if (!phone.ok) errors['phone'] = 'phone.invalid';
  const days = [...new Set(input.days.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (!days.length) errors['days'] = 'msgset.daysRequired';
  const opens = normalizeDigits(input.opens).trim();
  const closes = normalizeDigits(input.closes).trim();
  if (!input.open24h) {
    if (!TIME_RE.test(opens)) errors['opens'] = 'msgset.timeInvalid';
    if (!TIME_RE.test(closes)) errors['closes'] = 'msgset.timeInvalid';
    else if (opens === closes) errors['closes'] = 'fac.sameTimes';
  }
  if (Object.keys(errors).length) return errors;
  const values = [facilityId, name, input.districtId, address, phone.value, input.open24h, days,
    input.open24h ? '00:00' : opens, input.open24h ? '23:59' : closes, input.isActive];
  await deps.db.transaction(async (tx) => {
    if (branchId) {
      const r = await tx.query(
        `update facility_branches set name = $2, district_id = $3, address = $4, phone_e164 = $5, open_24h = $6, open_days = $7::smallint[],
                opens = $8::time, closes = $9::time, is_active = $10, updated_at = now()
          where id = $11 and facility_id = $1`,
        [...values, branchId],
      );
      if (r.rowCount === 0) throw notFound();
    } else {
      const count = await tx.query<{ n: number }>('select count(*)::int as n from facility_branches where facility_id = $1', [facilityId]);
      if ((count.rows[0]?.n ?? 0) >= MAX_BRANCHES) throw new DomainError('fac.tooManyBranches');
      await tx.query(
        `insert into facility_branches (facility_id, name, district_id, address, phone_e164, open_24h, open_days, opens, closes, is_active)
         values ($1, $2, $3, $4, $5, $6, $7::smallint[], $8::time, $9::time, $10)`,
        values,
      );
    }
    await audit(tx, { actorId: facilityId, action: branchId ? 'facility.branch_update' : 'facility.branch_add', entityType: 'facility', entityId: facilityId, ip });
  });
  return {};
}

export async function deleteBranch(deps: Deps, facilityId: string, branchId: string, ip: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const r = await tx.query('delete from facility_branches where id = $1 and facility_id = $2', [branchId, facilityId]);
    if (r.rowCount === 0) throw notFound();
    await audit(tx, { actorId: facilityId, action: 'facility.branch_delete', entityType: 'facility', entityId: facilityId, ip });
  });
}

export async function listOwnTests(db: Queryable, facilityId: string): Promise<Map<string, number>> {
  const { rows } = await db.query<{ test_code: string; price_egp: number }>('select test_code, price_egp from facility_tests where facility_id = $1', [facilityId]);
  return new Map(rows.map((r) => [r.test_code, r.price_egp]));
}

/**
 * Replace the whole price list from the form: a price means "we do this test", empty means not offered.
 * Only codes from the built-in list for this kind of place are accepted.
 */
export async function saveTestPrices(deps: Deps, facility: Pick<OwnFacility, 'user_id' | 'kind'>, prices: Record<string, string>, ip: string): Promise<FieldErrors> {
  if (!offersTests(facility.kind)) throw notFound();
  const groups = testGroupsFor(facility.kind);
  const errors: FieldErrors = {};
  const clean: [string, number][] = [];
  for (const [code, raw] of Object.entries(prices)) {
    const test = labTest(code);
    if (!test || !groups.includes(test.group)) continue;
    const digits = normalizeDigits(raw).replace(/[,\s]/g, '');
    if (!digits) continue;
    const n = /^\d{1,6}$/.test(digits) ? Number(digits) : NaN;
    if (!Number.isInteger(n) || n < 0 || n > 100000) errors[`price_${code}`] = 'clinics.feeInvalid';
    else clean.push([code, n]);
  }
  if (Object.keys(errors).length) return errors;
  await deps.db.transaction(async (tx) => {
    await tx.query('delete from facility_tests where facility_id = $1', [facility.user_id]);
    if (clean.length) {
      await tx.query(
        `insert into facility_tests (facility_id, test_code, price_egp) select $1, unnest($2::text[]), unnest($3::int[])`,
        [facility.user_id, clean.map((c) => c[0]), clean.map((c) => c[1])],
      );
    }
    await audit(tx, { actorId: facility.user_id, action: 'facility.prices', entityType: 'facility', entityId: facility.user_id, metadata: { tests: clean.length }, ip });
  });
  return {};
}

/** Tests a lab or scan centre adds itself, beyond the built-in list. */
export interface ExtraTest {
  id: string;
  name: string;
  price_egp: number;
  note: string | null;
}
export const MAX_EXTRA_TESTS = 200;

export async function listExtraTests(db: Queryable, facilityId: string): Promise<ExtraTest[]> {
  return (
    await db.query<ExtraTest>('select id, name, price_egp, note from facility_extra_tests where facility_id = $1 order by lower(name)', [facilityId])
  ).rows;
}

/** Adds one test (name + price, optional note such as "results in 3 days"). Returns field errors. */
export async function addExtraTest(
  deps: Deps,
  facility: Pick<OwnFacility, 'user_id' | 'kind'>,
  input: { name: string; price: string; note: string },
  ip: string,
): Promise<FieldErrors> {
  if (!offersTests(facility.kind)) throw notFound();
  const errors: FieldErrors = {};
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) errors['extraName'] = 'extra.nameInvalid';
  const digits = normalizeDigits(input.price).replace(/[,\s]/g, '');
  const price = /^\d{1,6}$/.test(digits) ? Number(digits) : NaN;
  if (!Number.isInteger(price) || price > 100000) errors['extraPrice'] = 'clinics.feeInvalid';
  const note = input.note.trim().replace(/\s+/g, ' ').slice(0, 200);
  if (Object.keys(errors).length) return errors;
  try {
    await deps.db.transaction(async (tx) => {
      await tx.query('select 1 from facilities where user_id = $1 for update', [facility.user_id]);
      const n = await tx.query<{ n: number }>('select count(*)::int as n from facility_extra_tests where facility_id = $1', [facility.user_id]);
      if ((n.rows[0]?.n ?? 0) >= MAX_EXTRA_TESTS) throw new DomainError('extra.tooMany');
      await tx.query('insert into facility_extra_tests (facility_id, name, price_egp, note) values ($1, $2, $3, $4)', [facility.user_id, name, price, note || null]);
      await audit(tx, { actorId: facility.user_id, action: 'facility.extra_test_add', entityType: 'facility', entityId: facility.user_id, ip });
    });
  } catch (e) {
    if (isUniqueViolation(e, 'facility_extra_tests_name_idx')) return { extraName: 'extra.duplicate' };
    if (e instanceof DomainError) return { extraName: e.messageKey as FieldErrors[string] };
    throw e;
  }
  return {};
}

/** Changes the price (and note) of one of the place's own added tests. */
export async function updateExtraTest(deps: Deps, facilityId: string, id: string, input: { price: string; note: string }, ip: string): Promise<boolean> {
  const digits = normalizeDigits(input.price).replace(/[,\s]/g, '');
  if (!/^\d{1,6}$/.test(digits) || Number(digits) > 100000) return false;
  await deps.db.transaction(async (tx) => {
    const r = await tx.query('update facility_extra_tests set price_egp = $3, note = $4 where id = $1 and facility_id = $2', [
      id, facilityId, Number(digits), input.note.trim().replace(/\s+/g, ' ').slice(0, 200) || null,
    ]);
    if (!r.rowCount) throw notFound();
    await audit(tx, { actorId: facilityId, action: 'facility.extra_test_update', entityType: 'facility', entityId: facilityId, ip });
  });
  return true;
}

export async function deleteExtraTest(deps: Deps, facilityId: string, id: string, ip: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const r = await tx.query('delete from facility_extra_tests where id = $1 and facility_id = $2', [id, facilityId]);
    if (!r.rowCount) throw notFound();
    await audit(tx, { actorId: facilityId, action: 'facility.extra_test_delete', entityType: 'facility', entityId: facilityId, ip });
  });
}

// ---------------------------------------------------------------------------
// Public listing and profile
// ---------------------------------------------------------------------------

export const hoursOf = (b: Pick<BranchRow, 'open_24h' | 'open_days' | 'opens' | 'closes'>): OpeningHours => ({
  open24h: b.open_24h,
  days: b.open_days,
  opens: b.opens,
  closes: b.closes,
});

export interface PublicBranch extends BranchRow {
  openNow: boolean;
}

export interface PublicFacility {
  id: string;
  kind: FacilityKind;
  slug: string;
  name: string;
  description: string;
  phone: string | null;
  whatsapp: string | null;
  homeService: boolean;
  branches: PublicBranch[];
  openNow: boolean;
  /** For a test search: the total price of the asked tests at this place. */
  total: number | null;
  tests: { code: string; price: number }[];
  /** Tests the place added itself (name, price, note). */
  extraTests: ExtraTest[];
}

export interface FacilitySearch {
  kind: FacilityKind;
  districtId: number | null;
  openNow: boolean;
  homeService: boolean;
  /** Only places that do every one of these tests. */
  tests: string[];
  q: string;
}

export async function searchFacilities(deps: Deps, s: FacilitySearch): Promise<PublicFacility[]> {
  const db = deps.db;
  const like = s.q.trim() ? `%${s.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const { rows } = await db.query<{ user_id: string }>(
    `select f.user_id from facilities f join users u on u.id = f.user_id
      where f.kind = $1 and f.verification_status = 'approved' and u.status = 'active'
        and ($2::int is null or exists (select 1 from facility_branches b where b.facility_id = f.user_id and b.is_active and b.district_id = $2))
        and (not $3 or f.home_service)
        and (cardinality($4::text[]) = 0 or (select count(*) from facility_tests t where t.facility_id = f.user_id and t.test_code = any($4::text[])) = cardinality($4::text[]))
        and ($5::text is null or f.name ilike $5)
        and exists (select 1 from facility_branches b where b.facility_id = f.user_id and b.is_active)
      order by f.verified_at desc nulls last limit 100`,
    [s.kind, s.districtId, s.homeService, s.tests, like],
  );
  let list = await loadPublic(deps, rows.map((r) => r.user_id), s.tests);
  if (s.openNow) list = list.filter((f) => f.openNow);
  if (s.tests.length) list.sort((a, b) => (a.total ?? 0) - (b.total ?? 0));
  else list.sort((a, b) => Number(b.openNow) - Number(a.openNow));
  return list;
}

async function loadPublic(deps: Deps, ids: string[], askedTests: string[] = []): Promise<PublicFacility[]> {
  if (!ids.length) return [];
  const db = deps.db;
  const [facilities, branches, tests, extras] = await Promise.all([
    db.query<{ user_id: string; kind: FacilityKind; slug: string; name: string; description: string; phone_e164: string | null; whatsapp_e164: string | null; home_service: boolean }>(
      `select user_id, kind, slug, name, description, phone_e164, whatsapp_e164, home_service from facilities where user_id = any($1::uuid[])`,
      [ids],
    ),
    db.query<BranchRow & { facility_id: string }>(
      `select b.facility_id, ${BRANCH_COLUMNS} from facility_branches b where b.facility_id = any($1::uuid[]) and b.is_active order by b.created_at`,
      [ids],
    ),
    db.query<{ facility_id: string; test_code: string; price_egp: number }>(
      'select facility_id, test_code, price_egp from facility_tests where facility_id = any($1::uuid[])',
      [ids],
    ),
    db.query<ExtraTest & { facility_id: string }>(
      'select facility_id, id, name, price_egp, note from facility_extra_tests where facility_id = any($1::uuid[]) order by lower(name)',
      [ids],
    ),
  ]);
  const now = deps.now();
  const tz = deps.cfg.TIME_ZONE;
  const byId = new Map(facilities.rows.map((f) => [f.user_id, f]));
  return ids
    .map((id) => byId.get(id))
    .filter((f): f is NonNullable<typeof f> => !!f)
    .map((f) => {
      const own = branches.rows.filter((b) => b.facility_id === f.user_id).map((b) => ({ ...b, openNow: isOpenAt(hoursOf(b), now, tz) }));
      const ownTests = tests.rows.filter((t) => t.facility_id === f.user_id).map((t) => ({ code: t.test_code, price: t.price_egp }));
      const asked = ownTests.filter((t) => askedTests.includes(t.code));
      return {
        id: f.user_id,
        kind: f.kind,
        slug: f.slug,
        name: f.name,
        description: f.description,
        phone: f.phone_e164,
        whatsapp: f.whatsapp_e164,
        homeService: f.home_service,
        branches: own,
        openNow: own.some((b) => b.openNow),
        total: askedTests.length ? asked.reduce((sum, t) => sum + t.price, 0) : null,
        tests: ownTests,
        extraTests: extras.rows.filter((x) => x.facility_id === f.user_id).map(({ facility_id: _f, ...x }) => x),
      };
    });
}

/** Approved places only; a pending place can preview its own page. */
export async function getPublicFacility(deps: Deps, slug: string, viewerId: string | null): Promise<PublicFacility & { approved: boolean }> {
  const { rows } = await deps.db.query<{ user_id: string; verification_status: string; status: string }>(
    `select f.user_id, f.verification_status, u.status from facilities f join users u on u.id = f.user_id where f.slug = $1`,
    [slug],
  );
  const f = rows[0];
  const approved = !!f && f.verification_status === 'approved' && f.status === 'active';
  if (!f || (!approved && f.user_id !== viewerId)) throw notFound();
  const [p] = await loadPublic(deps, [f.user_id]);
  return { ...p!, approved };
}

// ---------------------------------------------------------------------------
// Admin review
// ---------------------------------------------------------------------------

export interface FacilityReviewItem {
  user_id: string;
  kind: FacilityKind;
  name: string;
  contact_name: string;
  verification_status: string;
  created_at: Date;
}

export async function listFacilitiesForReview(db: Queryable): Promise<{ pending: FacilityReviewItem[]; recent: FacilityReviewItem[] }> {
  const base = `select f.user_id, f.kind, f.name, u.full_name as contact_name, f.verification_status, f.created_at
                  from facilities f join users u on u.id = f.user_id`;
  const [pending, recent] = await Promise.all([
    db.query<FacilityReviewItem>(`${base} where f.verification_status = 'pending' order by f.created_at limit 200`),
    db.query<FacilityReviewItem>(`${base} where f.verification_status <> 'pending' order by f.updated_at desc limit 30`),
  ]);
  return { pending: pending.rows, recent: recent.rows };
}

export interface FacilityReviewDetail extends FacilityReviewItem {
  slug: string;
  licence_number: string;
  phone_e164: string;
  email: string | null;
  verification_note: string | null;
  documents: { id: string; kind: FacilityDocKind; mime_type: string; size_bytes: number; uploaded_at: Date }[];
  branches: BranchRow[];
}

export async function getFacilityForReview(db: Queryable, id: string): Promise<FacilityReviewDetail> {
  const { rows } = await db.query<Omit<FacilityReviewDetail, 'documents' | 'branches'>>(
    `select f.user_id, f.kind, f.name, u.full_name as contact_name, f.verification_status, f.created_at, f.slug, f.licence_number,
            u.phone_e164, u.email, f.verification_note
       from facilities f join users u on u.id = f.user_id where f.user_id = $1`,
    [id],
  );
  if (!rows[0]) throw notFound();
  const [docs, branches] = await Promise.all([
    db.query<FacilityReviewDetail['documents'][number]>('select id, kind, mime_type, size_bytes, uploaded_at from facility_documents where facility_id = $1 order by uploaded_at', [id]),
    listOwnBranches(db, id),
  ]);
  return { ...rows[0], documents: docs.rows, branches };
}

export type FacilityDecision = 'approve' | 'reject' | 'suspend' | 'reinstate';
const NEXT: Record<FacilityDecision, { from: string[]; to: string }> = {
  approve: { from: ['pending', 'rejected'], to: 'approved' },
  reject: { from: ['pending'], to: 'rejected' },
  suspend: { from: ['approved', 'pending'], to: 'suspended' },
  reinstate: { from: ['suspended'], to: 'approved' },
};
export const isFacilityDecision = (d: string): d is FacilityDecision => d in NEXT;

export async function decideFacility(deps: Deps, adminId: string, id: string, decision: FacilityDecision, note: string, ip: string): Promise<void> {
  const rule = NEXT[decision];
  if ((decision === 'reject' || decision === 'suspend') && note.trim().length < 3) throw new DomainError('admin.noteRequired');
  await deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ verification_status: string; phone_e164: string; preferred_locale: Locale }>(
      `select f.verification_status, u.phone_e164, u.preferred_locale from facilities f join users u on u.id = f.user_id where f.user_id = $1 for update of f`,
      [id],
    );
    const f = rows[0];
    if (!f) throw notFound();
    if (!rule.from.includes(f.verification_status)) throw new DomainError('appt.notAllowed');
    await tx.query(
      `update facilities set verification_status = $2, verification_note = $3, updated_at = now(),
              verified_at = case when $2 = 'approved' then now() else verified_at end where user_id = $1`,
      [id, rule.to, note.trim().slice(0, 500) || null],
    );
    const t = translator(f.preferred_locale);
    if (decision === 'approve') await enqueueSms(tx, f.phone_e164, t('sms.facilityApproved'));
    if (decision === 'reject') await enqueueSms(tx, f.phone_e164, t('sms.facilityRejected'));
    if (decision === 'suspend') await destroyUserSessions(tx, id);
    await audit(tx, { actorId: adminId, action: `facility.${decision}`, entityType: 'facility', entityId: id, metadata: { from: f.verification_status }, ip });
  });
}

export async function readFacilityDocument(deps: Deps, adminId: string, documentId: string, ip: string): Promise<{ data: Buffer; mime: string }> {
  const { rows } = await deps.db.query<{ storage_key: string; mime_type: string; facility_id: string }>(
    'select storage_key, mime_type, facility_id from facility_documents where id = $1',
    [documentId],
  );
  const doc = rows[0];
  if (!doc) throw notFound();
  await audit(deps.db, { actorId: adminId, action: 'document.view', entityType: 'facility_document', entityId: documentId, metadata: { facilityId: doc.facility_id }, ip });
  return { data: await deps.storage.get(doc.storage_key), mime: doc.mime_type };
}
