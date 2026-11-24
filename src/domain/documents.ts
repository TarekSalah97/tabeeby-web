/**
 * Documents asked for at sign-up. Required ones must be uploaded to create the account; the
 * admin sees all of them before approving. Kinds match the database checks (migration 021).
 */
export type DoctorDocKind = 'syndicate_card' | 'national_id' | 'practice_licence' | 'specialty_certificate' | 'clinic_licence';
export type FacilityDocKind = 'licence' | 'manager_syndicate_card' | 'manager_national_id' | 'radiation_licence' | 'commercial_register' | 'tax_card';
export type DocKind = DoctorDocKind | FacilityDocKind;

export interface DocSpec<K extends DocKind = DocKind> {
  kind: K;
  required: boolean;
}

export const DOCTOR_DOCS: readonly DocSpec<DoctorDocKind>[] = [
  { kind: 'syndicate_card', required: true },
  { kind: 'national_id', required: true },
  { kind: 'practice_licence', required: false },
  { kind: 'specialty_certificate', required: false },
  { kind: 'clinic_licence', required: false },
];

export function facilityDocs(kind: string): readonly DocSpec<FacilityDocKind>[] {
  return [
    { kind: 'licence', required: true },
    { kind: 'manager_syndicate_card', required: true },
    { kind: 'manager_national_id', required: true },
    ...(kind === 'radiology' ? [{ kind: 'radiation_licence' as const, required: true }] : []),
    { kind: 'commercial_register', required: false },
    { kind: 'tax_card', required: false },
  ];
}

/** The form field name for a document (the first documents keep their original field names). */
export const docField = (kind: DocKind): string => (kind === 'syndicate_card' ? 'card' : kind === 'licence' ? 'licence' : `doc_${kind}`);
