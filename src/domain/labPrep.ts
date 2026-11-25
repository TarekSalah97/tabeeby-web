import type { MessageKey } from '../i18n/index.js';
import { labTest } from './clinical.js';

/*
 * Standard patient preparation for the built-in tests, and the built-in quick sets doctors can tick.
 * The advice is deliberately general and conservative; the page always adds that the doctor's or the
 * centre's own instructions come first.
 */

const PREP: Readonly<Record<string, readonly MessageKey[]>> = {
  fbs: ['prep.fast8'],
  lipid: ['prep.fast9'],
  ppbs: ['prep.ppbs'],
  iron: ['prep.morning'],
  urine: ['prep.urine'],
  urine_culture: ['prep.urineCulture'],
  stool: ['prep.stool'],
  h_pylori: ['prep.hpylori'],
  us_abdomen: ['prep.fast6'],
  us_pelvis: ['prep.fullBladder'],
  xray_chest: ['prep.pregnancy'],
  xray_other: ['prep.pregnancy'],
  ct: ['prep.contrast', 'prep.pregnancy'],
  mri: ['prep.contrast', 'prep.mri'],
};

/** Preparation advice for a list of ordered items, without repeats, in a stable order. */
export function prepFor(items: readonly { test_code: string | null }[]): MessageKey[] {
  const out: MessageKey[] = [];
  for (const it of items) for (const k of (it.test_code && PREP[it.test_code]) || []) if (!out.includes(k)) out.push(k);
  return out;
}

/** A CT or MRI may use contrast dye, for which centres usually want a recent kidney test. */
export const mayNeedContrast = (items: readonly { test_code: string | null }[]): boolean => items.some((i) => i.test_code === 'ct' || i.test_code === 'mri');

/** A kidney-function test (built-in code, or a typed name mentioning creatinine). */
export function isKidneyTest(item: { test_code: string | null; test_name: string | null }): boolean {
  if (item.test_code) return item.test_code === 'kft';
  return /creatinin|كرياتين/i.test(item.test_name ?? '');
}

export interface BuiltInLabSet {
  id: string;
  label: MessageKey;
  codes: readonly string[];
}

export const BUILT_IN_LAB_SETS: readonly BuiltInLabSet[] = [
  { id: 'diabetes', label: 'labset.diabetes', codes: ['fbs', 'hba1c', 'kft', 'lipid', 'urine'] },
  { id: 'checkup', label: 'labset.checkup', codes: ['cbc', 'fbs', 'lipid', 'lft', 'kft', 'urine', 'vit_d'] },
  { id: 'preop', label: 'labset.preop', codes: ['cbc', 'pt_inr', 'kft', 'lft', 'rbs', 'hcv_ab', 'hbsag', 'ecg'] },
  { id: 'anaemia', label: 'labset.anaemia', codes: ['cbc', 'ferritin', 'iron', 'vit_b12'] },
  { id: 'thyroid', label: 'labset.thyroid', codes: ['tsh', 'ft4'] },
  { id: 'heart', label: 'labset.heart', codes: ['lipid', 'fbs', 'hba1c', 'kft', 'electrolytes', 'ecg'] },
];

// Fail fast at start-up if a built-in set names a test that is not in the list.
for (const s of BUILT_IN_LAB_SETS) for (const c of s.codes) if (!labTest(c)) throw new Error(`lab set ${s.id}: unknown test ${c}`);
