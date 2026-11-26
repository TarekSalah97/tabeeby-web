import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import type { Slot } from '../domain/availability.js';
import { experienceYears } from '../domain/experience.js';
import { getReference } from './reference.js';
import { slotsForDoctors } from './availability.js';
import { pausedDoctors } from './reliability.js';
import { listPositions, toRanges } from './doctors.js';
import { ratingsFor, type RatingSummary } from './reviews.js';

export interface SearchFilters {
  q: string;
  specialtyId: number | null;
  subspecialtyId: number | null;
  districtId: number | null;
  /** A whole governorate (city); ignored when a district is chosen. */
  governorateId: number | null;
  insurerId: number | null;
  page: number;
}

export interface DoctorCard {
  id: string;
  slug: string;
  fullName: string;
  titleEn: string;
  titleAr: string;
  specialtyId: number;
  subspecialtyIds: number[];
  years: number;
  minFee: number | null;
  clinics: { id: string; name: string; districtId: number; address: string; fee: number | null; followUpFee: number | null; followUpDays: number; phone: string | null }[];
  nextSlots: Slot[];
  /** Average of verified reviews; null until the doctor has one. */
  rating: RatingSummary | null;
  /** Changes when the photo changes (cache-busting); null = no photo, show initials. */
  photoVersion: number | null;
}

export const PAGE_SIZE = 10;
const CANDIDATE_LIMIT = 200;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

/**
 * Text query matches the doctor's name, specialty / subspecialty names (both
 * languages), or a plain-language condition mapped to a specialty.
 */
export async function searchDoctors(deps: Deps, f: SearchFilters): Promise<{ cards: DoctorCard[]; total: number; pages: number }> {
  const { db, cfg } = deps;
  const ref = await getReference(db);
  const q = f.q.trim().slice(0, 80);
  const like = q ? `%${escapeLike(q)}%` : null;

  // Conditions are matched in code (small list) and turned into specialty filters.
  const lowered = q.toLowerCase();
  const conditionHits = q
    ? ref.conditions.filter(
        (c) => lowered.includes(c.term_en.toLowerCase()) || q.includes(c.term_ar) || (q.length >= 3 && (c.term_en.includes(lowered) || c.term_ar.includes(q))),
      )
    : [];

  const { rows } = await db.query<{ user_id: string }>(
    `select d.user_id
       from doctors d join users u on u.id = d.user_id
      where d.verification_status = 'approved' and u.status = 'active'
        and exists (select 1 from clinics c where c.doctor_id = d.user_id and c.is_active
                      and ($3::int is null or c.district_id = $3)
                      and ($8::int is null or c.district_id in (select id from districts where governorate_id = $8)))
        and ($1::smallint is null or d.specialty_id = $1)
        and ($2::int is null or exists (select 1 from doctor_subspecialties ds where ds.doctor_id = d.user_id and ds.subspecialty_id = $2))
        and ($4::smallint is null or exists (select 1 from doctor_insurers di where di.doctor_id = d.user_id and di.insurer_id = $4))
        and ($5::text is null
             or u.full_name ilike $5
             or exists (select 1 from specialties s where s.id = d.specialty_id and (s.name_en ilike $5 or s.name_ar ilike $5))
             or exists (select 1 from doctor_subspecialties ds join subspecialties ss on ss.id = ds.subspecialty_id
                         where ds.doctor_id = d.user_id and (ss.name_en ilike $5 or ss.name_ar ilike $5))
             or d.specialty_id = any($6::smallint[])
             or exists (select 1 from doctor_subspecialties ds where ds.doctor_id = d.user_id and ds.subspecialty_id = any($7::int[])))
      limit ${CANDIDATE_LIMIT}`,
    [
      f.specialtyId,
      f.subspecialtyId,
      f.districtId,
      f.insurerId,
      like,
      conditionHits.filter((c) => c.subspecialty_id === null).map((c) => c.specialty_id),
      conditionHits.filter((c) => c.subspecialty_id !== null).map((c) => c.subspecialty_id),
      f.districtId ? null : f.governorateId,
    ],
  );
  const ids = rows.map((r) => r.user_id);
  if (!ids.length) return { cards: [], total: 0, pages: 0 };

  const now = deps.now();
  const [slots, paused] = await Promise.all([slotsForDoctors(db, cfg, ids, { days: 7, now }), pausedDoctors(db, cfg, ids)]);
  // Doctors paused for too many cancellations stay listed (patients can still call) but offer no online times.
  for (const id of paused) slots.set(id, []);
  // Sort all candidates by soonest availability, then paginate.
  const order = ids
    .map((id) => ({ id, first: slots.get(id)?.[0]?.startsAt.getTime() ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.first - b.first || a.id.localeCompare(b.id));
  const pages = Math.ceil(order.length / PAGE_SIZE);
  const page = Math.min(Math.max(1, f.page), Math.max(1, pages));
  const pageIds = order.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((o) => o.id);

  const cards = await loadCards(db, pageIds, now);
  for (const c of cards) {
    const own = slots.get(c.id) ?? [];
    // Only times at clinics in the chosen place.
    const inPlace = (districtId: number | undefined) =>
      f.districtId ? districtId === f.districtId : f.governorateId ? !!districtId && ref.districtById.get(districtId)?.governorate_id === f.governorateId : true;
    c.nextSlots = own.filter((s) => inPlace(c.clinics.find((cl) => cl.id === s.clinicId)?.districtId)).slice(0, 3);
  }
  return { cards, total: order.length, pages };
}

export async function loadCards(db: Queryable, ids: string[], now: Date): Promise<DoctorCard[]> {
  if (!ids.length) return [];
  const [docs, clinics, subs, positions, ratings] = await Promise.all([
    db.query<{ user_id: string; slug: string; full_name: string; title_en: string; title_ar: string; specialty_id: number; photo_updated_at: Date | null }>(
      `select d.user_id, d.slug, u.full_name, d.title_en, d.title_ar, d.specialty_id, case when d.photo_key is not null then d.photo_updated_at end as photo_updated_at
         from doctors d join users u on u.id = d.user_id where d.user_id = any($1::uuid[])`,
      [ids],
    ),
    db.query<{ id: string; doctor_id: string; name: string; district_id: number; address: string; fee_egp: number | null; follow_up_fee_egp: number | null; follow_up_days: number; phone_e164: string | null }>(
      `select id, doctor_id, name, district_id, address, fee_egp, follow_up_fee_egp, follow_up_days, phone_e164 from clinics where doctor_id = any($1::uuid[]) and is_active order by created_at`,
      [ids],
    ),
    db.query<{ doctor_id: string; subspecialty_id: number }>('select doctor_id, subspecialty_id from doctor_subspecialties where doctor_id = any($1::uuid[])', [ids]),
    listPositions(db, ids),
    ratingsFor(db, ids),
  ]);
  const byId = new Map(docs.rows.map((d) => [d.user_id, d]));
  return ids
    .map((id) => byId.get(id))
    .filter((d): d is NonNullable<typeof d> => !!d)
    .map((d) => {
      const own = clinics.rows.filter((c) => c.doctor_id === d.user_id);
      return {
        id: d.user_id,
        slug: d.slug,
        fullName: d.full_name,
        titleEn: d.title_en,
        titleAr: d.title_ar,
        specialtyId: d.specialty_id,
        subspecialtyIds: subs.rows.filter((s) => s.doctor_id === d.user_id).map((s) => s.subspecialty_id),
        years: experienceYears(toRanges(positions.get(d.user_id) ?? []), now),
        minFee: own.some((c) => c.fee_egp !== null) ? Math.min(...own.flatMap((c) => (c.fee_egp === null ? [] : [c.fee_egp]))) : null,
        clinics: own.map((c) => ({ id: c.id, name: c.name, districtId: c.district_id, address: c.address, fee: c.fee_egp, followUpFee: c.follow_up_fee_egp, followUpDays: c.follow_up_days, phone: c.phone_e164 })),
        nextSlots: [],
        rating: ratings.get(d.user_id) ?? null,
        photoVersion: d.photo_updated_at ? d.photo_updated_at.getTime() : null,
      };
    });
}

export interface PublicProfile extends DoctorCard {
  bio: string;
  social: { facebook: string | null; instagram: string | null; tiktok: string | null };
  graduationYear: number;
  languages: string[];
  insurerIds: number[];
  positions: { title: string; workplace: string; start: string; end: string | null }[];
  rules: { clinicId: string; weekday: number; start: string; end: string }[];
}

/** Only approved, active doctors have a public page. */
export async function getPublicProfile(db: Queryable, slug: string, now: Date): Promise<PublicProfile | null> {
  const { rows } = await db.query<{ user_id: string; bio: string; graduation_year: number; languages: string[]; facebook_url: string | null; instagram_url: string | null; tiktok_url: string | null }>(
    `select d.user_id, d.bio, d.graduation_year, d.languages, d.facebook_url, d.instagram_url, d.tiktok_url
       from doctors d join users u on u.id = d.user_id
      where d.slug = $1 and d.verification_status = 'approved' and u.status = 'active'`,
    [slug],
  );
  const d = rows[0];
  if (!d) return null;
  const [card] = await loadCards(db, [d.user_id], now);
  if (!card) return null;
  const [insurers, positions, rules] = await Promise.all([
    db.query<{ insurer_id: number }>('select insurer_id from doctor_insurers where doctor_id = $1', [d.user_id]),
    listPositions(db, [d.user_id]),
    db.query<{ clinic_id: string; weekday: number; start: string; end: string }>(
      `select r.clinic_id, r.weekday, to_char(r.start_time, 'HH24:MI') as start, to_char(r.end_time, 'HH24:MI') as "end"
         from schedule_rules r join clinics c on c.id = r.clinic_id where c.doctor_id = $1 and c.is_active order by r.weekday, r.start_time`,
      [d.user_id],
    ),
  ]);
  return {
    ...card,
    bio: d.bio,
    social: { facebook: d.facebook_url, instagram: d.instagram_url, tiktok: d.tiktok_url },
    graduationYear: d.graduation_year,
    languages: d.languages,
    insurerIds: insurers.rows.map((r) => r.insurer_id),
    positions: positions.get(d.user_id) ?? [],
    rules: rules.rows.map((r) => ({ clinicId: r.clinic_id, weekday: r.weekday, start: r.start, end: r.end })),
  };
}
