import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import { isUniqueViolation } from '../db/db.js';
import type { FieldErrors } from './accounts.js';
import { notFound } from '../http/errors.js';
import { parseFee } from './doctors.js';
import { audit } from './audit.js';

/*
 * Extra services a doctor offers at a clinic (besides the consultation and follow-up), each with
 * the doctor's own price. Patients choose one when booking; the price always comes from here.
 * Every change is scoped to the signed-in doctor's own clinics.
 */

export interface ClinicService {
  id: string;
  clinic_id: string;
  name: string;
  price_egp: number;
  is_active: boolean;
}

export const MAX_SERVICES_PER_CLINIC = 20;
export const SERVICE_NAME_MIN = 2;
export const SERVICE_NAME_MAX = 80;

/** All of the doctor's services (active and hidden), for the clinics settings page. */
export async function listDoctorServices(db: Queryable, doctorId: string): Promise<ClinicService[]> {
  const { rows } = await db.query<ClinicService>(
    `select s.id, s.clinic_id, s.name, s.price_egp, s.is_active from clinic_services s join clinics c on c.id = s.clinic_id
      where s.doctor_id = $1 and c.doctor_id = $1 order by s.is_active desc, s.created_at`,
    [doctorId],
  );
  return rows;
}

/** The services patients can book at these clinics. */
export async function activeServices(db: Queryable, clinicIds: string[]): Promise<ClinicService[]> {
  if (!clinicIds.length) return [];
  const ph = clinicIds.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await db.query<ClinicService>(
    `select id, clinic_id, name, price_egp, is_active from clinic_services where clinic_id in (${ph}) and is_active order by price_egp, name`,
    clinicIds,
  );
  return rows;
}

/** A service a patient (or the clinic) chose, checked against the clinic of the booking. */
export async function bookableService(db: Queryable, clinicId: string, serviceId: string): Promise<ClinicService | null> {
  const { rows } = await db.query<ClinicService>(
    'select id, clinic_id, name, price_egp, is_active from clinic_services where id = $1 and clinic_id = $2 and is_active',
    [serviceId, clinicId],
  );
  return rows[0] ?? null;
}

function validate(name: string, price: string): { errors: FieldErrors; name: string; price: number } {
  const errors: FieldErrors = {};
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length < SERVICE_NAME_MIN || clean.length > SERVICE_NAME_MAX) errors['serviceName'] = 'svc.err.name';
  const p = parseFee(price);
  if (Number.isNaN(p)) errors['servicePrice'] = 'clinics.feeInvalid';
  return { errors, name: clean, price: p };
}

export async function addService(deps: Deps, doctorId: string, clinicId: string, input: { name: string; price: string }, ip: string): Promise<FieldErrors | null> {
  const own = await deps.db.query('select 1 from clinics where id = $1 and doctor_id = $2', [clinicId, doctorId]);
  if (!own.rows.length) throw notFound();
  const v = validate(input.name, input.price);
  if (Object.keys(v.errors).length) return v.errors;
  try {
    return await deps.db.transaction(async (tx) => {
      // Serialise adds per clinic so the limit cannot be raced.
      await tx.query('select 1 from clinics where id = $1 for update', [clinicId]);
      const n = await tx.query<{ n: number }>('select count(*)::int as n from clinic_services where clinic_id = $1 and is_active', [clinicId]);
      if ((n.rows[0]?.n ?? 0) >= MAX_SERVICES_PER_CLINIC) return { serviceName: 'svc.err.tooMany' };
      const { rows } = await tx.query<{ id: string }>(
        'insert into clinic_services (clinic_id, doctor_id, name, price_egp) values ($1, $2, $3, $4) returning id',
        [clinicId, doctorId, v.name, v.price],
      );
      await audit(tx, { actorId: doctorId, action: 'service.add', entityType: 'clinic_service', entityId: rows[0]!.id, metadata: { price: v.price }, ip });
      return null;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { serviceName: 'svc.err.duplicate' };
    throw e;
  }
}

export async function updateService(
  deps: Deps,
  doctorId: string,
  serviceId: string,
  input: { name: string; price: string; active: boolean },
  ip: string,
): Promise<FieldErrors | null> {
  const v = validate(input.name, input.price);
  if (Object.keys(v.errors).length) return v.errors;
  try {
    const res = await deps.db.query(
      `update clinic_services set name = $3, price_egp = $4, is_active = $5, updated_at = now()
        where id = $1 and doctor_id = $2 and clinic_id in (select id from clinics where doctor_id = $2)`,
      [serviceId, doctorId, v.name, v.price, input.active],
    );
    if (!res.rowCount) throw notFound();
  } catch (e) {
    if (isUniqueViolation(e)) return { serviceName: 'svc.err.duplicate' };
    throw e;
  }
  // Price changes apply to new bookings only; existing visits keep the price they were booked at.
  await audit(deps.db, { actorId: doctorId, action: 'service.update', entityType: 'clinic_service', entityId: serviceId, metadata: { price: v.price, active: input.active }, ip });
  return null;
}
