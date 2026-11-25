import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import { isUniqueViolation } from '../db/db.js';
import type { MessageKey } from '../i18n/index.js';
import { labTest } from '../domain/clinical.js';
import { BUILT_IN_LAB_SETS } from '../domain/labPrep.js';
import { notFound } from '../http/errors.js';
import { audit } from './audit.js';

/*
 * Quick lab sets: a doctor ticks "Diabetes follow-up" instead of eight separate tests.
 * Built-in sets live in the code; each doctor may also save their own (scoped to that doctor).
 * Sets only fill in the order form; the server expands them and validates every test as usual.
 */

export const MAX_SETS_PER_DOCTOR = 30;
const MAX_NAME = 60;

export interface DoctorLabSet {
  id: string;
  name: string;
  codes: string[];
  other_names: string[];
}

export async function listLabSets(db: Queryable, doctorId: string): Promise<DoctorLabSet[]> {
  const { rows } = await db.query<DoctorLabSet>(
    'select id, name, codes, other_names from doctor_lab_sets where doctor_id = $1 order by lower(name)',
    [doctorId],
  );
  return rows;
}

/**
 * Turns the ticked set ids ("builtin:<id>" or the doctor's own set id) into test codes and typed
 * test names. Unknown ids are ignored (a set may have been deleted in another tab).
 */
export async function expandLabSets(db: Queryable, doctorId: string, ids: readonly string[]): Promise<{ codes: string[]; names: string[] }> {
  const codes: string[] = [];
  const names: string[] = [];
  const own = ids.filter((i) => !i.startsWith('builtin:'));
  for (const id of ids) {
    const b = id.startsWith('builtin:') ? BUILT_IN_LAB_SETS.find((s) => s.id === id.slice(8)) : undefined;
    if (b) codes.push(...b.codes);
  }
  if (own.length) {
    const { rows } = await db.query<{ codes: string[]; other_names: string[] }>(
      `select codes, other_names from doctor_lab_sets where doctor_id = $1 and id::text = any($2::text[])`,
      [doctorId, own],
    );
    for (const r of rows) {
      codes.push(...r.codes);
      names.push(...r.other_names);
    }
  }
  return { codes: [...new Set(codes)], names: [...new Set(names)] };
}

export async function saveLabSet(
  deps: Deps,
  doctorId: string,
  input: { name: string; codes: readonly string[]; otherNames: readonly string[] },
  ip: string,
): Promise<MessageKey | null> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) return 'labset.err.name';
  if (name.length > MAX_NAME) return 'labset.err.nameLong';
  const codes = [...new Set(input.codes)].filter((c) => !!labTest(c));
  const otherNames = [...new Set(input.otherNames.map((s) => s.trim().replace(/\s+/g, ' ')).filter((s) => s && s.length <= 120))].slice(0, 20);
  if (!codes.length && !otherNames.length) return 'labset.err.empty';
  const { rows } = await deps.db.query<{ n: number }>('select count(*)::int as n from doctor_lab_sets where doctor_id = $1', [doctorId]);
  if ((rows[0]?.n ?? 0) >= MAX_SETS_PER_DOCTOR) return 'labset.err.tooMany';
  try {
    await deps.db.transaction(async (tx) => {
      const ins = await tx.query<{ id: string }>(
        'insert into doctor_lab_sets (doctor_id, name, codes, other_names) values ($1, $2, $3, $4) returning id',
        [doctorId, name, codes, otherNames],
      );
      await audit(tx, { actorId: doctorId, action: 'lab_set.create', entityType: 'doctor_lab_set', entityId: ins.rows[0]!.id, ip });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return 'labset.err.duplicate';
    throw e;
  }
  return null;
}

export async function deleteLabSet(deps: Deps, doctorId: string, id: string, ip: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const { rowCount } = await tx.query('delete from doctor_lab_sets where id = $1 and doctor_id = $2', [id, doctorId]);
    if (!rowCount) throw notFound();
    await audit(tx, { actorId: doctorId, action: 'lab_set.delete', entityType: 'doctor_lab_set', entityId: id, ip });
  });
}
