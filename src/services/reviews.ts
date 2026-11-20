import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import type { SessionUser } from '../auth/sessions.js';
import { hitRateLimit, LIMITS } from '../auth/rateLimit.js';
import { audit } from './audit.js';
import { DomainError, notFound, tooManyRequests } from '../http/errors.js';

export const MAX_REVIEW_COMMENT = 500;
export const MAX_HIDE_REASON = 200;

export interface RatingSummary {
  avg: number;
  count: number;
}

/** Average of visible reviews, rounded to one decimal, for several doctors in one query. */
export async function ratingsFor(db: Queryable, doctorIds: string[]): Promise<Map<string, RatingSummary>> {
  const out = new Map<string, RatingSummary>();
  if (!doctorIds.length) return out;
  const { rows } = await db.query<{ doctor_id: string; avg: string; count: number }>(
    `select doctor_id, round(avg(rating)::numeric, 1)::text as avg, count(*)::int as count
       from reviews where status = 'visible' and doctor_id = any($1::uuid[]) group by doctor_id`,
    [doctorIds],
  );
  for (const r of rows) out.set(r.doctor_id, { avg: Number(r.avg), count: r.count });
  return out;
}

export interface PublicReview {
  rating: number;
  comment: string | null;
  created_at: Date;
  /** First name and last initial only, e.g. "Nour H." — never the full name or phone. */
  author: string;
}

export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = parts[0]!;
  const lastInitial = parts.length > 1 ? [...parts[parts.length - 1]!][0] : undefined;
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

export async function listDoctorReviews(db: Queryable, doctorId: string, limit = 10): Promise<PublicReview[]> {
  const { rows } = await db.query<{ rating: number; comment: string | null; created_at: Date; full_name: string }>(
    `select r.rating, r.comment, r.created_at, u.full_name
       from reviews r join users u on u.id = r.patient_id
      where r.doctor_id = $1 and r.status = 'visible'
      order by r.created_at desc limit $2`,
    [doctorId, limit],
  );
  return rows.map((r) => ({ rating: r.rating, comment: r.comment, created_at: r.created_at, author: shortName(r.full_name) }));
}

export interface ReviewTarget {
  appointment_id: string;
  starts_at: Date;
  doctor_name: string;
  doctor_slug: string;
  clinic_name: string;
  rating: number | null;
  comment: string | null;
}

/** The patient's own completed appointment, with their existing review if any. */
export async function getReviewTarget(db: Queryable, patientId: string, appointmentId: string): Promise<ReviewTarget> {
  const { rows } = await db.query<ReviewTarget & { status: string }>(
    `select a.id as appointment_id, a.starts_at, a.status, u.full_name as doctor_name, d.slug as doctor_slug, c.name as clinic_name,
            r.rating, r.comment
       from appointments a join doctors d on d.user_id = a.doctor_id join users u on u.id = a.doctor_id
       join clinics c on c.id = a.clinic_id
       left join reviews r on r.appointment_id = a.id
      where a.id = $1 and a.patient_id = $2`,
    [appointmentId, patientId],
  );
  const t = rows[0];
  if (!t) throw notFound();
  if (t.status !== 'completed') throw new DomainError('review.onlyCompleted');
  return t;
}

export function parseRating(raw: string): number | null {
  if (!/^[1-5]$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

/** Create or update the review for one of the patient's completed visits. */
export async function submitReview(deps: Deps, patient: SessionUser, appointmentId: string, rating: number, rawComment: string, ip: string): Promise<void> {
  if (patient.role !== 'patient') throw notFound();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new DomainError('review.ratingRequired');
  const comment = rawComment.trim();
  if (comment.length > MAX_REVIEW_COMMENT) throw new DomainError('review.tooLong');
  if (!(await hitRateLimit(deps.db, `review:${patient.id}`, LIMITS.reviewPerUser.limit, LIMITS.reviewPerUser.window))) throw tooManyRequests();

  await deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string; doctor_id: string; status: string }>(
      'select id, doctor_id, status from appointments where id = $1 and patient_id = $2 for update',
      [appointmentId, patient.id],
    );
    const appt = rows[0];
    if (!appt) throw notFound(); // also hides other people's appointments
    if (appt.status !== 'completed') throw new DomainError('review.onlyCompleted');
    // A hidden review stays hidden when its author edits it.
    const saved = await tx.query<{ id: string; inserted: boolean }>(
      `insert into reviews (appointment_id, doctor_id, patient_id, rating, comment)
       values ($1, $2, $3, $4, $5)
       on conflict (appointment_id) do update set rating = excluded.rating, comment = excluded.comment, updated_at = now()
       returning id, (xmax = 0) as inserted`,
      [appt.id, appt.doctor_id, patient.id, rating, comment || null],
    );
    const row = saved.rows[0]!;
    await audit(tx, { actorId: patient.id, action: row.inserted ? 'review.create' : 'review.update', entityType: 'review', entityId: row.id, metadata: { rating }, ip });
  });
}

export interface AdminReview {
  id: string;
  rating: number;
  comment: string | null;
  status: 'visible' | 'hidden';
  hidden_reason: string | null;
  created_at: Date;
  doctor_name: string;
  doctor_slug: string;
  patient_name: string;
}

export async function listReviewsForAdmin(db: Queryable, limit = 100): Promise<AdminReview[]> {
  return (
    await db.query<AdminReview>(
      `select r.id, r.rating, r.comment, r.status, r.hidden_reason, r.created_at,
              du.full_name as doctor_name, d.slug as doctor_slug, pu.full_name as patient_name
         from reviews r join doctors d on d.user_id = r.doctor_id join users du on du.id = r.doctor_id
         join users pu on pu.id = r.patient_id
        order by r.created_at desc limit $1`,
      [limit],
    )
  ).rows;
}

export async function setReviewVisibility(deps: Deps, admin: SessionUser, reviewId: string, visible: boolean, rawReason: string, ip: string): Promise<void> {
  if (admin.role !== 'admin') throw notFound();
  const reason = rawReason.trim();
  if (!visible && !reason) throw new DomainError('review.hideReasonRequired');
  if (reason.length > MAX_HIDE_REASON) throw new DomainError('review.tooLong');
  await deps.db.transaction(async (tx) => {
    const { rowCount } = await tx.query(
      `update reviews set status = $2, hidden_reason = $3, updated_at = now() where id = $1`,
      [reviewId, visible ? 'visible' : 'hidden', visible ? null : reason],
    );
    if (!rowCount) throw notFound();
    await audit(tx, { actorId: admin.id, action: visible ? 'review.show' : 'review.hide', entityType: 'review', entityId: reviewId, ip });
  });
}
