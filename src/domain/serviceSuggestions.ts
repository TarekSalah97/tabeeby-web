/**
 * Common extra services per specialty, offered as suggestions when a doctor adds a service.
 * The doctor can type any name; these only save typing. [English, Arabic]
 */
export const SERVICE_SUGGESTIONS: Record<string, [string, string][]> = {
  dermatology: [['Laser hair removal session', 'جلسة ليزر لإزالة الشعر'], ['Botox', 'بوتوكس'], ['Filler', 'فيلر'], ['Chemical peel', 'تقشير كيميائي'], ['Plasma (PRP) session', 'جلسة بلازما'], ['Mole removal', 'إزالة حسنة'], ['Mesotherapy', 'ميزوثيرابي']],
  dentistry: [['Scaling and polishing', 'تنظيف جير وتلميع'], ['Filling', 'حشو'], ['Root canal treatment', 'علاج عصب'], ['Extraction', 'خلع'], ['Teeth whitening', 'تبييض الأسنان'], ['Braces check-up', 'متابعة تقويم'], ['Implant consultation', 'استشارة زراعة']],
  cardiology: [['Echocardiography', 'إيكو على القلب'], ['ECG', 'رسم قلب'], ['Stress test', 'رسم قلب بالمجهود'], ['24-hour Holter', 'هولتر 24 ساعة']],
  'internal-medicine': [['Abdominal ultrasound', 'سونار على البطن'], ['Fibroscan', 'فيبروسكان'], ['Diabetes check-up', 'متابعة السكر'], ['Home visit', 'زيارة منزلية']],
  pediatrics: [['Vaccination visit', 'زيارة تطعيم'], ['Newborn check-up', 'كشف حديثي الولادة'], ['Growth check-up', 'متابعة النمو'], ['Nebuliser session', 'جلسة بخار']],
  obgyn: [['Pregnancy ultrasound', 'سونار حمل'], ['4D ultrasound', 'سونار رباعي الأبعاد'], ['Pap smear', 'مسحة عنق الرحم'], ['IUD insertion', 'تركيب لولب'], ['Follicle scan', 'متابعة تبويض']],
  orthopedics: [['Joint injection', 'حقن مفصل'], ['Plasma (PRP) injection', 'حقن بلازما'], ['Cast application', 'تركيب جبيرة'], ['Physiotherapy session', 'جلسة علاج طبيعي']],
  ophthalmology: [['Eye pressure test', 'قياس ضغط العين'], ['Field of vision test', 'مجال إبصار'], ['OCT scan', 'أشعة مقطعية على العين'], ['Glasses prescription', 'كشف نظارة']],
  ent: [['Ear wax removal', 'تنظيف الأذن'], ['Hearing test', 'قياس سمع'], ['Nasal endoscopy', 'منظار أنف']],
  neurology: [['EEG', 'رسم مخ'], ['Nerve conduction study', 'رسم أعصاب'], ['Botox for migraine', 'بوتوكس للصداع النصفي']],
  urology: [['Urinary tract ultrasound', 'سونار مسالك'], ['Uroflowmetry', 'قياس سريان البول'], ['Cystoscopy', 'منظار مثانة']],
  psychiatry: [['Therapy session', 'جلسة علاج نفسي'], ['Online session', 'جلسة أونلاين'], ['Family session', 'جلسة أسرية']],
};

/** Suggestions in the reader's language for a specialty (none for an unknown one). */
export function suggestionsFor(specialtySlug: string | null, locale: 'en' | 'ar'): string[] {
  return (SERVICE_SUGGESTIONS[specialtySlug ?? ''] ?? []).map(([en, ar]) => (locale === 'ar' ? ar : en));
}
