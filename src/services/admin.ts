import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import { audit } from './audit.js';
import { enqueueSms } from './outbox.js';
import { translator, type Locale } from '../i18n/index.js';
import { destroyUserSessions } from '../auth/sessions.js';
import { DomainError, notFound } from '../http/errors.js';

export interface ReviewListItem {
  user_id: string;
  full_name: string;
  specialty_id: number;
  kind: string;
  verification_status: string;
  created_at: Date;
  verified_at: Date | null;
}

export async function listForReview(db: Queryable): Promise<{ pending: ReviewListItem[]; recent: ReviewListItem[] }> {
  const base = `select d.user_id, u.full_name, d.specialty_id, d.kind, d.verification_status, d.created_at, d.verified_at
                  from doctors d join users u on u.id = d.user_id`;
  const [pending, recent] = await Promise.all([
    db.query<ReviewListItem>(`${base} where d.verification_status = 'pending' order by d.created_at limit 200`),
    db.query<ReviewListItem>(`${base} where d.verification_status <> 'pending' order by d.updated_at desc limit 30`),
  ]);
  return { pending: pending.rows, recent: recent.rows };
}

export interface ReviewDetail extends ReviewListItem {
  phone_e164: string;
  email: string | null;
  graduation_year: number;
  verification_note: string | null;
  phone_verified_at: Date | null;
  documents: { id: string; mime_type: string; size_bytes: number; uploaded_at: Date }[];
  positions: { title: string; workplace: string; start: string; end: string | null }[];
  subspecialtyIds: number[];
}

export async function getForReview(db: Queryable, doctorId: string): Promise<ReviewDetail> {
  const { rows } = await db.query<Omit<ReviewDetail, 'documents' | 'positions' | 'subspecialtyIds'>>(
    `select d.user_id, u.full_name, d.specialty_id, d.kind, d.verification_status, d.created_at, d.verified_at,
            u.phone_e164, u.email, d.graduation_year, d.verification_note, u.phone_verified_at
       from doctors d join users u on u.id = d.user_id where d.user_id = $1`,
    [doctorId],
  );
  const d = rows[0];
  if (!d) throw notFound();
  const [docs, positions, subs] = await Promise.all([
    db.query<ReviewDetail['documents'][number]>(
      'select id, mime_type, size_bytes, uploaded_at from verification_documents where doctor_id = $1 order by uploaded_at desc',
      [doctorId],
    ),
    db.query<ReviewDetail['positions'][number]>(
      `select title, workplace, to_char(start_month, 'YYYY-MM') as start, to_char(end_month, 'YYYY-MM') as "end"
         from doctor_positions where doctor_id = $1 order by start_month desc`,
      [doctorId],
    ),
    db.query<{ id: number }>('select subspecialty_id as id from doctor_subspecialties where doctor_id = $1', [doctorId]),
  ]);
  return { ...d, documents: docs.rows, positions: positions.rows, subspecialtyIds: subs.rows.map((r) => r.id) };
}

export type Decision = 'approve' | 'reject' | 'suspend' | 'reinstate';

const NEXT: Record<Decision, { from: string[]; to: string }> = {
  approve: { from: ['pending', 'rejected'], to: 'approved' },
  reject: { from: ['pending'], to: 'rejected' },
  suspend: { from: ['approved', 'pending'], to: 'suspended' },
  reinstate: { from: ['suspended'], to: 'approved' },
};

export async function decide(deps: Deps, adminId: string, doctorId: string, decision: Decision, note: string, ip: string): Promise<void> {
  const rule = NEXT[decision];
  if ((decision === 'reject' || decision === 'suspend') && note.trim().length < 3) throw new DomainError('admin.noteRequired');
  await deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ verification_status: string; phone_e164: string; preferred_locale: Locale }>(
      `select d.verification_status, u.phone_e164, u.preferred_locale from doctors d join users u on u.id = d.user_id
        where d.user_id = $1 for update of d`,
      [doctorId],
    );
    const d = rows[0];
    if (!d) throw notFound();
    if (!rule.from.includes(d.verification_status)) throw new DomainError('appt.notAllowed');
    await tx.query(
      `update doctors set verification_status = $2, verification_note = $3, updated_at = now(),
              verified_at = case when $2 = 'approved' then now() else verified_at end,
              verified_by = case when $2 = 'approved' then $4::uuid else verified_by end
        where user_id = $1`,
      [doctorId, rule.to, note.trim().slice(0, 500) || null, adminId],
    );
    const t = translator(d.preferred_locale);
    if (decision === 'approve') await enqueueSms(tx, d.phone_e164, t('sms.doctorApproved'));
    if (decision === 'reject') await enqueueSms(tx, d.phone_e164, t('sms.doctorRejected'));
    if (decision === 'suspend') await destroyUserSessions(tx, doctorId);
    await audit(tx, { actorId: adminId, action: `doctor.${decision}`, entityType: 'doctor', entityId: doctorId, metadata: { from: d.verification_status }, ip });
  });
}

/** Every opening of a verification document is audited. */
export async function readDocument(deps: Deps, adminId: string, documentId: string, ip: string): Promise<{ data: Buffer; mime: string }> {
  const { rows } = await deps.db.query<{ storage_key: string; mime_type: string; doctor_id: string }>(
    'select storage_key, mime_type, doctor_id from verification_documents where id = $1',
    [documentId],
  );
  const doc = rows[0];
  if (!doc) throw notFound();
  await audit(deps.db, { actorId: adminId, action: 'document.view', entityType: 'verification_document', entityId: documentId, metadata: { doctorId: doc.doctor_id }, ip });
  return { data: await deps.storage.get(doc.storage_key), mime: doc.mime_type };
}
