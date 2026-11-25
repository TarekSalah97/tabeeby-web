import type { Queryable } from '../db/db.js';

export interface Named {
  id: number;
  slug: string;
  name_en: string;
  name_ar: string;
}
export interface Specialty extends Named {
  kind: 'medical' | 'dental';
  subspecialties: (Named & { specialty_id: number })[];
}
export interface District extends Named {
  governorate_id: number;
  governorate_en: string;
  governorate_ar: string;
}
export interface Governorate extends Named {
  /** Its districts / cities, ordered by English name (views re-sort for the reader's language). */
  districts: District[];
}
export interface ConditionKeyword {
  term_en: string;
  term_ar: string;
  specialty_id: number;
  subspecialty_id: number | null;
}

export interface ReferenceData {
  specialties: Specialty[];
  /** Active governorates in display order (launch city first), each with its districts. */
  governorates: Governorate[];
  districts: District[];
  insurers: Named[];
  conditions: ConditionKeyword[];
  specialtyById: Map<number, Specialty>;
  districtById: Map<number, District>;
  governorateById: Map<number, Governorate>;
  subspecialtyById: Map<number, Named & { specialty_id: number }>;
}

let cache: { at: number; data: ReferenceData } | null = null;
const TTL_MS = 5 * 60_000;

/** Reference lists change rarely; cache them per process for a few minutes. */
export async function getReference(db: Queryable): Promise<ReferenceData> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const [specs, subs, districts, insurers, conditions, govs] = await Promise.all([
    db.query<Omit<Specialty, 'subspecialties'>>('select id, slug, kind, name_en, name_ar from specialties order by sort, id'),
    db.query<Named & { specialty_id: number }>('select id, slug, specialty_id, name_en, name_ar from subspecialties order by id'),
    db.query<District>(
      `select d.id, d.slug, d.governorate_id, d.name_en, d.name_ar, g.name_en as governorate_en, g.name_ar as governorate_ar from districts d
         join governorates g on g.id = d.governorate_id where g.is_active order by g.sort, g.id, d.name_en`,
    ),
    db.query<Named>('select id, slug, name_en, name_ar from insurers order by name_en'),
    db.query<ConditionKeyword>('select term_en, term_ar, specialty_id, subspecialty_id from condition_keywords'),
    db.query<Named>('select id, slug, name_en, name_ar from governorates where is_active order by sort, id'),
  ]);
  const governorates: Governorate[] = govs.rows.map((g) => ({ ...g, districts: districts.rows.filter((d) => d.governorate_id === g.id) }));
  const specialties: Specialty[] = specs.rows.map((s) => ({ ...s, subspecialties: subs.rows.filter((x) => x.specialty_id === s.id) }));
  const data: ReferenceData = {
    specialties,
    governorates,
    districts: districts.rows,
    insurers: insurers.rows,
    conditions: conditions.rows,
    specialtyById: new Map(specialties.map((s) => [s.id, s])),
    districtById: new Map(districts.rows.map((d) => [d.id, d])),
    governorateById: new Map(governorates.map((g) => [g.id, g])),
    subspecialtyById: new Map(subs.rows.map((s) => [s.id, s])),
  };
  cache = { at: Date.now(), data };
  return data;
}

export function clearReferenceCache(): void {
  cache = null;
}
