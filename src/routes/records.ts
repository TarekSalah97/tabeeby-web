import type { Router } from '../http/router.js';
import type { Ctx } from '../http/context.js';
import { href, requireUser } from '../http/context.js';
import { sendHtml, redirect } from '../http/respond.js';
import { fieldAll } from '../http/body.js';
import { notFound } from '../http/errors.js';
import { isUuid } from '../http/router.js';
import type { SessionUser } from '../auth/sessions.js';
import { getOwnDoctor, type OwnDoctor } from '../services/doctors.js';
import { getReference } from '../services/reference.js';
import {
  listRecords, getRecord, createRecord, updateRecord, linkRecord, fileForAppointment, auditRecordView, listVisits, getVisit,
  createVisit, updateVisitNotes, addPrescription, addLabOrder, voidOrder, getPrescriptionForPrint, getLabOrderForPrint,
  listPatientDocuments, listDoctorMedicines, type RecordInput, type RxInput, type LabInput, type VisitNotesInput,
} from '../services/records.js';
import {
  patientsListPage, newRecordPage, editRecordPage, recordPage, recordValuesFrom, newVisitPage, visitPage,
  prescriptionPrintPage, labOrderPrintPage, patientDocumentsPage, type RxFormValues, type LabFormValues,
} from '../views/pages/records.js';
import { requireDoctor } from './dashboard.js';
import { formValue, noticeFrom, errorFrom, uuidParam } from './helpers.js';

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
  const [record, medicines] = await Promise.all([getRecord(db, d.user.id, visit.record_id), listDoctorMedicines(db, d.user.id)]);
  const notice = noticeFrom(ctx);
  sendHtml(ctx, status, visitPage(ctx, d.doctor, record, visit, { medicines, notice: notice ? { kind: 'success', key: notice } : undefined, error: errorFrom(ctx), ...extra }));
}

export function recordsRoutes(r: Router): void {
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
    if (f.kind === 'existing') return redirect(ctx, href(ctx, `/dashboard/patients/${f.recordId}/visits/new`, { appointment: ctx.params['id'] }));
    sendHtml(ctx, 200, newRecordPage(ctx, d.doctor, { values: { fullName: f.patientName, phone: '0' + f.patientPhone.slice(3) }, habits: [], appointment: f, linkError: errorFrom(ctx) }));
  });

  r.post('/dashboard/patients', async (ctx) => {
    const d = await recordsDoctor(ctx);
    if (!d) return;
    const { input, values, habits } = recordForm(ctx);
    const appointmentId = optionalUuid(formValue(ctx, 'appointment'));
    const result = await createRecord(ctx.deps, d.user.id, input, { consent: values['consent'] === 'yes', appointmentId }, ctx.ip);
    if ('errors' in result) {
      const appointment = appointmentId ? await fileForAppointment(ctx.deps.db, d.user.id, appointmentId) : null;
      return sendHtml(ctx, 422, newRecordPage(ctx, d.doctor, { values, habits, errors: result.errors, appointment: appointment?.kind === 'new' ? appointment : undefined }));
    }
    redirect(ctx, appointmentId
      ? href(ctx, `/dashboard/patients/${result.id}/visits/new`, { appointment: appointmentId })
      : href(ctx, `/dashboard/patients/${result.id}`, { ok: 'fileCreated' }));
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
    sendHtml(ctx, 200, newVisitPage(ctx, d.doctor, record, { appointmentId, medicines: await listDoctorMedicines(ctx.deps.db, d.user.id) }));
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
    redirect(ctx, href(ctx, `/dashboard/visits/${result.id}`, { ok: 'visitSaved' }));
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
  r.get('/prescriptions', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    sendHtml(ctx, 200, patientDocumentsPage(ctx, await listPatientDocuments(ctx.deps.db, user.id)));
  });

  r.get('/prescriptions/:id', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const { header, rx } = await getPrescriptionForPrint(ctx.deps.db, { patientId: user.id }, uuidParam(ctx, 'id'));
    if (rx.status !== 'active') throw notFound();
    sendHtml(ctx, 200, prescriptionPrintPage(ctx, await getReference(ctx.deps.db), header, rx, href(ctx, '/prescriptions')));
  });

  r.get('/lab-orders/:id', async (ctx) => {
    const user = requireUser(ctx, 'patient');
    const { header, lab } = await getLabOrderForPrint(ctx.deps.db, { patientId: user.id }, uuidParam(ctx, 'id'));
    if (lab.status !== 'active') throw notFound();
    sendHtml(ctx, 200, labOrderPrintPage(ctx, await getReference(ctx.deps.db), header, lab, href(ctx, '/prescriptions')));
  });
}
