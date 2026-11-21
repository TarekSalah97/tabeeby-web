import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import { isUniqueViolation } from '../db/db.js';
import type { MessageKey } from '../i18n/index.js';
import type { FieldErrors } from './accounts.js';
import { audit } from './audit.js';
import { notFound } from '../http/errors.js';
import { normalizeEgyptMobile } from '../domain/phone.js';
import { isValidDate, todayIn } from '../domain/time.js';
import {
  SEXES, MARITAL_STATUSES, HABITS, MEDICINE_FORMS, FREQUENCIES, TIMINGS, labTest,
  type MedicineForm, type Frequency, type Timing,
} from '../domain/clinical.js';

/*
 * Clinical records. Rules every function here follows:
 *  - Every query is scoped by the signed-in doctor's id (or, for the patient view, the patient's id).
 *  - The feature is gated per doctor (doctors.records_enabled); callers check it with recordsEnabled().
 *  - Issued prescriptions and lab orders are never edited, only voided (also enforced by triggers).
 *  - Edits to files and visit notes keep the previous version in record_revisions.
 *  - Audit entries carry ids only, never health data.
 */

const trimOrNull = (v: string | undefined, max: number): string | null => {
  const s = (v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const oneOf = <T extends string>(list: readonly T[], v: string | undefined): T | null => (list as readonly string[]).includes(v ?? '') ? (v as T) : null;

export async function recordsEnabled(db: Queryable, doctorId: string): Promise<boolean> {
  const { rows } = await db.query<{ records_enabled: boolean }>('select records_enabled from doctors where user_id = $1', [doctorId]);
  return rows[0]?.records_enabled === true;
}

// ---------------------------------------------------------------- patient files

export interface RecordInput {
  fullName: string;
  phone: string;
  dateOfBirth: string;
  sex: string;
  occupation: string;
  maritalStatus: string;
  habits: string[];
  habitsNote: string;
  allergies: string;
  chronicConditions: string;
  pastHistory: string;
  currentMedications: string;
  familyHistory: string;
}

interface CleanRecord {
  full_name: string;
  phone_e164: string | null;
  date_of_birth: string | null;
  sex: string | null;
  occupation: string | null;
  marital_status: string | null;
  habits: string[];
  habits_note: string | null;
  allergies: string | null;
  chronic_conditions: string | null;
  past_history: string | null;
  current_medications: string | null;
  family_history: string | null;
}

export function validateRecord(input: RecordInput, today: string): { errors: FieldErrors; clean: CleanRecord } {
  const errors: FieldErrors = {};
  const name = input.fullName.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) errors['fullName'] = 'records.err.name';
  let phone: string | null = null;
  if (input.phone.trim()) {
    phone = normalizeEgyptMobile(input.phone);
    if (!phone) errors['phone'] = 'phone.invalid';
  }
  let dob: string | null = null;
  if (input.dateOfBirth.trim()) {
    dob = input.dateOfBirth.trim();
    if (!isValidDate(dob) || dob < '1900-01-01' || dob > today) errors['dateOfBirth'] = 'records.err.dob';
  }
  const clean: CleanRecord = {
    full_name: name,
    phone_e164: phone,
    date_of_birth: dob,
    sex: oneOf(SEXES, input.sex),
    occupation: trimOrNull(input.occupation, 120),
    marital_status: oneOf(MARITAL_STATUSES, input.maritalStatus),
    habits: [...new Set(input.habits.filter((h) => (HABITS as readonly string[]).includes(h)))],
    habits_note: trimOrNull(input.habitsNote, 500),
    allergies: trimOrNull(input.allergies, 2000),
    chronic_conditions: trimOrNull(input.chronicConditions, 2000),
    past_history: trimOrNull(input.pastHistory, 2000),
    current_medications: trimOrNull(input.currentMedications, 2000),
    family_history: trimOrNull(input.familyHistory, 2000),
  };
  return { errors, clean };
}

export interface PatientRecord extends CleanRecord {
  id: string;
  patient_user_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const RECORD_COLUMNS = `r.id, r.patient_user_id, r.full_name, r.phone_e164, r.date_of_birth::text as date_of_birth, r.sex, r.occupation,
  r.marital_status, r.habits, r.habits_note, r.allergies, r.chronic_conditions, r.past_history, r.current_medications,
  r.family_history, r.created_at, r.updated_at`;

export interface RecordListItem {
  id: string;
  full_name: string;
  phone_e164: string | null;
  date_of_birth: string | null;
  sex: string | null;
  patient_user_id: string | null;
  last_visit_at: Date | null;
  visits: number;
}

export async function listRecords(db: Queryable, doctorId: string, q: string): Promise<RecordListItem[]> {
  const term = q.trim().slice(0, 60);
  const digits = normalizeEgyptMobile(term);
  const { rows } = await db.query<RecordListItem>(
    `select r.id, r.full_name, coalesce(r.phone_e164, u.phone_e164) as phone_e164, r.date_of_birth::text as date_of_birth, r.sex, r.patient_user_id,
            max(e.visit_at) as last_visit_at, count(e.id)::int as visits
       from patient_records r
       left join users u on u.id = r.patient_user_id
       left join encounters e on e.record_id = r.id
      where r.doctor_id = $1
        and ($2 = '' or r.full_name ilike '%' || $2 || '%' or coalesce(r.phone_e164, u.phone_e164) = $3)
      group by r.id, u.phone_e164
      order by coalesce(max(e.visit_at), r.created_at) desc
      limit 300`,
    [doctorId, term.replace(/[%_\\]/g, (c) => '\\' + c), digits ?? ''],
  );
  return rows;
}

/** The doctor's own file, with the account phone when the file is linked to a patient account. */
export async function getRecord(db: Queryable, doctorId: string, id: string): Promise<PatientRecord & { account_phone: string | null }> {
  const { rows } = await db.query<PatientRecord & { account_phone: string | null }>(
    `select ${RECORD_COLUMNS}, u.phone_e164 as account_phone
       from patient_records r left join users u on u.id = r.patient_user_id
      where r.id = $1 and r.doctor_id = $2`,
    [id, doctorId],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

/** A doctor's own appointment, with its patient. */
async function ownAppointment(db: Queryable, doctorId: string, appointmentId: string) {
  // patient_id is null for phone / walk-in bookings the clinic made; name and phone then come from the booking.
  const { rows } = await db.query<{ id: string; patient_id: string | null; clinic_id: string; full_name: string; phone_e164: string }>(
    `select a.id, a.patient_id, a.clinic_id, coalesce(u.full_name, a.walk_in_name) as full_name, coalesce(u.phone_e164, a.walk_in_phone) as phone_e164
       from appointments a left join users u on u.id = a.patient_id where a.id = $1 and a.doctor_id = $2`,
    [appointmentId, doctorId],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}

export type AppointmentFile =
  | { kind: 'existing'; recordId: string }
  | { kind: 'new'; appointmentId: string; patientName: string; patientPhone: string; walkIns: { id: string; full_name: string; created_at: Date }[] };

/**
 * Where "Patient file" on an appointment leads: the existing file for that patient, or a new one.
 * Walk-in files with the same phone are offered for linking; the doctor decides, because families
 * in Egypt often share one phone.
 */
export async function fileForAppointment(db: Queryable, doctorId: string, appointmentId: string): Promise<AppointmentFile> {
  const appt = await ownAppointment(db, doctorId, appointmentId);
  if (appt.patient_id) {
    const existing = await db.query<{ id: string }>('select id from patient_records where doctor_id = $1 and patient_user_id = $2', [doctorId, appt.patient_id]);
    if (existing.rows[0]) return { kind: 'existing', recordId: existing.rows[0].id };
  }
  const walkIns = await db.query<{ id: string; full_name: string; created_at: Date }>(
    'select id, full_name, created_at from patient_records where doctor_id = $1 and patient_user_id is null and phone_e164 = $2 order by created_at desc limit 10',
    [doctorId, appt.phone_e164],
  );
  return { kind: 'new', appointmentId: appt.id, patientName: appt.full_name, patientPhone: appt.phone_e164, walkIns: walkIns.rows };
}

export async function createRecord(
  deps: Deps,
  doctorId: string,
  input: RecordInput,
  o: { consent: boolean; appointmentId: string | null },
  ip: string,
): Promise<{ id: string } | { errors: FieldErrors }> {
  const { errors, clean } = validateRecord(input, todayIn(deps.cfg.TIME_ZONE, deps.now()));
  if (!o.consent) errors['consent'] = 'records.err.consent';
  if (Object.keys(errors).length) return { errors };
  return deps.db.transaction(async (tx) => {
    let patientUserId: string | null = null;
    if (o.appointmentId) {
      const appt = await ownAppointment(tx, doctorId, o.appointmentId);
      patientUserId = appt.patient_id;
      if (patientUserId) {
        const existing = await tx.query<{ id: string }>('select id from patient_records where doctor_id = $1 and patient_user_id = $2', [doctorId, patientUserId]);
        if (existing.rows[0]) return { id: existing.rows[0].id };
      }
    }
    const { rows } = await tx.query<{ id: string }>(
      `insert into patient_records (doctor_id, patient_user_id, full_name, phone_e164, date_of_birth, sex, occupation, marital_status,
         habits, habits_note, allergies, chronic_conditions, past_history, current_medications, family_history, consent_at)
       values ($1, $2, $3, $4, $5::date, $6, $7, $8, $9::text[], $10, $11, $12, $13, $14, $15, now()) returning id`,
      [doctorId, patientUserId, clean.full_name, clean.phone_e164, clean.date_of_birth, clean.sex, clean.occupation, clean.marital_status,
        clean.habits, clean.habits_note, clean.allergies, clean.chronic_conditions, clean.past_history, clean.current_medications, clean.family_history],
    );
    const id = rows[0]!.id;
    await audit(tx, { actorId: doctorId, action: 'record.create', entityType: 'patient_record', entityId: id, metadata: { linked: !!patientUserId }, ip });
    return { id };
  });
}

export async function updateRecord(deps: Deps, doctorId: string, id: string, input: RecordInput, ip: string): Promise<{ errors: FieldErrors } | null> {
  const { errors, clean } = validateRecord(input, todayIn(deps.cfg.TIME_ZONE, deps.now()));
  if (Object.keys(errors).length) return { errors };
  await deps.db.transaction(async (tx) => {
    const old = await tx.query<Record<string, unknown>>(`select ${RECORD_COLUMNS} from patient_records r where r.id = $1 and r.doctor_id = $2 for update`, [id, doctorId]);
    if (!old.rows[0]) throw notFound();
    await tx.query(`insert into record_revisions (entity_type, entity_id, doctor_id, data) values ('patient_record', $1, $2, $3)`, [id, doctorId, old.rows[0]]);
    await tx.query(
      `update patient_records set full_name = $3, phone_e164 = $4, date_of_birth = $5::date, sex = $6, occupation = $7, marital_status = $8,
              habits = $9::text[], habits_note = $10, allergies = $11, chronic_conditions = $12, past_history = $13,
              current_medications = $14, family_history = $15, updated_at = now()
        where id = $1 and doctor_id = $2`,
      [id, doctorId, clean.full_name, clean.phone_e164, clean.date_of_birth, clean.sex, clean.occupation, clean.marital_status, clean.habits,
        clean.habits_note, clean.allergies, clean.chronic_conditions, clean.past_history, clean.current_medications, clean.family_history],
    );
    await audit(tx, { actorId: doctorId, action: 'record.update', entityType: 'patient_record', entityId: id, ip });
  });
  return null;
}

/** Link a walk-in file to the account of the patient on one of the doctor's appointments. */
export async function linkRecord(deps: Deps, doctorId: string, recordId: string, appointmentId: string, ip: string): Promise<MessageKey | null> {
  return deps.db.transaction(async (tx) => {
    const appt = await ownAppointment(tx, doctorId, appointmentId);
    const rec = await tx.query<{ patient_user_id: string | null }>('select patient_user_id from patient_records where id = $1 and doctor_id = $2 for update', [recordId, doctorId]);
    if (!rec.rows[0]) throw notFound();
    // A booking without an account has nothing to link to; the doctor just uses the existing file.
    if (!appt.patient_id) return 'records.err.noAccount';
    if (rec.rows[0].patient_user_id) return rec.rows[0].patient_user_id === appt.patient_id ? null : 'records.err.alreadyLinked';
    try {
      await tx.query('update patient_records set patient_user_id = $3, updated_at = now() where id = $1 and doctor_id = $2', [recordId, doctorId, appt.patient_id]);
    } catch (e) {
      if (isUniqueViolation(e, 'patient_records_account_idx')) return 'records.err.alreadyLinked';
      throw e;
    }
    await audit(tx, { actorId: doctorId, action: 'record.link', entityType: 'patient_record', entityId: recordId, metadata: { appointmentId }, ip });
    return null;
  });
}

/** Opening a file is audited (who looked at which file, when). */
export async function auditRecordView(db: Queryable, doctorId: string, recordId: string, ip: string): Promise<void> {
  await audit(db, { actorId: doctorId, action: 'record.view', entityType: 'patient_record', entityId: recordId, ip });
}

// ---------------------------------------------------------------- prescriptions and lab orders (input)

export interface RxLineInput {
  medicine: string;
  form: string;
  dose: string;
  frequency: string;
  timing: string;
  duration: string;
  instructions: string;
}

export interface RxLine {
  medicine: string;
  form: MedicineForm;
  dose: string;
  frequency: Frequency;
  timing: Timing | null;
  duration: string | null;
  instructions: string | null;
}

export interface RxInput {
  lines: RxLineInput[];
  notes: string;
}

export interface LabInput {
  codes: string[];
  other: string;
  notes: string;
}

/** A problem with a prescription or lab order; `line` is the 1-based medicine line it concerns. */
export interface OrderProblem {
  key: MessageKey;
  line?: number;
}

export const MAX_RX_LINES = 20;
const MAX_LAB_ITEMS = 60;

const blankLine = (l: RxLineInput) => !l.medicine.trim() && !l.dose.trim() && !l.duration.trim() && !l.instructions.trim();

/** Blank lines are ignored (the form always offers a few). Returns null lines when nothing was prescribed. */
export function validateRx(input: RxInput): { lines: RxLine[]; notes: string | null } | OrderProblem {
  const used = input.lines.filter((l) => !blankLine(l));
  if (used.length > MAX_RX_LINES) return { key: 'rx.err.tooMany' };
  const lines: RxLine[] = [];
  for (const [i, l] of used.entries()) {
    const form = oneOf(MEDICINE_FORMS, l.form);
    const frequency = oneOf(FREQUENCIES, l.frequency);
    const medicine = l.medicine.trim().replace(/\s+/g, ' ');
    const dose = l.dose.trim();
    if (!medicine || medicine.length > 160 || !form || !dose || dose.length > 60 || !frequency) return { key: 'rx.err.line', line: i + 1 };
    lines.push({
      medicine,
      form,
      dose,
      frequency,
      timing: oneOf(TIMINGS, l.timing),
      duration: trimOrNull(l.duration, 60),
      instructions: trimOrNull(l.instructions, 200),
    });
  }
  return { lines, notes: trimOrNull(input.notes, 500) };
}

export function validateLab(input: LabInput): { items: { code: string | null; name: string | null }[]; notes: string | null } | OrderProblem {
  const codes = [...new Set(input.codes)];
  if (codes.some((c) => !labTest(c))) return { key: 'lab.err.unknown' };
  const other = [...new Set(input.other.split(/\r?\n/).map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean))];
  if (other.some((s) => s.length > 120)) return { key: 'lab.err.tooLong' };
  const items = [...codes.map((code) => ({ code, name: null })), ...other.map((name) => ({ code: null, name }))];
  if (items.length > MAX_LAB_ITEMS) return { key: 'lab.err.tooMany' };
  return { items, notes: trimOrNull(input.notes, 500) };
}

const isProblem = (x: object): x is OrderProblem => 'key' in x;

async function insertPrescription(tx: Queryable, doctorId: string, encounterId: string, rx: { lines: RxLine[]; notes: string | null }): Promise<string> {
  const { rows } = await tx.query<{ id: string }>('insert into prescriptions (encounter_id, doctor_id, notes) values ($1, $2, $3) returning id', [encounterId, doctorId, rx.notes]);
  const id = rows[0]!.id;
  for (const [i, l] of rx.lines.entries()) {
    await tx.query(
      `insert into prescription_items (prescription_id, position, medicine, form, dose, frequency, timing, duration, instructions)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, i + 1, l.medicine, l.form, l.dose, l.frequency, l.timing, l.duration, l.instructions],
    );
    // Learn the doctor's own medicine list for suggestions next time.
    await tx.query(
      `insert into doctor_medicines (doctor_id, name, form) values ($1, $2, $3)
       on conflict (doctor_id, name_key, form) do update set use_count = doctor_medicines.use_count + 1, last_used_at = now(), name = excluded.name`,
      [doctorId, l.medicine, l.form],
    );
  }
  return id;
}

async function insertLabOrder(tx: Queryable, doctorId: string, encounterId: string, lab: { items: { code: string | null; name: string | null }[]; notes: string | null }): Promise<string> {
  const { rows } = await tx.query<{ id: string }>('insert into lab_orders (encounter_id, doctor_id, notes) values ($1, $2, $3) returning id', [encounterId, doctorId, lab.notes]);
  const id = rows[0]!.id;
  for (const [i, item] of lab.items.entries()) {
    await tx.query('insert into lab_order_items (lab_order_id, position, test_code, test_name) values ($1, $2, $3, $4)', [id, i + 1, item.code, item.name]);
  }
  return id;
}

// ---------------------------------------------------------------- visits

export interface VisitNotesInput {
  complaint: string;
  history: string;
  examination: string;
  diagnosis: string;
  plan: string;
}

export interface VisitErrors {
  general?: MessageKey;
  fields?: FieldErrors;
  rx?: OrderProblem;
  lab?: OrderProblem;
}

function cleanNotes(n: VisitNotesInput): { errors: FieldErrors; notes: { complaint: string; history: string | null; examination: string | null; diagnosis: string | null; plan: string | null } } {
  const errors: FieldErrors = {};
  const complaint = n.complaint.trim();
  if (!complaint || complaint.length > 500) errors['complaint'] = 'visit.err.complaint';
  return {
    errors,
    notes: { complaint: complaint.slice(0, 500), history: trimOrNull(n.history, 4000), examination: trimOrNull(n.examination, 4000), diagnosis: trimOrNull(n.diagnosis, 1000), plan: trimOrNull(n.plan, 4000) },
  };
}

/** One visit with, optionally, a prescription and a lab order — all saved together or not at all. */
export async function createVisit(
  deps: Deps,
  doctorId: string,
  recordId: string,
  input: { notes: VisitNotesInput; appointmentId: string | null; rx: RxInput; lab: LabInput },
  ip: string,
): Promise<{ id: string } | { errors: VisitErrors }> {
  const { errors: fieldErrors, notes } = cleanNotes(input.notes);
  const rx = validateRx(input.rx);
  const lab = validateLab(input.lab);
  const errors: VisitErrors = {};
  if (Object.keys(fieldErrors).length) errors.fields = fieldErrors;
  if (isProblem(rx)) errors.rx = rx;
  if (isProblem(lab)) errors.lab = lab;
  if (errors.fields || errors.rx || errors.lab || isProblem(rx) || isProblem(lab)) return { errors };
  return deps.db.transaction(async (tx) => {
    const rec = await tx.query<{ patient_user_id: string | null }>('select patient_user_id from patient_records where id = $1 and doctor_id = $2', [recordId, doctorId]);
    if (!rec.rows[0]) throw notFound();
    let clinicId: string | null = null;
    let visitAt: Date | null = null;
    if (input.appointmentId) {
      const appt = await tx.query<{ clinic_id: string; starts_at: Date; patient_id: string }>(
        'select clinic_id, starts_at, patient_id from appointments where id = $1 and doctor_id = $2',
        [input.appointmentId, doctorId],
      );
      // The appointment must be this doctor's and for the patient this file belongs to.
      if (!appt.rows[0] || appt.rows[0].patient_id !== rec.rows[0].patient_user_id) throw notFound();
      clinicId = appt.rows[0].clinic_id;
      visitAt = appt.rows[0].starts_at;
      const taken = await tx.query('select 1 from encounters where appointment_id = $1', [input.appointmentId]);
      if (taken.rows[0]) return { errors: { general: 'visit.err.appointmentUsed' } };
    }
    const { rows } = await tx.query<{ id: string }>(
      `insert into encounters (record_id, doctor_id, appointment_id, clinic_id, visit_at, chief_complaint, history, examination, diagnosis, plan)
       values ($1, $2, $3, $4, coalesce($5::timestamptz, now()), $6, $7, $8, $9, $10) returning id`,
      [recordId, doctorId, input.appointmentId, clinicId, visitAt, notes.complaint, notes.history, notes.examination, notes.diagnosis, notes.plan],
    );
    const id = rows[0]!.id;
    await tx.query('update patient_records set updated_at = now() where id = $1', [recordId]);
    await audit(tx, { actorId: doctorId, action: 'visit.create', entityType: 'encounter', entityId: id, ip });
    if (rx.lines.length) {
      const rxId = await insertPrescription(tx, doctorId, id, rx);
      await audit(tx, { actorId: doctorId, action: 'prescription.issue', entityType: 'prescription', entityId: rxId, ip });
    }
    if (lab.items.length) {
      const labId = await insertLabOrder(tx, doctorId, id, lab);
      await audit(tx, { actorId: doctorId, action: 'lab_order.issue', entityType: 'lab_order', entityId: labId, ip });
    }
    return { id };
  });
}

export async function updateVisitNotes(deps: Deps, doctorId: string, encounterId: string, input: VisitNotesInput, ip: string): Promise<FieldErrors | null> {
  const { errors, notes } = cleanNotes(input);
  if (Object.keys(errors).length) return errors;
  await deps.db.transaction(async (tx) => {
    const old = await tx.query<Record<string, unknown>>(
      'select chief_complaint, history, examination, diagnosis, plan, updated_at from encounters where id = $1 and doctor_id = $2 for update',
      [encounterId, doctorId],
    );
    if (!old.rows[0]) throw notFound();
    await tx.query(`insert into record_revisions (entity_type, entity_id, doctor_id, data) values ('encounter', $1, $2, $3)`, [encounterId, doctorId, old.rows[0]]);
    await tx.query(
      'update encounters set chief_complaint = $3, history = $4, examination = $5, diagnosis = $6, plan = $7, updated_at = now() where id = $1 and doctor_id = $2',
      [encounterId, doctorId, notes.complaint, notes.history, notes.examination, notes.diagnosis, notes.plan],
    );
    await audit(tx, { actorId: doctorId, action: 'visit.update', entityType: 'encounter', entityId: encounterId, ip });
  });
  return null;
}

async function ownEncounter(db: Queryable, doctorId: string, encounterId: string): Promise<void> {
  const r = await db.query('select 1 from encounters where id = $1 and doctor_id = $2', [encounterId, doctorId]);
  if (!r.rows[0]) throw notFound();
}

export async function addPrescription(deps: Deps, doctorId: string, encounterId: string, input: RxInput, ip: string): Promise<OrderProblem | null> {
  const rx = validateRx(input);
  if (isProblem(rx)) return rx;
  if (!rx.lines.length) return { key: 'rx.err.empty' };
  return deps.db.transaction(async (tx) => {
    await ownEncounter(tx, doctorId, encounterId);
    const id = await insertPrescription(tx, doctorId, encounterId, rx);
    await audit(tx, { actorId: doctorId, action: 'prescription.issue', entityType: 'prescription', entityId: id, ip });
    return null;
  });
}

export async function addLabOrder(deps: Deps, doctorId: string, encounterId: string, input: LabInput, ip: string): Promise<OrderProblem | null> {
  const lab = validateLab(input);
  if (isProblem(lab)) return lab;
  if (!lab.items.length) return { key: 'lab.err.empty' };
  return deps.db.transaction(async (tx) => {
    await ownEncounter(tx, doctorId, encounterId);
    const id = await insertLabOrder(tx, doctorId, encounterId, lab);
    await audit(tx, { actorId: doctorId, action: 'lab_order.issue', entityType: 'lab_order', entityId: id, ip });
    return null;
  });
}

/** Cancel an issued prescription or lab order. Returns the visit it belongs to. */
export async function voidOrder(deps: Deps, doctorId: string, kind: 'prescription' | 'lab_order', id: string, reason: string, ip: string): Promise<{ encounterId: string } | { error: MessageKey; encounterId: string }> {
  const table = kind === 'prescription' ? 'prescriptions' : 'lab_orders';
  return deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ encounter_id: string; status: string }>(`select encounter_id, status from ${table} where id = $1 and doctor_id = $2 for update`, [id, doctorId]);
    const row = rows[0];
    if (!row) throw notFound();
    const why = reason.trim();
    if (why.length < 3) return { error: 'rx.err.voidReason', encounterId: row.encounter_id };
    if (row.status === 'voided') return { encounterId: row.encounter_id };
    await tx.query(`update ${table} set status = 'voided', void_reason = $3, voided_at = now() where id = $1 and doctor_id = $2`, [id, doctorId, why.slice(0, 300)]);
    await audit(tx, { actorId: doctorId, action: `${kind}.void`, entityType: kind, entityId: id, ip });
    return { encounterId: row.encounter_id };
  });
}

// ---------------------------------------------------------------- reading visits and orders

export interface PrescriptionView {
  id: string;
  encounter_id: string;
  notes: string | null;
  status: 'active' | 'voided';
  void_reason: string | null;
  voided_at: Date | null;
  issued_at: Date;
  items: (RxLine & { position: number })[];
}

export interface LabOrderView {
  id: string;
  encounter_id: string;
  notes: string | null;
  status: 'active' | 'voided';
  void_reason: string | null;
  voided_at: Date | null;
  issued_at: Date;
  items: { position: number; test_code: string | null; test_name: string | null }[];
}

async function prescriptionsFor(db: Queryable, where: string, params: unknown[]): Promise<PrescriptionView[]> {
  const { rows } = await db.query<Omit<PrescriptionView, 'items'>>(
    `select p.id, p.encounter_id, p.notes, p.status, p.void_reason, p.voided_at, p.issued_at from prescriptions p where ${where} order by p.issued_at`,
    params,
  );
  if (!rows.length) return [];
  const items = await db.query<RxLine & { position: number; prescription_id: string }>(
    `select prescription_id, position, medicine, form, dose, frequency, timing, duration, instructions
       from prescription_items where prescription_id = any($1::uuid[]) order by position`,
    [rows.map((r) => r.id)],
  );
  return rows.map((r) => ({ ...r, items: items.rows.filter((i) => i.prescription_id === r.id) }));
}

async function labOrdersFor(db: Queryable, where: string, params: unknown[]): Promise<LabOrderView[]> {
  const { rows } = await db.query<Omit<LabOrderView, 'items'>>(
    `select l.id, l.encounter_id, l.notes, l.status, l.void_reason, l.voided_at, l.issued_at from lab_orders l where ${where} order by l.issued_at`,
    params,
  );
  if (!rows.length) return [];
  const items = await db.query<LabOrderView['items'][number] & { lab_order_id: string }>(
    'select lab_order_id, position, test_code, test_name from lab_order_items where lab_order_id = any($1::uuid[]) order by position',
    [rows.map((r) => r.id)],
  );
  return rows.map((r) => ({ ...r, items: items.rows.filter((i) => i.lab_order_id === r.id) }));
}

export interface VisitSummary {
  id: string;
  visit_at: Date;
  chief_complaint: string;
  diagnosis: string | null;
  clinic_name: string | null;
  prescriptions: number;
  lab_orders: number;
}

export async function listVisits(db: Queryable, doctorId: string, recordId: string): Promise<VisitSummary[]> {
  const { rows } = await db.query<VisitSummary>(
    `select e.id, e.visit_at, e.chief_complaint, e.diagnosis, c.name as clinic_name,
            (select count(*)::int from prescriptions p where p.encounter_id = e.id and p.status = 'active') as prescriptions,
            (select count(*)::int from lab_orders l where l.encounter_id = e.id and l.status = 'active') as lab_orders
       from encounters e left join clinics c on c.id = e.clinic_id
      where e.record_id = $1 and e.doctor_id = $2
      order by e.visit_at desc`,
    [recordId, doctorId],
  );
  return rows;
}

export interface VisitDetail {
  id: string;
  record_id: string;
  appointment_id: string | null;
  visit_at: Date;
  clinic_name: string | null;
  chief_complaint: string;
  history: string | null;
  examination: string | null;
  diagnosis: string | null;
  plan: string | null;
  updated_at: Date;
  created_at: Date;
  prescriptions: PrescriptionView[];
  labOrders: LabOrderView[];
}

export async function getVisit(db: Queryable, doctorId: string, encounterId: string): Promise<VisitDetail> {
  const { rows } = await db.query<Omit<VisitDetail, 'prescriptions' | 'labOrders'>>(
    `select e.id, e.record_id, e.appointment_id, e.visit_at, c.name as clinic_name, e.chief_complaint, e.history, e.examination,
            e.diagnosis, e.plan, e.updated_at, e.created_at
       from encounters e left join clinics c on c.id = e.clinic_id where e.id = $1 and e.doctor_id = $2`,
    [encounterId, doctorId],
  );
  if (!rows[0]) throw notFound();
  const [prescriptions, labOrders] = await Promise.all([
    prescriptionsFor(db, 'p.encounter_id = $1 and p.doctor_id = $2', [encounterId, doctorId]),
    labOrdersFor(db, 'l.encounter_id = $1 and l.doctor_id = $2', [encounterId, doctorId]),
  ]);
  return { ...rows[0], prescriptions, labOrders };
}

/** Everything needed to print a prescription or lab order. */
export interface PrintHeader {
  doctor_name: string;
  doctor_title_en: string;
  doctor_title_ar: string;
  specialty_id: number;
  clinic_name: string | null;
  clinic_address: string | null;
  clinic_phone: string | null;
  patient_name: string;
  date_of_birth: string | null;
  sex: string | null;
  visit_at: Date;
}

const PRINT_HEADER = `select u.full_name as doctor_name, d.title_en as doctor_title_en, d.title_ar as doctor_title_ar, d.specialty_id,
    c.name as clinic_name, c.address as clinic_address, c.phone_e164 as clinic_phone,
    r.full_name as patient_name, r.date_of_birth::text as date_of_birth, r.sex, e.visit_at
  from encounters e
  join patient_records r on r.id = e.record_id
  join doctors d on d.user_id = e.doctor_id
  join users u on u.id = e.doctor_id
  left join clinics c on c.id = e.clinic_id`;

type Viewer = { doctorId: string } | { patientId: string };

/** The doctor who wrote it, or the patient whose account the file is linked to. Anyone else: not found. */
function viewerFilter(v: Viewer, alias: string): { sql: string; param: string } {
  return 'doctorId' in v
    ? { sql: `${alias}.doctor_id = $2`, param: v.doctorId }
    : { sql: `exists (select 1 from encounters e2 join patient_records r2 on r2.id = e2.record_id where e2.id = ${alias}.encounter_id and r2.patient_user_id = $2)`, param: v.patientId };
}

export async function getPrescriptionForPrint(db: Queryable, viewer: Viewer, id: string): Promise<{ header: PrintHeader; rx: PrescriptionView }> {
  const f = viewerFilter(viewer, 'p');
  const [rx] = await prescriptionsFor(db, `p.id = $1 and ${f.sql}`, [id, f.param]);
  if (!rx) throw notFound();
  const { rows } = await db.query<PrintHeader>(`${PRINT_HEADER} where e.id = $1`, [rx.encounter_id]);
  return { header: rows[0]!, rx };
}

export async function getLabOrderForPrint(db: Queryable, viewer: Viewer, id: string): Promise<{ header: PrintHeader; lab: LabOrderView }> {
  const f = viewerFilter(viewer, 'l');
  const [lab] = await labOrdersFor(db, `l.id = $1 and ${f.sql}`, [id, f.param]);
  if (!lab) throw notFound();
  const { rows } = await db.query<PrintHeader>(`${PRINT_HEADER} where e.id = $1`, [lab.encounter_id]);
  return { header: rows[0]!, lab };
}

/** The doctor's own medicines, most used first, for the type-ahead list. */
export async function listDoctorMedicines(db: Queryable, doctorId: string): Promise<{ name: string; form: string }[]> {
  const { rows } = await db.query<{ name: string; form: string }>(
    'select name, form from doctor_medicines where doctor_id = $1 order by use_count desc, last_used_at desc limit 1500',
    [doctorId],
  );
  return rows;
}

// ---------------------------------------------------------------- admin

export async function setRecordsEnabled(deps: Deps, adminId: string, doctorId: string, on: boolean, ip: string): Promise<void> {
  const r = await deps.db.query('update doctors set records_enabled = $2, updated_at = now() where user_id = $1', [doctorId, on]);
  if (r.rowCount === 0) throw notFound();
  await audit(deps.db, { actorId: adminId, action: on ? 'records.enable' : 'records.disable', entityType: 'doctor', entityId: doctorId, ip });
}
