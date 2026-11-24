import { addVisitPhotos, listVisitPhotos, readVisitPhoto, removeVisitPhoto } from '../services/visitPhotos.js';
import { applyDocumentHeaders } from '../http/security.js';
import type { Router } from '../http/router.js';
import type { Ctx } from '../http/context.js';
import { href, requireUser } from '../http/context.js';
import { sendHtml, sendJson, redirect } from '../http/respond.js';
import { hitRateLimit } from '../auth/rateLimit.js';
import { assist } from '../services/demoAssistant.js';
import { doctorOrderResults } from '../services/orderResults.js';
import { checkLinkCode, confirmLinkCode } from '../services/accountLink.js';
import { fieldAll } from '../http/body.js';
import { notFound, tooManyRequests } from '../http/errors.js';
import { isUuid } from '../http/router.js';
import type { SessionUser } from '../auth/sessions.js';
import { getOwnDoctor, type OwnDoctor } from '../services/doctors.js';
import { getReference } from '../services/reference.js';
import {
  listRecords, getRecord, createRecord, updateRecord, linkRecord, fileForAppointment, auditRecordView, listVisits, getVisit,
  createVisit, updateVisitNotes, addPrescription, addLabOrder, voidOrder, getPrescriptionForPrint, getLabOrderForPrint,
  listDoctorMedicines, type RecordInput, type RxInput, type LabInput, type VisitNotesInput,
} from '../services/records.js';
import {
  patientsListPage, newRecordPage, editRecordPage, recordPage, recordValuesFrom, newVisitPage, visitPage,
  prescriptionPrintPage, labOrderPrintPage, type RxFormValues, type LabFormValues,
} from '../views/pages/records.js';
import { requireDoctor } from './dashboard.js';
import { formValue, noticeFrom, errorFrom, uuidParam } from './helpers.js';
import { patientGatePage } from '../views/pages/auth.js';

/** A signed-in doctor whose clinical records are switched on. Everyone else gets "not found". */
async function recordsDoctor(ctx: Ctx): Promise<{ user: SessionUser; doctor: OwnDoctor } | null> {
  const user = requireDoctor(ctx);
  if (!user) return null;
  const doctor = await getOwnDoctor(ctx.deps.db, user.id);
  if (!doctor.records_enabled) throw notFound();
  return { user, doctor };
}

const RECORD_FIELDS = ['fullName', 'phone', 'dateOfBirth', 'sex', 'occupation', 'maritalStatus', 'habitsNote', 'allergies',
  'chronicConditions', 'pastHistory', 'currentMedications', 'familyHistory', 'consent'] as const;

function recordForm(ctx: Ctx): { input: RecordInput; values: Record<string, string>; habits: string[] } {
  const values = Object.fromEntries(RECORD_FIELDS.map((k) => [k, formValue(ctx, k)]));
  const habits = fieldAll(ctx.form, 'habits');
  const input: RecordInput = {
    fullName: values['fullName']!, phone: values['phone']!, dateOfBirth: values['dateOfBirth']!, sex: values['sex']!,
    occupation: values['occupation']!, maritalStatus: values['maritalStatus']!, habits, habitsNote: values['habitsNote']!,
    allergies: values['allergies']!, chronicConditions: values['chronicConditions']!, pastHistory: values['pastHistory']!,
    currentMedications: values['currentMedications']!, familyHistory: values['familyHistory']!,
  };
  return { input, values, habits };
}

/** Medicine lines arrive as parallel lists (rx_medicine[i], rx_dose[i], …). */
function rxForm(ctx: Ctx): RxInput & RxFormValues {
  const col = (name: string) => ctx.form[name] ?? [];
  const cols = { medicine: col('rx_medicine'), form: col('rx_form'), dose: col('rx_dose'), frequency: col('rx_frequency'), timing: col('rx_timing'), duration: col('rx_duration'), instructions: col('rx_instructions') };
  const n = Math.min(40, Math.max(...Object.values(cols).map((c) => c.length), 0));
  const lines = Array.from({ length: n }, (_, i) => ({
    medicine: cols.medicine[i] ?? '', form: cols.form[i] ?? '', dose: cols.dose[i] ?? '', frequency: cols.frequency[i] ?? '',
    timing: cols.timing[i] ?? '', duration: cols.duration[i] ?? '', instructions: cols.instructions[i] ?? '',
  }));
  return { lines, notes: formValue(ctx, 'rx_notes') };
}

function labForm(ctx: Ctx): LabInput & LabFormValues {
  return { codes: fieldAll(ctx.form, 'lab_code'), other: formValue(ctx, 'lab_other'), notes: formValue(ctx, 'lab_notes') };
}

function notesForm(ctx: Ctx): VisitNotesInput {
  return { complaint: formValue(ctx, 'complaint'), history: formValue(ctx, 'history'), examination: formValue(ctx, 'examination'), diagnosis: formValue(ctx, 'diagnosis'), plan: formValue(ctx, 'plan') };
}

function optionalUuid(v: string | null | undefined): string | null {
  if (!v) return null;
  if (!isUuid(v)) throw notFound();
  return v;
}

async function renderVisit(ctx: Ctx, d: { user: SessionUser; doctor: OwnDoctor }, encounterId: string, extra: Partial<Parameters<typeof visitPage>[4]> = {}, status = 200): Promise<void> {
  const db = ctx.deps.db;
  const visit = await getVisit(db, d.user.id, encounterId);
  const [record, medicines, orderResults, photos] = await Promise.all([
    getRecord(db, d.user.id, visit.record_id),
    listDoctorMedicines(db, d.user.id),
    doctorOrderResults(db, d.user.id, visit.labOrders.map((l) => l.id)),
    listVisitPhotos(db, d.user.id, encounterId),
  ]);
  const notice = noticeFrom(ctx);
  sendHtml(ctx, status, visitPage(ctx, d.doctor, record, visit, { medicines, orderResults, photos, notice: notice ? { kind: 'success', key: notice } : undefined, error: errorFrom(ctx), ...extra }));
}

/** Whole years between a YYYY-MM-DD birth date and now. */
function ageYears(dob: string | null, now: Date): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age--;
  return age >= 0 && age < 130 ? age : null;
}

const ASSIST_FIELD_MAX = 4000;
const ASSIST_PER_HOUR = 60;

export function recordsRoutes(r: Router): void {
  // ---- DEMO ONLY: the fictional "Tabeeby AI" diagnosis helper. Does not exist on the live site.
  // The notes are read for this one request and never stored or logged.
  r.post('/dashboard/ai-assist', async (ctx) => {
    if (!ctx.deps.cfg.DEMO_MODE) throw notFound();
    const own = await recordsDoctor(ctx);
    if (!own) return;
    if (!(await hitRateLimit(ctx.deps.db, `ai-assist:${own.user.id}`, ASSIST_PER_HOUR, 3600))) throw tooManyRequests();
    const recordId = formValue(ctx, 'record');
    if (!isUuid(recordId)) throw notFound();
    const record = await getRecord(ctx.deps.db, own.user.id, recordId); // scoped to this doctor's own patients
    const field = (name: string) => formValue(ctx, name).slice(0, ASSIST_FIELD_MAX);
    sendJson(ctx, 200, assist({
      complaint: field('complaint'),
      history: field('history'),
      examination: field('examination'),
      patient: {
        ageYears: ageYears(record.date_of_birth, ctx.deps.now()),
        sex: record.sex,
        allergies: record.allergies,
        habits: record.habits,
        chronic: record.chronic_conditions,
        medications: record.current_medications,
      },
    }));
  });

  // ---- doctor: patient files
  r.get('/dashboard/patients', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const q = ctx.query.get('q') ?? '';
    const notice = noticeFrom(ctx);
    sendHtml(ctx, 200, patientsListPage(ctx, d.doctor, await listRecords(ctx.deps.db, d.user.id, q), q, notice ? { kind: 'success', key: notice } : undefined));
  });

  r.get('/dashboard/patients/new', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    sendHtml(ctx, 200, newRecordPage(ctx, d.doctor, { values: {}, habits: [] }));
  });

  r.get('/dashboard/appointments/:id/file', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const f = await fileForAppointment(ctx.deps.db, d.user.id, uuidParam(ctx, 'id'));
    if (f.kind === 'existing') return redirect(ctx, href(ctx, `/dashboard/patients/${f.recordId}/visits/new`, { appointment: ctx.params['id'], ...(f.matched ? { ok: 'fileFoundByPhone' } : {}) }));
    sendHtml(ctx, 200, newRecordPage(ctx, d.doctor, { values: { fullName: f.patientName, phone: '0' + f.patientPhone.slice(3) }, habits: [], appointment: f, linkError: errorFrom(ctx) }));
  });

  r.post('/dashboard/patients', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const { input, values, habits } = recordForm(ctx);
    const appointmentId = optionalUuid(formValue(ctx, 'appointment'));
    const newPerson = formValue(ctx, 'newPerson') === 'yes';
    const result = await createRecord(ctx.deps, d.user.id, input, { consent: values['consent'] === 'yes', appointmentId, newPerson }, ctx.ip);
    if ('errors' in result || 'samePhone' in result) {
      const appointment = appointmentId ? await fileForAppointment(ctx.deps.db, d.user.id, appointmentId) : null;
      return sendHtml(ctx, 422, newRecordPage(ctx, d.doctor, {
        values,
        habits,
        errors: 'errors' in result ? result.errors : undefined,
        samePhone: 'samePhone' in result ? result.samePhone : undefined,
        appointment: appointment?.kind === 'new' ? appointment : undefined,
      }));
    }
    // Same mobile and name: the existing file was opened and the new details were added to it.
    const ok = result.merged ? 'fileFoundByPhone' : 'fileCreated';
    redirect(ctx, appointmentId
      ? href(ctx, `/dashboard/patients/${result.id}/visits/new`, { appointment: appointmentId, ...(result.merged ? { ok } : {}) })
      : href(ctx, `/dashboard/patients/${result.id}`, { ok }));
  });

  r.get('/dashboard/patients/:id', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const id = uuidParam(ctx, 'id');
    const record = await getRecord(ctx.deps.db, d.user.id, id);
    await auditRecordView(ctx.deps.db, d.user.id, id, ctx.ip);
    const notice = noticeFrom(ctx);
    sendHtml(ctx, 200, recordPage(ctx, d.doctor, record, await listVisits(ctx.deps.db, d.user.id, id), notice ? { kind: 'success', key: notice } : undefined));
  });

  // ---- link a walk-in file to the patient's Tabeeby account with the code they show
  r.post('/dashboard/patients/:id/link-code', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const id = uuidParam(ctx, 'id');
    const check = await checkLinkCode(ctx.deps, d.user.id, id, formValue(ctx, 'code'));
    const record = await getRecord(ctx.deps.db, d.user.id, id);
    const visits = await listVisits(ctx.deps.db, d.user.id, id);
    if (!check.ok) return sendHtml(ctx, 422, recordPage(ctx, d.doctor, record, visits, { kind: 'error', key: check.error }));
    sendHtml(ctx, 200, recordPage(ctx, d.doctor, record, visits, undefined, { owner: check.owner, code: check.code }));
  });

  r.post('/dashboard/patients/:id/link-code/confirm', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const id = uuidParam(ctx, 'id');
    const problem = await confirmLinkCode(ctx.deps, d.user.id, id, formValue(ctx, 'code'), ctx.ip);
    if (problem) {
      const record = await getRecord(ctx.deps.db, d.user.id, id);
      return sendHtml(ctx, 422, recordPage(ctx, d.doctor, record, await listVisits(ctx.deps.db, d.user.id, id), { kind: 'error', key: problem }));
    }
    redirect(ctx, href(ctx, `/dashboard/patients/${id}`, { ok: 'fileLinkedByCode' }));
  });

  r.get('/dashboard/patients/:id/edit', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const record = await getRecord(ctx.deps.db, d.user.id, uuidParam(ctx, 'id'));
    sendHtml(ctx, 200, editRecordPage(ctx, d.doctor, record, { values: recordValuesFrom(record), habits: record.habits }));
  });

  r.post('/dashboard/patients/:id', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const id = uuidParam(ctx, 'id');
    const { input, values, habits } = recordForm(ctx);
    const problem = await updateRecord(ctx.deps, d.user.id, id, input, ctx.ip);
    if (problem) {
      const record = await getRecord(ctx.deps.db, d.user.id, id);
      return sendHtml(ctx, 422, editRecordPage(ctx, d.doctor, record, { values, habits, errors: problem.errors }));
    }
    redirect(ctx, href(ctx, `/dashboard/patients/${id}`, { ok: 'saved' }));
  });

  r.post('/dashboard/patients/:id/link', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const id = uuidParam(ctx, 'id');
    const appointmentId = optionalUuid(formValue(ctx, 'appointment'));
    if (!appointmentId) throw notFound();
    const problem = await linkRecord(ctx.deps, d.user.id, id, appointmentId, ctx.ip);
    if (problem) return redirect(ctx, href(ctx, `/dashboard/appointments/${appointmentId}/file`, { error: problem }));
    redirect(ctx, href(ctx, `/dashboard/patients/${id}/visits/new`, { appointment: appointmentId }));
  });

  // ---- doctor: visits
  r.get('/dashboard/patients/:id/visits/new', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const record = await getRecord(ctx.deps.db, d.user.id, uuidParam(ctx, 'id'));
    const appointmentId = optionalUuid(ctx.query.get('appointment'));
    sendHtml(ctx, 200, newVisitPage(ctx, d.doctor, record, { appointmentId, medicines: await listDoctorMedicines(ctx.deps.db, d.user.id), notice: noticeFrom(ctx) }));
  });

  r.post('/dashboard/patients/:id/visits', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const id = uuidParam(ctx, 'id');
    const appointmentId = optionalUuid(formValue(ctx, 'appointment'));
    const notes = notesForm(ctx);
    const rx = rxForm(ctx);
    const lab = labForm(ctx);
    const result = await createVisit(ctx.deps, d.user.id, id, { notes, appointmentId, rx, lab }, ctx.ip);
    if ('errors' in result) {
      const [record, medicines] = await Promise.all([getRecord(ctx.deps.db, d.user.id, id), listDoctorMedicines(ctx.deps.db, d.user.id)]);
      return sendHtml(ctx, 422, newVisitPage(ctx, d.doctor, record, { appointmentId, notes, rx, lab, errors: result.errors, medicines }));
    }
    // Photos chosen on the new-visit form are added once the visit exists.
    const photoError = ctx.files.some((f) => f.field === 'photos' && f.data.length > 0)
      ? await addVisitPhotos(ctx.deps, d.user.id, result.id, ctx.files, ctx.ip)
      : null;
    redirect(ctx, href(ctx, `/dashboard/visits/${result.id}`, photoError ? { error: photoError } : { ok: 'visitSaved' }));
  });

  r.post('/dashboard/visits/:id/photos', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const id = uuidParam(ctx, 'id');
    const err = await addVisitPhotos(ctx.deps, d.user.id, id, ctx.files, ctx.ip);
    redirect(ctx, href(ctx, `/dashboard/visits/${id}`, err ? { error: err } : { ok: 'photosAdded' }) + '#photos');
  });

  r.get('/dashboard/visit-photos/:id', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const photo = await readVisitPhoto(ctx.deps, d.user.id, uuidParam(ctx, 'id'));
    applyDocumentHeaders(ctx.res);
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', photo.mime);
    ctx.res.setHeader('Content-Disposition', 'inline');
    ctx.res.end(photo.data);
  });

  r.post('/dashboard/visit-photos/:id/remove', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const visitId = await removeVisitPhoto(ctx.deps, d.user.id, uuidParam(ctx, 'id'), ctx.ip);
    redirect(ctx, href(ctx, `/dashboard/visits/${visitId}`, { ok: 'photoRemovedVisit' }) + '#photos');
  });

  r.get('/dashboard/visits/:id', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (d) await renderVisit(ctx, d, uuidParam(ctx, 'id'));
  });

  r.post('/dashboard/visits/:id', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const id = uuidParam(ctx, 'id');
    const notes = notesForm(ctx);
    const errors = await updateVisitNotes(ctx.deps, d.user.id, id, notes, ctx.ip);
    if (errors) return renderVisit(ctx, d, id, { notesErrors: errors, notesValues: notes }, 422);
    redirect(ctx, href(ctx, `/dashboard/visits/${id}`, { ok: 'saved' }));
  });

  r.post('/dashboard/visits/:id/prescriptions', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const id = uuidParam(ctx, 'id');
    const rx = rxForm(ctx);
    const problem = await addPrescription(ctx.deps, d.user.id, id, rx, ctx.ip);
    if (problem) return renderVisit(ctx, d, id, { rx, rxError: problem }, 422);
    redirect(ctx, href(ctx, `/dashboard/visits/${id}`, { ok: 'rxIssued' }));
  });

  r.post('/dashboard/visits/:id/lab-orders', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const id = uuidParam(ctx, 'id');
    const lab = labForm(ctx);
    const problem = await addLabOrder(ctx.deps, d.user.id, id, lab, ctx.ip);
    if (problem) return renderVisit(ctx, d, id, { lab, labError: problem }, 422);
    redirect(ctx, href(ctx, `/dashboard/visits/${id}`, { ok: 'labIssued' }));
  });

  for (const [path, kind] of [['prescriptions', 'prescription'], ['lab-orders', 'lab_order']] as const) {
    r.post(`/dashboard/${path}/:id/void`, async (ctx) => {
      const d = await recordsDoctor(ctx);
      if (!d) return;
      const result = await voidOrder(ctx.deps, d.user.id, kind, uuidParam(ctx, 'id'), formValue(ctx, 'reason'), ctx.ip);
      redirect(ctx, href(ctx, `/dashboard/visits/${result.encounterId}`, 'error' in result ? { error: result.error } : { ok: 'voided' }));
    });
  }

  r.get('/dashboard/prescriptions/:id/print', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const { header, rx } = await getPrescriptionForPrint(ctx.deps.db, { doctorId: d.user.id }, uuidParam(ctx, 'id'));
    sendHtml(ctx, 200, prescriptionPrintPage(ctx, await getReference(ctx.deps.db), header, rx, href(ctx, `/dashboard/visits/${rx.encounter_id}`)));
  });

  r.get('/dashboard/lab-orders/:id/print', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const { header, lab } = await getLabOrderForPrint(ctx.deps.db, { doctorId: d.user.id }, uuidParam(ctx, 'id'));
    sendHtml(ctx, 200, labOrderPrintPage(ctx, await getReference(ctx.deps.db), header, lab, href(ctx, `/dashboard/visits/${lab.encounter_id}`)));
  });

  // ---- patient: their own prescriptions and lab orders (never the doctor's notes)
  r.get('/prescriptions/:id', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const { header, rx } = await getPrescriptionForPrint(ctx.deps.db, { patientId: user.id }, uuidParam(ctx, 'id'));
    if (rx.status !== 'active') throw notFound();
    sendHtml(ctx, 200, prescriptionPrintPage(ctx, await getReference(ctx.deps.db), header, rx, href(ctx, '/health-record')));
  });

  r.get('/lab-orders/:id', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const { header, lab } = await getLabOrderForPrint(ctx.deps.db, { patientId: user.id }, uuidParam(ctx, 'id'));
    if (lab.status !== 'active') throw notFound();
    sendHtml(ctx, 200, labOrderPrintPage(ctx, await getReference(ctx.deps.db), header, lab, href(ctx, '/health-record'), true));
  });
}
