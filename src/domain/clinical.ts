/**
 * Fixed lists for patient files, prescriptions and lab orders, and pure helpers.
 * The database CHECK constraints in migrations/004_clinical_records.sql must list the same codes.
 */

export const SEXES = ['female', 'male'] as const;
export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed'] as const;
export const HABITS = ['smoking', 'ex_smoker', 'shisha', 'alcohol', 'caffeine', 'exercise'] as const;

export const MEDICINE_FORMS = [
  'tablet', 'capsule', 'syrup', 'suspension', 'drops', 'injection', 'cream', 'ointment', 'gel',
  'spray', 'inhaler', 'suppository', 'sachet', 'effervescent', 'lozenge', 'patch', 'mouthwash', 'other',
] as const;

export const FREQUENCIES = [
  'once_daily', 'twice_daily', 'three_daily', 'four_daily', 'every_4h', 'every_6h',
  'every_8h', 'every_12h', 'weekly', 'as_needed', 'single_dose', 'see_instructions',
] as const;

export const TIMINGS = ['after_meals', 'before_meals', 'with_meals', 'empty_stomach', 'morning', 'bedtime'] as const;

export type MedicineForm = (typeof MEDICINE_FORMS)[number];
export type Frequency = (typeof FREQUENCIES)[number];
export type Timing = (typeof TIMINGS)[number];

/**
 * Common tests a doctor can tick. Names are the standard ones used on Egyptian lab requests;
 * the Arabic keeps the usual English abbreviation because labs and patients use it.
 */
export interface LabTest {
  code: string;
  group: 'blood' | 'urine_stool' | 'imaging' | 'cardiac' | 'dental';
  en: string;
  ar: string;
}

export const LAB_TESTS: readonly LabTest[] = [
  { code: 'cbc', group: 'blood', en: 'Complete blood count (CBC)', ar: 'صورة دم كاملة (CBC)' },
  { code: 'esr', group: 'blood', en: 'ESR', ar: 'سرعة الترسيب (ESR)' },
  { code: 'crp', group: 'blood', en: 'C-reactive protein (CRP)', ar: 'بروتين سي التفاعلي (CRP)' },
  { code: 'fbs', group: 'blood', en: 'Fasting blood sugar', ar: 'سكر صائم' },
  { code: 'ppbs', group: 'blood', en: '2-hour post-prandial blood sugar', ar: 'سكر فاطر (بعد ساعتين)' },
  { code: 'rbs', group: 'blood', en: 'Random blood sugar', ar: 'سكر عشوائي' },
  { code: 'hba1c', group: 'blood', en: 'HbA1c', ar: 'السكر التراكمي (HbA1c)' },
  { code: 'lipid', group: 'blood', en: 'Lipid profile', ar: 'دهون الدم (Lipid profile)' },
  { code: 'lft', group: 'blood', en: 'Liver function tests (ALT, AST, bilirubin, albumin)', ar: 'وظائف كبد' },
  { code: 'kft', group: 'blood', en: 'Kidney function tests (urea, creatinine)', ar: 'وظائف كلى (يوريا، كرياتينين)' },
  { code: 'uric_acid', group: 'blood', en: 'Uric acid', ar: 'حمض اليوريك' },
  { code: 'electrolytes', group: 'blood', en: 'Electrolytes (Na, K)', ar: 'أملاح (صوديوم، بوتاسيوم)' },
  { code: 'calcium', group: 'blood', en: 'Calcium', ar: 'كالسيوم' },
  { code: 'tsh', group: 'blood', en: 'TSH', ar: 'هرمون الغدة الدرقية (TSH)' },
  { code: 'ft4', group: 'blood', en: 'Free T4', ar: 'هرمون الغدة (Free T4)' },
  { code: 'vit_d', group: 'blood', en: 'Vitamin D (25-OH)', ar: 'فيتامين د' },
  { code: 'vit_b12', group: 'blood', en: 'Vitamin B12', ar: 'فيتامين ب١٢' },
  { code: 'ferritin', group: 'blood', en: 'Ferritin', ar: 'مخزون الحديد (Ferritin)' },
  { code: 'iron', group: 'blood', en: 'Serum iron and TIBC', ar: 'حديد بالدم (Iron, TIBC)' },
  { code: 'pt_inr', group: 'blood', en: 'PT / INR', ar: 'سيولة الدم (PT/INR)' },
  { code: 'blood_group', group: 'blood', en: 'Blood group and Rh', ar: 'فصيلة الدم' },
  { code: 'hcv_ab', group: 'blood', en: 'HCV antibody', ar: 'فيروس سي (HCV Ab)' },
  { code: 'hbsag', group: 'blood', en: 'HBsAg', ar: 'فيروس بي (HBsAg)' },
  { code: 'hiv', group: 'blood', en: 'HIV antibody', ar: 'فيروس نقص المناعة (HIV)' },
  { code: 'h_pylori', group: 'blood', en: 'H. pylori (stool antigen)', ar: 'جرثومة المعدة (أنتيجين في البراز)' },
  { code: 'psa', group: 'blood', en: 'PSA', ar: 'PSA' },
  { code: 'beta_hcg', group: 'blood', en: 'Pregnancy test (β-hCG)', ar: 'اختبار حمل (β-hCG)' },
  { code: 'urine', group: 'urine_stool', en: 'Urine analysis', ar: 'تحليل بول' },
  { code: 'urine_culture', group: 'urine_stool', en: 'Urine culture', ar: 'مزرعة بول' },
  { code: 'stool', group: 'urine_stool', en: 'Stool analysis', ar: 'تحليل براز' },
  { code: 'ecg', group: 'cardiac', en: 'ECG', ar: 'رسم قلب (ECG)' },
  { code: 'echo', group: 'cardiac', en: 'Echocardiogram', ar: 'إيكو على القلب' },
  { code: 'xray_chest', group: 'imaging', en: 'Chest X-ray', ar: 'أشعة عادية على الصدر' },
  { code: 'xray_other', group: 'imaging', en: 'X-ray (see notes)', ar: 'أشعة عادية (انظر الملاحظات)' },
  { code: 'us_abdomen', group: 'imaging', en: 'Abdominal ultrasound', ar: 'سونار على البطن' },
  { code: 'us_pelvis', group: 'imaging', en: 'Pelvic ultrasound', ar: 'سونار على الحوض' },
  { code: 'ct', group: 'imaging', en: 'CT scan (see notes)', ar: 'أشعة مقطعية (انظر الملاحظات)' },
  { code: 'mri', group: 'imaging', en: 'MRI (see notes)', ar: 'رنين مغناطيسي (انظر الملاحظات)' },
  { code: 'xray_panoramic', group: 'dental', en: 'Panoramic dental X-ray', ar: 'أشعة بانوراما على الأسنان' },
  { code: 'xray_periapical', group: 'dental', en: 'Periapical dental X-ray', ar: 'أشعة صغيرة على السن' },
  { code: 'cbct', group: 'dental', en: 'Dental CBCT', ar: 'أشعة مقطعية على الفك (CBCT)' },
];

export const LAB_GROUPS = ['blood', 'urine_stool', 'cardiac', 'imaging', 'dental'] as const;

const LAB_BY_CODE = new Map(LAB_TESTS.map((t) => [t.code, t]));
export const labTest = (code: string): LabTest | undefined => LAB_BY_CODE.get(code);

/** Whole years between a date of birth and today (both 'YYYY-MM-DD'); null if unknown. */
export function ageOn(dateOfBirth: string | null, today: string): number | null {
  if (!dateOfBirth) return null;
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age < 0 ? null : age;
}
