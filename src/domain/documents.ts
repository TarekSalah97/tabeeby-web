/**
 * Documents asked for at sign-up. Required ones must be uploaded to create the account; the
 * admin sees all of them before approving. Kinds match the database checks (migration 021).
 */
export type DoctorDocKind = 'syndicate_card' | 'national_id' | 'practice_licence' | 'specialty_certificate' | 'clinic_licence';
export type FacilityDocKind = 'licence' | 'manager_syndicate_card' | 'manager_national_id' | 'radiation_licence' | 'commercial_register' | 'tax_card' | 'other';
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

/**
 * Documents for labs, pharmacies and scan centres. `required` means "needed before approval": nothing
 * blocks sign-up (any number of photos, any time), and the admin sees what is still missing.
 */
export function facilityDocs(kind: string): readonly DocSpec<FacilityDocKind>[] {
  return [
    { kind: 'licence', required: true },
    { kind: 'manager_syndicate_card', required: true },
    { kind: 'manager_national_id', required: true },
    ...(kind === 'radiology' ? [{ kind: 'radiation_licence' as const, required: true }] : []),
    { kind: 'commercial_register', required: false },
    { kind: 'tax_card', required: false },
    { kind: 'other', required: false },
  ];
}

export const FACILITY_DOC_KINDS: readonly FacilityDocKind[] = ['licence', 'manager_syndicate_card', 'manager_national_id', 'radiation_licence', 'commercial_register', 'tax_card', 'other'];
export const isFacilityDocKind = (k: string): k is FacilityDocKind => (FACILITY_DOC_KINDS as readonly string[]).includes(k);
/** Per document, and in all, so one place can't fill the storage. */
export const MAX_FILES_PER_DOC = 8;
export const MAX_FACILITY_FILES = 40;

/** The form field name for a document (the first documents keep their original field names). */
export const docField = (kind: DocKind): string => (kind === 'syndicate_card' ? 'card' : kind === 'licence' ? 'licence' : `doc_${kind}`);
