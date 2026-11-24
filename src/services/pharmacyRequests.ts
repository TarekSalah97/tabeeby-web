import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import { isUniqueViolation } from '../db/db.js';
import { normalizeDigits } from '../domain/phone.js';
import { translator, type Locale, type MessageKey } from '../i18n/index.js';
import { notFound } from '../http/errors.js';
import { enqueueSms } from './outbox.js';
import { audit } from './audit.js';

/**
 * A patient sends one of their prescriptions to a pharmacy on Tabeeby (pickup or delivery). The
 * pharmacy sees only that prescription, the patient's name and mobile, and answers with
 * availability, the total and a note. Nothing is paid or ordered through Tabeeby.
 */
export const PHARMACY_STATUSES = ['sent', 'ready', 'out_for_delivery', 'partly_available', 'unavailable', 'completed', 'cancelled'] as const;
export type PharmacyStatus = (typeof PHARMACY_STATUSES)[number];
/** What a pharmacy may answer. */
export const PHARMACY_REPLIES = ['ready', 'out_for_delivery', 'partly_available', 'unavailable'] as const;
export type PharmacyReply = (typeof PHARMACY_REPLIES)[number];
export const OPEN_STATUSES: readonly PharmacyStatus[] = ['sent', 'ready', 'out_for_delivery', 'partly_available'];
export const MAX_PATIENT_NOTE = 300;
export const MAX_PHARMACY_NOTE = 500;

export interface RxItem {
  medicine: string;
  form: string;
  dose: string;
  frequency: string;
  duration: string | null;
}

/** The patient's view of the latest request for a prescription. */
export interface PatientPharmacyRequest {
  id: string;
  status: PharmacyStatus;
  delivery: boolean;
  pharmacy_name: string;
  pharmacy_slug: string;
  pharmacy_phone: string | null;
  pharmacy_whatsapp: string | null;
  pharmacy_note: string | null;
  total_egp: number | null;
  created_at: Date;
  replied_at: Date | null;
}

/** The latest request (open or answered, not cancelled) for each of these prescriptions. */
export async function latestPharmacyRequests(db: Queryable, patientId: string, prescriptionIds: string[]): Promise<Map<string, PatientPharmacyRequest>> {
  const out = new Map<string, PatientPharmacyRequest>();
  if (!prescriptionIds.length) return out;
  const { rows } = await db.query<PatientPharmacyRequest & { prescription_id: string }>(
    `select distinct on (q.prescription_id) q.prescription_id, q.id, q.status, q.delivery, f.name as pharmacy_name, f.slug as pharmacy_slug,
            f.phone_e164 as pharmacy_phone, f.whatsapp_e164 as pharmacy_whatsapp, q.pharmacy_note, q.total_egp, q.created_at, q.replied_at
       from pharmacy_requests q join facilities f on f.user_id = q.facility_id
      where q.patient_id = $1 and q.prescription_id = any($2::uuid[]) and q.status <> 'cancelled'
      order by q.prescription_id, q.created_at desc`,
    [patientId, prescriptionIds],
  );
  for (const { prescription_id, ...r } of rows) out.set(prescription_id, r);
  return out;
}

/** One of the patient's own active prescriptions, with its medicines. */
export async function patientPrescription(db: Queryable, patientId: string, prescriptionId: string): Promise<{ id: string; issued_at: Date; doctor_name: string; items: RxItem[] }> {
  const { rows } = await db.query<{ id: string; issued_at: Date; doctor_name: string }>(
    `select p.id, p.issued_at, u.full_name as doctor_name
       from prescriptions p join encounters e on e.id = p.encounter_id join patient_records r on r.id = e.record_id
       join users u on u.id = p.doctor_id
      where p.id = $1 and r.patient_user_id = $2 and p.status = 'active'`,
    [prescriptionId, patientId],
  );
  if (!rows[0]) throw notFound();
  return { ...rows[0], items: await itemsOf(db, prescriptionId) };
}

async function itemsOf(db: Queryable, prescriptionId: string): Promise<RxItem[]> {
  return (
    await db.query<RxItem>(
      'select medicine, form, dose, frequency, duration from prescription_items where prescription_id = $1 order by position',
      [prescriptionId],
    )
  ).rows;
}

export interface PharmacyChoice {
  user_id: string;
  name: string;
  slug: string;
  home_service: boolean;
  district_en: string | null;
  district_ar: string | null;
}

export async function pharmacyChoices(db: Queryable): Promise<PharmacyChoice[]> {
  return (
    await db.query<PharmacyChoice>(
      `select f.user_id, f.name, f.slug, f.home_service, dist.name_en as district_en, dist.name_ar as district_ar
         from facilities f join users u on u.id = f.user_id
         left join lateral (select b.district_id from facility_branches b where b.facility_id = f.user_id and b.is_active order by b.created_at limit 1) b on true
         left join districts dist on dist.id = b.district_id
        where f.kind = 'pharmacy' and f.verification_status = 'approved' and u.status = 'active'
        order by f.home_service desc, f.name limit 60`,
    )
  ).rows;
}

export async function sendToPharmacy(
  deps: Deps,
  patientId: string,
  prescriptionId: string,
  input: { facilityId: string; delivery: boolean; note: string },
  ip: string,
): Promise<MessageKey | null> {
  await patientPrescription(deps.db, patientId, prescriptionId);
  const note = input.note.trim().slice(0, MAX_PATIENT_NOTE);
  const f = await deps.db.query<{ name: string; phone_e164: string; preferred_locale: Locale; home_service: boolean }>(
    `select f.name, u.phone_e164, u.preferred_locale, f.home_service from facilities f join users u on u.id = f.user_id
      where f.user_id = $1 and f.kind = 'pharmacy' and f.verification_status = 'approved' and u.status = 'active'`,
    [input.facilityId],
  );
  const pharmacy = f.rows[0];
  if (!pharmacy) return 'rxsend.err.choose';
  if (input.delivery && !pharmacy.home_service) return 'rxsend.err.noDelivery';
  try {
    await deps.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into pharmacy_requests (prescription_id, patient_id, facility_id, delivery, patient_note, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $6) returning id`,
        [prescriptionId, patientId, input.facilityId, input.delivery, note || null, deps.now()],
      );
      const t = translator(pharmacy.preferred_locale);
      await enqueueSms(tx, pharmacy.phone_e164, t('rxsend.sms.new', { link: `${deps.cfg.PUBLIC_ORIGIN}${pharmacy.preferred_locale === 'en' ? '/en' : ''}/facility/prescriptions` }));
      await audit(tx, { actorId: patientId, action: 'pharmacy_request.send', entityType: 'pharmacy_request', entityId: rows[0]!.id, metadata: { facilityId: input.facilityId }, ip });
    });
  } catch (e) {
    if (isUniqueViolation(e, 'pharmacy_requests_one_open_idx')) return 'rxsend.err.alreadySent';
    throw e;
  }
  return null;
}

/** The patient withdraws a request the pharmacy has not answered yet. */
export async function cancelPharmacyRequest(deps: Deps, patientId: string, id: string, ip: string): Promise<MessageKey | null> {
  return deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ status: PharmacyStatus }>('select status from pharmacy_requests where id = $1 and patient_id = $2 for update', [id, patientId]);
    if (!rows[0]) throw notFound();
    if (rows[0].status !== 'sent') return 'rxsend.err.cannotCancel';
    await tx.query(`update pharmacy_requests set status = 'cancelled', cancelled_at = $2, updated_at = $2 where id = $1`, [id, deps.now()]);
    await audit(tx, { actorId: patientId, action: 'pharmacy_request.cancel', entityType: 'pharmacy_request', entityId: id, ip });
    return null;
  });
}

// ---------------------------------------------------------------- pharmacy side

export interface PharmacyInboxItem {
  id: string;
  status: PharmacyStatus;
  delivery: boolean;
  patient_note: string | null;
  pharmacy_note: string | null;
  total_egp: number | null;
  created_at: Date;
  patient_name: string;
  patient_phone: string;
  doctor_name: string;
  issued_at: Date;
  prescription_voided: boolean;
  prescription_id: string;
}

export async function listPharmacyInbox(db: Queryable, facilityId: string): Promise<PharmacyInboxItem[]> {
  return (
    await db.query<PharmacyInboxItem>(
      `select q.id, q.status, q.delivery, q.patient_note, q.pharmacy_note, q.total_egp, q.created_at, q.prescription_id,
              pu.full_name as patient_name, pu.phone_e164 as patient_phone, du.full_name as doctor_name, p.issued_at,
              p.status = 'voided' as prescription_voided
         from pharmacy_requests q join users pu on pu.id = q.patient_id join prescriptions p on p.id = q.prescription_id
         join users du on du.id = p.doctor_id
        where q.facility_id = $1 and q.status <> 'cancelled'
        order by (q.status in ('completed', 'unavailable')), q.created_at desc limit 200`,
      [facilityId],
    )
  ).rows;
}

export async function getPharmacyRequest(db: Queryable, facilityId: string, id: string): Promise<PharmacyInboxItem & { items: RxItem[] }> {
  const found = (await listPharmacyInbox(db, facilityId)).find((r) => r.id === id);
  if (!found) throw notFound();
  return { ...found, items: await itemsOf(db, found.prescription_id) };
}

/** The pharmacy answers (or updates its answer). The patient gets an SMS. */
export async function replyToRequest(
  deps: Deps,
  facilityId: string,
  id: string,
  input: { status: string; total: string; note: string },
  ip: string,
): Promise<MessageKey | null> {
  if (!(PHARMACY_REPLIES as readonly string[]).includes(input.status)) return 'rxsend.err.status';
  const digits = normalizeDigits(input.total).replace(/[,\s]/g, '');
  const total = digits === '' ? null : /^\d{1,7}$/.test(digits) ? Number(digits) : NaN;
  if (Number.isNaN(total) || (total !== null && total > 1_000_000)) return 'rxsend.err.total';
  const note = input.note.trim().slice(0, MAX_PHARMACY_NOTE);
  return deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ status: PharmacyStatus; delivery: boolean; patient_id: string; name: string }>(
      `select q.status, q.delivery, q.patient_id, f.name from pharmacy_requests q join facilities f on f.user_id = q.facility_id
        where q.id = $1 and q.facility_id = $2 for update of q`,
      [id, facilityId],
    );
    const r = rows[0];
    if (!r) throw notFound();
    if (!OPEN_STATUSES.includes(r.status)) return 'rxsend.err.closed';
    if (input.status === 'out_for_delivery' && !r.delivery) return 'rxsend.err.status';
    await tx.query(
      `update pharmacy_requests set status = $3, total_egp = $4, pharmacy_note = $5, replied_at = $6, updated_at = $6 where id = $1 and facility_id = $2`,
      [id, facilityId, input.status, total, note || null, deps.now()],
    );
    const p = await tx.query<{ phone_e164: string; preferred_locale: Locale }>('select phone_e164, preferred_locale from users where id = $1', [r.patient_id]);
    const patient = p.rows[0]!;
    const t = translator(patient.preferred_locale);
    await enqueueSms(tx, patient.phone_e164, t('rxsend.sms.reply', {
      pharmacy: r.name,
      status: t(`rxsend.status.${input.status}` as MessageKey),
      link: `${deps.cfg.PUBLIC_ORIGIN}${patient.preferred_locale === 'en' ? '/en' : ''}/health-record`,
    }));
    await audit(tx, { actorId: facilityId, action: 'pharmacy_request.reply', entityType: 'pharmacy_request', entityId: id, metadata: { status: input.status }, ip });
    return null;
  });
}

/** The pharmacy closes a request once the medicines were collected or delivered. */
export async function completeRequest(deps: Deps, facilityId: string, id: string, ip: string): Promise<MessageKey | null> {
  return deps.db.transaction(async (tx) => {
    const r = await tx.query(
      `update pharmacy_requests set status = 'completed', updated_at = $3 where id = $1 and facility_id = $2 and status in ('ready', 'out_for_delivery', 'partly_available')`,
      [id, facilityId, deps.now()],
    );
    if (!r.rowCount) return 'rxsend.err.closed';
    await audit(tx, { actorId: facilityId, action: 'pharmacy_request.complete', entityType: 'pharmacy_request', entityId: id, ip });
    return null;
  });
}
