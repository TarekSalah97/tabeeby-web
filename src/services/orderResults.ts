import { latestPharmacyRequests, type PatientPharmacyRequest } from './pharmacyRequests.js';
import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import { isUniqueViolation } from '../db/db.js';
import type { UploadedFile } from '../http/body.js';
import type { MessageKey } from '../i18n/index.js';
import { translator, type Locale } from '../i18n/index.js';
import { labTest } from '../domain/clinical.js';
import { sniffDocumentType } from '../storage/files.js';
import { stripImageMetadata } from '../storage/imageClean.js';
import { DomainError, notFound } from '../http/errors.js';
import { enqueueSms } from './outbox.js';
import { audit } from './audit.js';

/*
 * The patient's health record (prescriptions, lab tests, imaging) and the round trip of a doctor's
 * lab / imaging order through a lab or scan centre on Tabeeby:
 *
 *   patient sends the order part to a centre → centre marks it received → uploads result files →
 *   marks it ready → the patient (and the ordering doctor) see the results under the order.
 *
 * Access rules (every query is scoped):
 *  - patient: only orders from files linked to their own account, only their own requests;
 *  - centre: only requests sent to it, and only the tests of that part plus the doctor's order notes;
 *  - doctor: results of orders they issued.
 */

export type Section = 'lab' | 'imaging';
export type RequestStatus = 'sent' | 'received' | 'ready' | 'cancelled';
export const SECTIONS: readonly Section[] = ['lab', 'imaging'];
export const isSection = (s: string): s is Section => (SECTIONS as readonly string[]).includes(s);

/** Scans (imaging, dental X-rays, echo) go to a scan centre; everything else to a lab. */
export function sectionOf(item: { test_code: string | null }): Section {
  const group = item.test_code ? labTest(item.test_code)?.group : undefined;
  // An echocardiogram is a scan; an ECG is usually done at a lab or clinic.
  return group === 'imaging' || group === 'dental' || item.test_code === 'echo' ? 'imaging' : 'lab';
}
export const facilityKindFor = (s: Section): 'lab' | 'radiology' => (s === 'imaging' ? 'radiology' : 'lab');

export const MAX_RESULT_BYTES = 10 * 1024 * 1024;
export const MAX_RESULTS_PER_REQUEST = 10;

export interface ResultFile {
  id: string;
  mime: string;
  size_bytes: number;
  created_at: Date;
}

export interface OrderPart {
  labOrderId: string;
  section: Section;
  issuedAt: Date;
  doctorName: string;
  doctorSlug: string;
  notes: string | null;
  items: { test_code: string | null; test_name: string | null }[];
  request: {
    id: string;
    status: RequestStatus;
    facilityName: string;
    facilitySlug: string;
    facilityKind: 'lab' | 'radiology';
    facilityNote: string | null;
    facilityInstructions: string | null;
    facilityPhone: string | null;
    facilityWhatsapp: string | null;
    createdAt: Date;
    readyAt: Date | null;
    results: ResultFile[];
  } | null;
}

export interface PrescriptionSummary {
  id: string;
  issued_at: Date;
  doctor_name: string;
  doctor_slug: string;
  medicines: string[];
  /** The latest request to a pharmacy for this prescription, if any. */
  pharmacy: PatientPharmacyRequest | null;
}

export interface HealthRecord {
  prescriptions: PrescriptionSummary[];
  lab: OrderPart[];
  imaging: OrderPart[];
}

// ---------------------------------------------------------------- shared loaders

interface RequestRow {
  id: string;
  lab_order_id: string;
  section: Section;
  status: RequestStatus;
  facility_name: string;
  facility_slug: string;
  facility_kind: 'lab' | 'radiology';
  facility_note: string | null;
  facility_instructions: string | null;
  facility_phone: string | null;
  facility_whatsapp: string | null;
  created_at: Date;
  ready_at: Date | null;
}

async function openRequestsFor(db: Queryable, labOrderIds: string[]): Promise<Map<string, OrderPart['request']>> {
  const out = new Map<string, OrderPart['request']>();
  if (!labOrderIds.length) return out;
  const ph = labOrderIds.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await db.query<RequestRow>(
    `select q.id, q.lab_order_id, q.section, q.status, f.name as facility_name, f.slug as facility_slug, f.kind as facility_kind,
            q.facility_note, q.facility_instructions, f.phone_e164 as facility_phone, f.whatsapp_e164 as facility_whatsapp, q.created_at, q.ready_at
       from order_requests q join facilities f on f.user_id = q.facility_id
      where q.lab_order_id in (${ph}) and q.status <> 'cancelled'`,
    labOrderIds,
  );
  const results = await resultsFor(db, rows.map((r) => r.id));
  for (const r of rows) {
    out.set(`${r.lab_order_id}:${r.section}`, {
      id: r.id,
      status: r.status,
      facilityName: r.facility_name,
      facilitySlug: r.facility_slug,
      facilityKind: r.facility_kind,
      facilityNote: r.facility_note,
      facilityInstructions: r.facility_instructions,
      facilityPhone: r.facility_phone,
      facilityWhatsapp: r.facility_whatsapp,
      createdAt: r.created_at,
      readyAt: r.ready_at,
      // The patient and doctor only see files once the centre says the results are ready.
      results: r.status === 'ready' ? (results.get(r.id) ?? []) : [],
    });
  }
  return out;
}

async function resultsFor(db: Queryable, requestIds: string[]): Promise<Map<string, ResultFile[]>> {
  const out = new Map<string, ResultFile[]>();
  if (!requestIds.length) return out;
  const ph = requestIds.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await db.query<ResultFile & { request_id: string }>(
    `select id, request_id, mime, size_bytes, created_at from order_results where request_id in (${ph}) order by created_at`,
    requestIds,
  );
  for (const r of rows) {
    const list = out.get(r.request_id) ?? [];
    list.push({ id: r.id, mime: r.mime, size_bytes: r.size_bytes, created_at: r.created_at });
    out.set(r.request_id, list);
  }
  return out;
}

interface OrderRow {
  id: string;
  issued_at: Date;
  notes: string | null;
  doctor_name: string;
  doctor_slug: string;
}

async function itemsFor(db: Queryable, labOrderIds: string[]): Promise<Map<string, { test_code: string | null; test_name: string | null }[]>> {
  const out = new Map<string, { test_code: string | null; test_name: string | null }[]>();
  if (!labOrderIds.length) return out;
  const ph = labOrderIds.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await db.query<{ lab_order_id: string; test_code: string | null; test_name: string | null }>(
    `select lab_order_id, test_code, test_name from lab_order_items where lab_order_id in (${ph}) order by position`,
    labOrderIds,
  );
  for (const r of rows) {
    const list = out.get(r.lab_order_id) ?? [];
    list.push({ test_code: r.test_code, test_name: r.test_name });
    out.set(r.lab_order_id, list);
  }
  return out;
}

/** Split orders into their lab and imaging parts, each with its open request (if any). */
async function partsOf(db: Queryable, orders: OrderRow[]): Promise<{ lab: OrderPart[]; imaging: OrderPart[] }> {
  const ids = orders.map((o) => o.id);
  const [items, requests] = await Promise.all([itemsFor(db, ids), openRequestsFor(db, ids)]);
  const out: { lab: OrderPart[]; imaging: OrderPart[] } = { lab: [], imaging: [] };
  for (const o of orders) {
    for (const section of SECTIONS) {
      const mine = (items.get(o.id) ?? []).filter((it) => sectionOf(it) === section);
      if (!mine.length) continue;
      out[section].push({
        labOrderId: o.id,
        section,
        issuedAt: o.issued_at,
        doctorName: o.doctor_name,
        doctorSlug: o.doctor_slug,
        notes: o.notes,
        items: mine,
        request: requests.get(`${o.id}:${section}`) ?? null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- patient

const PATIENT_ORDERS = `select l.id, l.issued_at, l.notes, u.full_name as doctor_name, d.slug as doctor_slug
   from lab_orders l join encounters e on e.id = l.encounter_id join patient_records r on r.id = e.record_id
   join doctors d on d.user_id = l.doctor_id join users u on u.id = l.doctor_id
  where r.patient_user_id = $1 and l.status = 'active'`;

export async function patientHealthRecord(db: Queryable, patientId: string): Promise<HealthRecord> {
  const [rx, orders] = await Promise.all([
    db.query<{ id: string; issued_at: Date; doctor_name: string; doctor_slug: string }>(
      `select p.id, p.issued_at, u.full_name as doctor_name, d.slug as doctor_slug
         from prescriptions p join encounters e on e.id = p.encounter_id join patient_records r on r.id = e.record_id
         join doctors d on d.user_id = p.doctor_id join users u on u.id = p.doctor_id
        where r.patient_user_id = $1 and p.status = 'active' order by p.issued_at desc limit 200`,
      [patientId],
    ),
    db.query<OrderRow>(`${PATIENT_ORDERS} order by l.issued_at desc limit 200`, [patientId]),
  ]);
  const meds = new Map<string, string[]>();
  if (rx.rows.length) {
    const ph = rx.rows.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await db.query<{ prescription_id: string; medicine: string }>(
      `select prescription_id, medicine from prescription_items where prescription_id in (${ph}) order by position`,
      rx.rows.map((r) => r.id),
    );
    for (const r of rows) meds.set(r.prescription_id, [...(meds.get(r.prescription_id) ?? []), r.medicine]);
  }
  const [parts, pharmacy] = await Promise.all([partsOf(db, orders.rows), latestPharmacyRequests(db, patientId, rx.rows.map((r) => r.id))]);
  return { prescriptions: rx.rows.map((r) => ({ ...r, medicines: meds.get(r.id) ?? [], pharmacy: pharmacy.get(r.id) ?? null })), ...parts };
}

/** One part of one of the patient's own orders. */
export async function patientOrderPart(db: Queryable, patientId: string, labOrderId: string, section: Section): Promise<OrderPart> {
  const { rows } = await db.query<OrderRow>(`${PATIENT_ORDERS} and l.id = $2`, [patientId, labOrderId]);
  if (!rows[0]) throw notFound();
  const part = (await partsOf(db, rows))[section][0];
  if (!part) throw notFound();
  return part;
}

export interface CentreChoice {
  user_id: string;
  name: string;
  slug: string;
  home_service: boolean;
  district_en: string | null;
  district_ar: string | null;
  offered: number;
  total_egp: number | null;
}

/** Approved centres of the right kind, those offering most of the ordered tests (then cheapest) first. */
export async function centreChoices(db: Queryable, part: OrderPart): Promise<CentreChoice[]> {
  const codes = part.items.map((i) => i.test_code).filter((c): c is string => !!c);
  const ph = codes.map((_, i) => `$${i + 2}`).join(', ');
  const offered = codes.length
    ? `(select count(*)::int from facility_tests t where t.facility_id = f.user_id and t.test_code in (${ph}))`
    : '0';
  const total = codes.length
    ? `(select sum(t.price_egp)::int from facility_tests t where t.facility_id = f.user_id and t.test_code in (${ph}))`
    : 'null::int';
  const { rows } = await db.query<CentreChoice>(
    `select f.user_id, f.name, f.slug, f.home_service, dist.name_en as district_en, dist.name_ar as district_ar,
            ${offered} as offered, ${total} as total_egp
       from facilities f join users u on u.id = f.user_id
       left join lateral (select b.district_id from facility_branches b where b.facility_id = f.user_id and b.is_active order by b.created_at limit 1) b on true
       left join districts dist on dist.id = b.district_id
      where f.kind = $1 and f.verification_status = 'approved' and u.status = 'active'
      order by offered desc, total_egp asc nulls last, f.name limit 40`,
    [facilityKindFor(part.section), ...codes],
  );
  return rows;
}

export async function sendOrderPart(
  deps: Deps,
  patientId: string,
  labOrderId: string,
  section: Section,
  facilityId: string,
  ip: string,
  extra: { note?: string; homeVisit?: boolean } = {},
): Promise<MessageKey | null> {
  const part = await patientOrderPart(deps.db, patientId, labOrderId, section);
  if (part.request) return 'hr.err.alreadySent';
  const note = (extra.note ?? '').trim().slice(0, 300);
  const f = await deps.db.query<{ name: string; phone_e164: string; preferred_locale: Locale; home_service: boolean }>(
    `select f.name, u.phone_e164, u.preferred_locale, f.home_service from facilities f join users u on u.id = f.user_id
      where f.user_id = $1 and f.kind = $2 and f.verification_status = 'approved' and u.status = 'active'`,
    [facilityId, facilityKindFor(section)],
  );
  const centre = f.rows[0];
  if (!centre) return 'hr.err.chooseCentre';
  if (extra.homeVisit && !centre.home_service) return 'hr.err.noHomeVisit';
  try {
    await deps.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into order_requests (lab_order_id, section, patient_id, facility_id, created_at, updated_at, patient_note, home_visit)
         values ($1, $2, $3, $4, $5, $5, $6, $7) returning id`,
        [labOrderId, section, patientId, facilityId, deps.now(), note || null, !!extra.homeVisit],
      );
      const t = translator(centre.preferred_locale);
      await enqueueSms(tx, centre.phone_e164, t('hr.sms.newRequest', { link: `${deps.cfg.PUBLIC_ORIGIN}${centre.preferred_locale === 'en' ? '/en' : ''}/facility/requests` }));
      await audit(tx, { actorId: patientId, action: 'order.send', entityType: 'order_request', entityId: rows[0]!.id, metadata: { section, facilityId }, ip });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return 'hr.err.alreadySent';
    throw e;
  }
  return null;
}

/** The patient changes their mind before the centre has picked the request up. */
export async function cancelOrderPart(deps: Deps, patientId: string, requestId: string, ip: string): Promise<MessageKey | null> {
  const { rows } = await deps.db.query<{ status: RequestStatus }>(
    'select status from order_requests where id = $1 and patient_id = $2',
    [requestId, patientId],
  );
  if (!rows[0]) throw notFound();
  if (rows[0].status !== 'sent') return 'hr.err.cannotCancel';
  await deps.db.transaction(async (tx) => {
    await tx.query(`update order_requests set status = 'cancelled', cancelled_at = $2, updated_at = $2 where id = $1 and status = 'sent'`, [requestId, deps.now()]);
    await audit(tx, { actorId: patientId, action: 'order.cancel', entityType: 'order_request', entityId: requestId, ip });
  });
  return null;
}

// ---------------------------------------------------------------- centre (lab / scan centre)

export interface CentreRequest {
  id: string;
  status: RequestStatus;
  section: Section;
  created_at: Date;
  patient_name: string;
  patient_phone: string;
  doctor_name: string;
  issued_at: Date;
  notes: string | null;
  order_voided: boolean;
  items: { test_code: string | null; test_name: string | null }[];
  results: ResultFile[];
  facility_note: string | null;
  patient_note: string | null;
  home_visit: boolean;
  facility_instructions: string | null;
}

export async function listCentreRequests(db: Queryable, facilityId: string): Promise<CentreRequest[]> {
  const { rows } = await db.query<Omit<CentreRequest, 'items' | 'results'> & { lab_order_id: string }>(
    `select q.id, q.status, q.section, q.created_at, q.lab_order_id, q.facility_note, q.patient_note, q.home_visit, q.facility_instructions, p.full_name as patient_name, p.phone_e164 as patient_phone,
            du.full_name as doctor_name, l.issued_at, l.notes, l.status = 'voided' as order_voided
       from order_requests q join users p on p.id = q.patient_id join lab_orders l on l.id = q.lab_order_id
       join users du on du.id = l.doctor_id
      where q.facility_id = $1 and q.status <> 'cancelled'
      order by (q.status = 'ready'), q.created_at desc limit 200`,
    [facilityId],
  );
  const [items, results] = await Promise.all([itemsFor(db, rows.map((r) => r.lab_order_id)), resultsFor(db, rows.map((r) => r.id))]);
  return rows.map(({ lab_order_id, ...r }) => ({
    ...r,
    // Only the part sent to this centre: a lab never sees the patient's scans and vice versa.
    items: (items.get(lab_order_id) ?? []).filter((it) => sectionOf(it) === r.section),
    results: results.get(r.id) ?? [],
  }));
}

export async function getCentreRequest(db: Queryable, facilityId: string, id: string): Promise<CentreRequest> {
  const found = (await listCentreRequests(db, facilityId)).find((r) => r.id === id);
  if (!found) throw notFound();
  return found;
}

/** The centre picks the request up, optionally with instructions for the patient (sent by SMS). */
export async function markReceived(deps: Deps, facilityId: string, id: string, ip: string, instructionsRaw = ''): Promise<void> {
  const instructions = instructionsRaw.trim().slice(0, 500);
  await deps.db.transaction(async (tx) => {
    const res = await tx.query<{ patient_id: string }>(
      `update order_requests set status = 'received', received_at = $3, updated_at = $3, facility_instructions = $4
        where id = $1 and facility_id = $2 and status = 'sent' returning patient_id`,
      [id, facilityId, deps.now(), instructions || null],
    );
    if (!res.rows[0]) throw notFound();
    if (instructions) {
      const p = await tx.query<{ phone_e164: string; preferred_locale: Locale; name: string }>(
        'select u.phone_e164, u.preferred_locale, f.name from users u, facilities f where u.id = $1 and f.user_id = $2',
        [res.rows[0].patient_id, facilityId],
      );
      const row = p.rows[0]!;
      await enqueueSms(tx, row.phone_e164, translator(row.preferred_locale)('hr.sms.instructions', { centre: row.name, text: instructions.slice(0, 120) }));
    }
    await audit(tx, { actorId: facilityId, action: 'order.received', entityType: 'order_request', entityId: id, ip });
  });
}

export async function addResultFile(deps: Deps, facilityId: string, id: string, file: UploadedFile | undefined, ip: string): Promise<MessageKey | null> {
  const req = await getCentreRequest(deps.db, facilityId, id);
  if (req.status === 'sent') return 'hr.err.receiveFirst';
  if (req.results.length >= MAX_RESULTS_PER_REQUEST) return 'hr.err.tooManyFiles';
  if (!file || !file.data.length) return 'hr.err.fileRequired';
  if (file.data.length > MAX_RESULT_BYTES) return 'hr.err.fileTooLarge';
  const type = sniffDocumentType(file.data);
  if (!type) return 'hr.err.fileType';
  // Photos lose their hidden metadata (location, device); PDFs are kept as they are.
  const data = type.ext === 'pdf' ? file.data : stripImageMetadata(file.data);
  if (!data) return 'hr.err.fileType';
  const key = await deps.storage.put(data, type.ext);
  try {
    await deps.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        'insert into order_results (request_id, storage_key, mime, size_bytes, uploaded_by) values ($1, $2, $3, $4, $5) returning id',
        [id, key, type.mime, data.length, facilityId],
      );
      await tx.query('update order_requests set updated_at = $2 where id = $1', [id, deps.now()]);
      await audit(tx, { actorId: facilityId, action: 'order.result_added', entityType: 'order_result', entityId: rows[0]!.id, metadata: { requestId: id }, ip });
    });
  } catch (e) {
    await deps.storage.remove(key).catch(() => undefined);
    throw e;
  }
  return null;
}

/** A wrong file can be taken back only before the results are released to the patient. */
export async function removeResultFile(deps: Deps, facilityId: string, resultId: string, ip: string): Promise<void> {
  const { rows } = await deps.db.query<{ storage_key: string; request_id: string }>(
    `select r.storage_key, r.request_id from order_results r join order_requests q on q.id = r.request_id
      where r.id = $1 and q.facility_id = $2 and q.status = 'received'`,
    [resultId, facilityId],
  );
  const row = rows[0];
  if (!row) throw notFound();
  await deps.db.transaction(async (tx) => {
    await tx.query('delete from order_results where id = $1', [resultId]);
    await audit(tx, { actorId: facilityId, action: 'order.result_removed', entityType: 'order_result', entityId: resultId, metadata: { requestId: row.request_id }, ip });
  });
  await deps.storage.remove(row.storage_key).catch(() => undefined);
}

export const MAX_FACILITY_NOTE = 1000;

export async function markReady(deps: Deps, facilityId: string, id: string, note: string, ip: string): Promise<MessageKey | null> {
  const req = await getCentreRequest(deps.db, facilityId, id);
  if (req.status !== 'received') return 'hr.err.receiveFirst';
  if (!req.results.length) return 'hr.err.noFiles';
  const clean = note.trim().slice(0, MAX_FACILITY_NOTE) || null;
  await deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ phone_e164: string; preferred_locale: Locale; name: string }>(
      `update order_requests q set status = 'ready', ready_at = $3, updated_at = $3, facility_note = $4
         from users p, facilities f
        where q.id = $1 and q.facility_id = $2 and q.status = 'received' and p.id = q.patient_id and f.user_id = q.facility_id
        returning p.phone_e164, p.preferred_locale, f.name`,
      [id, facilityId, deps.now(), clean],
    );
    const p = rows[0];
    if (!p) throw new DomainError('hr.err.receiveFirst');
    const t = translator(p.preferred_locale);
    await enqueueSms(tx, p.phone_e164, t('hr.sms.ready', { centre: p.name, link: `${deps.cfg.PUBLIC_ORIGIN}${p.preferred_locale === 'en' ? '/en' : ''}/health-record` }));
    await audit(tx, { actorId: facilityId, action: 'order.ready', entityType: 'order_request', entityId: id, ip });
  });
  return null;
}

// ---------------------------------------------------------------- results for the ordering doctor

/** Open requests (and released results) for the doctor's own lab orders. */
export async function doctorOrderResults(db: Queryable, doctorId: string, labOrderIds: string[]): Promise<Map<string, OrderPart['request']>> {
  if (!labOrderIds.length) return new Map();
  const ph = labOrderIds.map((_, i) => `$${i + 2}`).join(', ');
  const { rows } = await db.query<{ id: string }>(`select id from lab_orders where doctor_id = $1 and id in (${ph})`, [doctorId, ...labOrderIds]);
  return openRequestsFor(db, rows.map((r) => r.id));
}

// ---------------------------------------------------------------- reading a result file

export type ResultViewer = { patientId: string } | { facilityId: string } | { doctorId: string };

export async function readResultFile(deps: Deps, viewer: ResultViewer, resultId: string, ip: string): Promise<{ data: Buffer; mime: string }> {
  const { rows } = await deps.db.query<{ storage_key: string; mime: string; patient_id: string; facility_id: string; doctor_id: string; status: RequestStatus }>(
    `select r.storage_key, r.mime, q.patient_id, q.facility_id, l.doctor_id, q.status
       from order_results r join order_requests q on q.id = r.request_id join lab_orders l on l.id = q.lab_order_id
      where r.id = $1`,
    [resultId],
  );
  const row = rows[0];
  const allowed =
    row &&
    ('facilityId' in viewer
      ? row.facility_id === viewer.facilityId
      : row.status === 'ready' && ('patientId' in viewer ? row.patient_id === viewer.patientId : row.doctor_id === viewer.doctorId));
  if (!row || !allowed) throw notFound();
  const actorId = 'patientId' in viewer ? viewer.patientId : 'facilityId' in viewer ? viewer.facilityId : viewer.doctorId;
  await audit(deps.db, { actorId, action: 'order.result_viewed', entityType: 'order_result', entityId: resultId, ip });
  return { data: await deps.storage.get(row.storage_key), mime: row.mime };
}
