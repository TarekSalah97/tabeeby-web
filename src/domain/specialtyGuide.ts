/*
 * Built-in symptom → specialist guide, used when no AI provider is configured (and as the AI's fallback).
 *
 * The mapping follows common, widely used referral practice (the specialty a general practitioner would
 * normally refer each presentation to, as in NHS/NICE and similar primary-care referral guidance),
 * adapted to Egypt, where patients book specialists directly and internal medicine plays the GP role.
 * It chooses a kind of doctor; it never diagnoses. Emergency warning signs are handled separately
 * (hasRedFlag) and always win over this guide.
 *
 * Words are matched after normaliseText (lower case, Arabic letter variants unified), in English and
 * Egyptian Arabic. Longer phrases count more than single words.
 */

export type GuideUrgency = 'routine' | 'soon';
export type AgeGroup = 'child' | 'adult' | 'senior';
export type Sex = 'female' | 'male';

export interface GuideRule {
  words: string[];
  specialty: string;
  subspecialty?: string;
  urgency?: GuideUrgency;
  reason: [en: string, ar: string];
  /** Only for this sex (e.g. pregnancy → women only). */
  sex?: Sex;
}

export interface GuideMatch {
  specialty: string;
  subspecialty: string;
  urgency: GuideUrgency;
  reason: [string, string];
  score: number;
}

export const GUIDE: readonly GuideRule[] = [
  // ---- heart and circulation
  { words: ['palpitation', 'heart racing', 'heartbeat', 'irregular heart', 'خفقان', 'ضربات القلب', 'قلبي بيدق', 'دقات قلبي'], specialty: 'cardiology', subspecialty: 'electrophysiology', reason: ['A racing or irregular heartbeat is assessed by a cardiologist, usually starting with an ECG.', 'تسارع أو عدم انتظام ضربات القلب يقيّمه طبيب القلب، وغالبًا يبدأ برسم قلب.'] },
  { words: ['high blood pressure', 'hypertension', 'blood pressure', 'ضغط عالي', 'الضغط', 'ضغط الدم'], specialty: 'cardiology', reason: ['High blood pressure is followed by cardiology or internal medicine to reach a safe target.', 'ارتفاع ضغط الدم يتابعه طبيب القلب أو الباطنة للوصول للمعدل الآمن.'] },
  { words: ['ankle swelling', 'swollen legs', 'breathless when walking', 'short of breath on stairs', 'تورم الرجلين', 'رجلي وارمه', 'بنهج', 'نهجان'], specialty: 'cardiology', subspecialty: 'heart-failure', urgency: 'soon', reason: ['Breathlessness on effort with swollen ankles needs a heart check (echo) soon.', 'النهجان مع المجهود وتورم القدمين يحتاج فحص القلب (إيكو) قريبًا.'] },
  { words: ['heart murmur', 'murmur', 'echo', 'لغط', 'صوت في القلب'], specialty: 'cardiology', subspecialty: 'echocardiography', reason: ['A heart murmur is checked with an echocardiogram by a cardiologist.', 'اللغط في القلب يُفحص بالإيكو عند طبيب القلب.'] },
  { words: ['cholesterol', 'كوليسترول', 'دهون في الدم'], specialty: 'cardiology', reason: ['High cholesterol is managed to lower heart risk, by cardiology or internal medicine.', 'ارتفاع الكوليسترول يُعالج لتقليل خطر القلب عند طبيب القلب أو الباطنة.'] },

  // ---- general / internal medicine
  { words: ['diabetes', 'blood sugar', 'high sugar', 'thirsty', 'urinating a lot', 'سكر', 'السكر', 'عطشان', 'بشرب كتير'], specialty: 'internal-medicine', subspecialty: 'diabetes', reason: ['Diabetes and high blood sugar are managed by an internal medicine / diabetes doctor.', 'السكر وارتفاع الجلوكوز يتابعهما طبيب الباطنة والسكر.'] },
  { words: ['thyroid', 'goitre', 'goiter', 'غده', 'الغده الدرقيه'], specialty: 'internal-medicine', subspecialty: 'diabetes', reason: ['Thyroid problems are treated by internal medicine / endocrinology.', 'مشاكل الغدة الدرقية يعالجها طبيب الباطنة والغدد.'] },
  { words: ['stomach', 'heartburn', 'acid', 'reflux', 'indigestion', 'bloating', 'tummy', 'abdominal pain', 'معده', 'بطني', 'بطنه', 'مغص', 'حموضه', 'حرقان في المعده', 'انتفاخ', 'قولون'], specialty: 'internal-medicine', subspecialty: 'gastroenterology', reason: ['Stomach pain, heartburn and bloating are assessed by a gastroenterologist.', 'ألم المعدة والحموضة والانتفاخ يقيّمها طبيب الجهاز الهضمي.'] },
  { words: ['constipation', 'diarrhoea', 'diarrhea', 'blood in stool', 'black stool', 'امساك', 'اسهال', 'دم في البراز'], specialty: 'internal-medicine', subspecialty: 'gastroenterology', reason: ['Bowel changes are assessed by a gastroenterologist.', 'تغيرات الإخراج يقيّمها طبيب الجهاز الهضمي.'] },
  { words: ['liver', 'jaundice', 'yellow eyes', 'hepatitis', 'fatty liver', 'كبد', 'صفرا', 'عيني صفرا', 'فيروس سي', 'دهون على الكبد'], specialty: 'internal-medicine', subspecialty: 'hepatology', urgency: 'soon', reason: ['Liver problems or yellow eyes need a hepatologist soon.', 'مشاكل الكبد أو اصفرار العين تحتاج طبيب الكبد قريبًا.'] },
  { words: ['tired', 'fatigue', 'weak', 'anaemia', 'anemia', 'pale', 'weight loss', 'تعبان', 'ارهاق', 'انيميا', 'انيميه', 'خسيت', 'نقص وزن'], specialty: 'internal-medicine', reason: ['Ongoing tiredness or weight loss starts with an internal medicine check-up and blood tests.', 'التعب المستمر أو نقص الوزن يبدأ بكشف باطنة وتحاليل دم.'] },
  { words: ['fever', 'temperature', 'flu', 'سخونيه', 'حراره', 'دور برد', 'انفلونزا'], specialty: 'internal-medicine', reason: ['Fever and flu-like illness are seen first by internal medicine (or a paediatrician for children).', 'السخونية وأعراض البرد يكشف عليها طبيب الباطنة أولًا (أو الأطفال للصغار).'] },
  { words: ['cough', 'phlegm', 'chest infection', 'كحه', 'بلغم'], specialty: 'internal-medicine', reason: ['A cough is assessed first by internal medicine; a chest X-ray may be needed if it lasts over 3 weeks.', 'الكحة يكشف عليها طبيب الباطنة أولًا، وقد تحتاج أشعة صدر لو استمرت أكثر من 3 أسابيع.'] },

  // ---- bones and joints
  { words: ['knee', 'ركبه', 'ركبتي'], specialty: 'orthopedics', subspecialty: 'knee', reason: ['Knee pain is assessed by an orthopaedic (knee) specialist.', 'ألم الركبة يقيّمه طبيب العظام المتخصص في الركبة.'] },
  { words: ['back pain', 'lower back', 'neck pain', 'sciatica', 'slipped disc', 'ضهري', 'الضهر', 'ظهري', 'رقبتي', 'عرق النسا', 'انزلاق غضروفي', 'غضروف'], specialty: 'orthopedics', subspecialty: 'spine', reason: ['Back or neck pain and sciatica are assessed by a spine specialist.', 'ألم الظهر أو الرقبة وعرق النسا يقيّمها طبيب العمود الفقري.'] },
  { words: ['shoulder', 'كتف', 'كتفي'], specialty: 'orthopedics', subspecialty: 'shoulder', reason: ['Shoulder pain is assessed by an orthopaedic shoulder specialist.', 'ألم الكتف يقيّمه طبيب العظام المتخصص في الكتف.'] },
  { words: ['sprain', 'twisted', 'sports injury', 'ligament', 'ankle', 'التواء', 'جزع', 'اتجزعت', 'رباط', 'كاحل', 'اصابه ملاعب'], specialty: 'orthopedics', subspecialty: 'sports-injuries', reason: ['Sprains and sports injuries are treated by a sports-injury orthopaedic doctor.', 'الالتواءات وإصابات الملاعب يعالجها طبيب عظام إصابات الملاعب.'] },
  { words: ['joint pain', 'fracture', 'broken bone', 'hip', 'wrist', 'elbow', 'مفاصل', 'كسر', 'الحوض', 'رسغ', 'كوع'], specialty: 'orthopedics', reason: ['Joint and bone pain is assessed by an orthopaedic doctor.', 'آلام المفاصل والعظام يقيّمها طبيب العظام.'] },

  // ---- skin, hair
  { words: ['acne', 'pimples', 'spots on face', 'حب الشباب', 'حب شباب', 'حبوب في وشي', 'بثور'], specialty: 'dermatology', subspecialty: 'acne', reason: ['Acne is treated by a dermatologist.', 'حب الشباب يعالجه طبيب الجلدية.'] },
  { words: ['hair loss', 'hair falling', 'bald', 'dandruff', 'تساقط الشعر', 'شعري بيقع', 'صلع', 'قشره'], specialty: 'dermatology', subspecialty: 'hair', reason: ['Hair loss and scalp problems are treated by a dermatologist (hair specialist).', 'تساقط الشعر ومشاكل فروة الرأس يعالجها طبيب الجلدية المتخصص في الشعر.'] },
  { words: ['rash', 'itch', 'itchy', 'eczema', 'psoriasis', 'skin', 'mole', 'hives', 'حكه', 'هرش', 'طفح', 'اكزيما', 'صدفيه', 'جلدي', 'حسنه', 'حساسيه جلد'], specialty: 'dermatology', reason: ['Rashes, itching and skin changes are assessed by a dermatologist.', 'الطفح والحكة وتغيرات الجلد يقيّمها طبيب الجلدية.'] },
  { words: ['wrinkles', 'pigmentation', 'dark spots', 'melasma', 'botox', 'filler', 'تجاعيد', 'تصبغات', 'كلف', 'بوتوكس', 'فيلر'], specialty: 'dermatology', subspecialty: 'cosmetic-dermatology', reason: ['Cosmetic skin concerns are handled by a cosmetic dermatologist.', 'مشاكل البشرة التجميلية يتابعها طبيب الجلدية التجميلي.'] },

  // ---- women
  { words: ['pregnant', 'pregnancy', 'missed period', 'positive test', 'حامل', 'حمل', 'الدوره اتاخرت', 'متاخره'], specialty: 'obgyn', reason: ['Pregnancy care is with an obstetrician–gynaecologist.', 'متابعة الحمل عند طبيب النساء والتوليد.'], sex: 'female' },
  { words: ['bleeding in pregnancy', 'twins', 'previous miscarriage', 'miscarriage', 'سقط', 'اجهاض', 'توام'], specialty: 'obgyn', subspecialty: 'high-risk-pregnancy', urgency: 'soon', reason: ['A pregnancy with risk factors needs a high-risk pregnancy specialist.', 'الحمل مع عوامل خطورة يحتاج طبيب الحمل الحرج.'], sex: 'female' },
  { words: ['trying to conceive', 'infertility', 'cannot get pregnant', 'delayed pregnancy', 'تاخر الحمل', 'تاخر الانجاب', 'مش عارفه احمل', 'بحاول احمل', 'حقن مجهري'], specialty: 'obgyn', subspecialty: 'fertility', reason: ['Difficulty getting pregnant is assessed by a fertility specialist (usually after a year of trying, or 6 months if over 35).', 'تأخر الحمل يقيّمه طبيب الخصوبة (عادة بعد سنة من المحاولة، أو 6 شهور بعد سن 35).'], sex: 'female' },
  { words: ['period', 'periods', 'menstrual', 'vaginal discharge', 'pelvic pain', 'ovary', 'cyst', 'الدوره', 'الدورة', 'افرازات', 'تكيس', 'المبايض', 'الرحم'], specialty: 'obgyn', reason: ['Period problems, discharge and pelvic pain are assessed by a gynaecologist.', 'مشاكل الدورة والإفرازات وألم الحوض يقيّمها طبيب النساء.'], sex: 'female' },
  { words: ['fibroids', 'endometriosis', 'ليف', 'ليفه', 'بطانه الرحم'], specialty: 'obgyn', subspecialty: 'laparoscopy', reason: ['Fibroids and endometriosis are treated by a gynaecologist, often with laparoscopy.', 'الألياف وبطانة الرحم المهاجرة يعالجها طبيب النساء وغالبًا بالمنظار.'], sex: 'female' },
  { words: ['breast lump', 'lump in breast', 'كتله في الثدي', 'ورم في الصدر'], specialty: 'obgyn', urgency: 'soon', reason: ['A new breast lump should be checked soon (breast clinic or gynaecologist).', 'أي كتلة جديدة في الثدي يجب فحصها قريبًا (عيادة الثدي أو طبيب النساء).'], sex: 'female' },

  // ---- urinary, men
  { words: ['kidney stone', 'stones', 'colic', 'side pain', 'blood in urine', 'حصوه', 'حصوة', 'مغص كلوي', 'دم في البول'], specialty: 'urology', subspecialty: 'stones', urgency: 'soon', reason: ['Kidney stones and blood in the urine are assessed by a urologist.', 'حصوات الكلى والدم في البول يقيّمها طبيب المسالك البولية.'] },
  { words: ['burning urine', 'painful urination', 'frequent urination', 'prostate', 'weak stream', 'حرقان في البول', 'حرقان البول', 'تبول متكرر', 'بروستاتا', 'البروستاته'], specialty: 'urology', reason: ['Urinary symptoms and prostate problems are assessed by a urologist.', 'أعراض البول ومشاكل البروستاتا يقيّمها طبيب المسالك.'] },
  { words: ['erectile', 'erection', 'male infertility', 'sperm', 'testicle', 'ضعف جنسي', 'انتصاب', 'الخصيه', 'تحليل سائل منوي'], specialty: 'urology', subspecialty: 'andrology', reason: ['Men’s sexual and fertility health is treated by an andrologist.', 'الصحة الجنسية والخصوبة عند الرجال يعالجها طبيب الذكورة.'], sex: 'male' },

  // ---- brain and nerves
  { words: ['headache', 'migraine', 'صداع', 'صداع نصفي', 'شقيقه'], specialty: 'neurology', subspecialty: 'headache', reason: ['Recurrent headaches and migraine are treated by a neurologist (headache clinic).', 'الصداع المتكرر والصداع النصفي يعالجه طبيب المخ والأعصاب.'] },
  { words: ['seizure history', 'epilepsy', 'fits', 'صرع', 'نوبات'], specialty: 'neurology', subspecialty: 'epilepsy', reason: ['Epilepsy is followed by a neurologist (epilepsy specialist).', 'الصرع يتابعه طبيب المخ والأعصاب المتخصص.'] },
  { words: ['numbness', 'tingling', 'pins and needles', 'tremor', 'shaking hands', 'memory', 'forgetful', 'dizziness', 'dizzy', 'vertigo', 'تنميل', 'رعشه', 'نسيان', 'ذاكره', 'دوخه', 'دوار'], specialty: 'neurology', reason: ['Numbness, tremor, memory problems and dizziness are assessed by a neurologist.', 'التنميل والرعشة والنسيان والدوخة يقيّمها طبيب المخ والأعصاب.'] },
  { words: ['previous stroke', 'after stroke', 'بعد الجلطه'], specialty: 'neurology', subspecialty: 'stroke', reason: ['Follow-up after a stroke is with a stroke neurologist.', 'المتابعة بعد الجلطة عند طبيب المخ والأعصاب المتخصص.'] },

  // ---- ear, nose, throat
  { words: ['sinus', 'blocked nose', 'nasal', 'runny nose', 'snoring', 'جيوب انفيه', 'مناخيري', 'انفي مسدود', 'شخير', 'لحميه'], specialty: 'ent', subspecialty: 'sinus', reason: ['Sinus and nose problems are treated by an ENT doctor.', 'مشاكل الجيوب الأنفية والأنف يعالجها طبيب الأنف والأذن.'] },
  { words: ['hearing', 'deaf', 'ringing in ear', 'tinnitus', 'سمع', 'مش سامع', 'طنين', 'بتزن', 'زنه'], specialty: 'ent', subspecialty: 'hearing', reason: ['Hearing loss and ringing in the ears are assessed by an ENT (hearing) specialist.', 'ضعف السمع والطنين يقيّمه طبيب الأنف والأذن المتخصص في السمع.'] },
  { words: ['ear', 'earache', 'sore throat', 'throat', 'tonsil', 'hoarse', 'voice', 'ودن', 'وداني', 'اذن', 'زور', 'اللوز', 'صوتي', 'بحه'], specialty: 'ent', reason: ['Ear and throat problems are treated by an ENT doctor.', 'مشاكل الأذن والحلق يعالجها طبيب الأنف والأذن والحنجرة.'] },

  // ---- eyes
  { words: ['blurred vision', 'glasses', 'short sighted', 'lasik', 'نضاره', 'نظري ضعيف', 'ليزك', 'مش شايف كويس'], specialty: 'ophthalmology', subspecialty: 'lasik', reason: ['Blurred vision and glasses are assessed by an ophthalmologist; LASIK is one option for some adults.', 'ضعف النظر والنظارة يقيّمها طبيب العيون، والليزك اختيار لبعض البالغين.'] },
  { words: ['floaters', 'flashes', 'retina', 'diabetic eye', 'شبكيه', 'ذبابه طايره', 'ومضات'], specialty: 'ophthalmology', subspecialty: 'retina', urgency: 'soon', reason: ['New floaters or flashes need a retina check soon.', 'ظهور عوائم أو ومضات جديدة يحتاج فحص الشبكية قريبًا.'] },
  { words: ['eye', 'red eye', 'itchy eyes', 'eye pain', 'عيني', 'عين', 'احمرار العين', 'رمد'], specialty: 'ophthalmology', reason: ['Eye problems are assessed by an ophthalmologist.', 'مشاكل العين يقيّمها طبيب العيون.'] },

  // ---- teeth
  { words: ['braces', 'crooked teeth', 'تقويم', 'اسناني معوجه'], specialty: 'dentistry', subspecialty: 'orthodontics', reason: ['Crooked teeth and braces are handled by an orthodontist.', 'اعوجاج الأسنان والتقويم عند أخصائي التقويم.'] },
  { words: ['abscess', 'swollen gum', 'gum swelling', 'swelling in my gum', 'swollen jaw', 'tooth infection', 'خراج', 'ورم في اللثه', 'لثتي وارمه', 'خدي وارم'], specialty: 'dentistry', subspecialty: 'endodontics', urgency: 'soon', reason: ['A painful tooth with swelling may be an infection: see a dentist within a day or two. Go to emergency if the swelling spreads towards the eye or neck, or you have fever or trouble swallowing.', 'ألم السن مع التورم قد يكون التهابًا: اذهب لطبيب أسنان خلال يوم أو يومين. توجّه للطوارئ إذا امتد التورم للعين أو الرقبة أو كانت عندك حرارة أو صعوبة في البلع.'] },
  { words: ['toothache', 'tooth pain', 'tooth hurts', 'molar', 'molars', 'wisdom tooth', 'root canal', 'sensitive teeth', 'ضرس', 'ضرسي', 'سناني', 'الم الضرس', 'ضرس العقل', 'عصب', 'حشو عصب'], specialty: 'dentistry', subspecialty: 'endodontics', reason: ['Toothache and nerve pain are treated by a dentist (root canal specialist).', 'ألم الأسنان والعصب يعالجه طبيب الأسنان المتخصص في علاج العصب.'] },
  { words: ['missing tooth', 'implant', 'زرعه', 'زراعه اسنان', 'سنه واقعه'], specialty: 'dentistry', subspecialty: 'implants', reason: ['Missing teeth can be replaced by an implant dentist.', 'الأسنان المفقودة يعوضها طبيب زراعة الأسنان.'] },
  { words: ['whitening', 'veneers', 'smile', 'تبييض', 'فينير', 'ابتسامه'], specialty: 'dentistry', subspecialty: 'cosmetic-dentistry', reason: ['Whitening and veneers are cosmetic dentistry.', 'التبييض والفينير من تجميل الأسنان.'] },
  { words: ['tooth', 'teeth', 'gums', 'dental', 'سنان', 'اسنان', 'لثه', 'سنه'], specialty: 'dentistry', reason: ['Teeth and gum problems are treated by a dentist.', 'مشاكل الأسنان واللثة يعالجها طبيب الأسنان.'] },

  // ---- mind
  { words: ['anxiety', 'panic', 'depression', 'sad', 'cannot sleep', 'insomnia', 'stress', 'قلق', 'اكتئاب', 'مخنوق', 'مش بنام', 'ارق', 'توتر', 'نوبه هلع'], specialty: 'psychiatry', subspecialty: 'adult-psychiatry', reason: ['Anxiety, low mood and sleep problems are treated by a psychiatrist; talking therapy helps too.', 'القلق والاكتئاب ومشاكل النوم يعالجها الطبيب النفسي، والعلاج بالكلام مفيد أيضًا.'] },
  { words: ['adhd', 'hyperactive', 'autism', 'speech delay', 'فرط حركه', 'توحد', 'تاخر الكلام'], specialty: 'psychiatry', subspecialty: 'child-psychiatry', reason: ['Attention, autism and behaviour concerns in children are assessed by a child psychiatrist or development specialist.', 'مشاكل التركيز والتوحد والسلوك عند الأطفال يقيّمها الطبيب النفسي للأطفال أو أخصائي النمو.'] },

  // ---- children (age group "child" also redirects most adult specialties, see childVersion)
  { words: ['baby', 'newborn', 'infant', 'رضيع', 'مولود', 'بيبي'], specialty: 'pediatrics', subspecialty: 'neonatology', reason: ['Babies in their first weeks are seen by a neonatologist or paediatrician.', 'الأطفال حديثو الولادة يكشف عليهم طبيب حديثي الولادة أو الأطفال.'] },
  { words: ['wheeze', 'wheezing', 'asthma', 'allergy', 'صفير', 'ربو', 'حساسيه صدر'], specialty: 'pediatrics', subspecialty: 'allergy-asthma', reason: ['Wheezing and asthma are followed by an allergy–asthma specialist.', 'الصفير والربو يتابعه أخصائي الحساسية والربو.'] },
  { words: ['growth', 'not growing', 'development', 'vaccines', 'vaccination', 'طول', 'النمو', 'تطعيم', 'تطعيمات'], specialty: 'pediatrics', subspecialty: 'development', reason: ['Growth, development and vaccinations are followed by a paediatrician.', 'النمو والتطور والتطعيمات يتابعها طبيب الأطفال.'] },
];

/** For children, adult specialties move to their children's version (common referral practice). */
const CHILD_VERSION: Record<string, { specialty: string; subspecialty: string }> = {
  'internal-medicine': { specialty: 'pediatrics', subspecialty: '' },
  cardiology: { specialty: 'cardiology', subspecialty: 'pediatric-cardiology' },
  dentistry: { specialty: 'dentistry', subspecialty: 'pediatric-dentistry' },
  ent: { specialty: 'ent', subspecialty: 'pediatric-ent' },
  ophthalmology: { specialty: 'ophthalmology', subspecialty: 'pediatric-ophthalmology' },
  psychiatry: { specialty: 'psychiatry', subspecialty: 'child-psychiatry' },
  neurology: { specialty: 'pediatrics', subspecialty: '' },
  urology: { specialty: 'pediatrics', subspecialty: '' },
};

/** The best specialties for a description, most suitable first (at most `max`, one per specialty). */
export function guideMatches(
  normalisedText: string,
  o: { ageGroup: AgeGroup | null; sex: Sex | null; normalise: (s: string) => string; max?: number },
): GuideMatch[] {
  // Punctuation becomes a space so "knee," and "(knee)" still match.
  const text = ` ${normalisedText.replace(/[.,;:!?()[\]{}"/\\،؛؟-]+/g, ' ').replace(/\s+/g, ' ')} `;
  // English words must start a word ("ear" must not match "year"); Arabic words may carry prefixes (ال، ب، و).
  const has = (n: string) => (/^[a-z]/.test(n) ? text.includes(' ' + n) : text.includes(n));
  const scored: GuideMatch[] = [];
  for (const rule of GUIDE) {
    if (rule.sex && o.sex && rule.sex !== o.sex) continue;
    let score = 0;
    for (const w of rule.words) {
      const n = o.normalise(w);
      if (n && has(n)) score += n.split(/\s+/).length * 2 + (n.length > 6 ? 1 : 0);
    }
    if (!score) continue;
    let specialty = rule.specialty;
    let subspecialty = rule.subspecialty ?? '';
    if (o.ageGroup === 'child' && CHILD_VERSION[specialty]) ({ specialty, subspecialty } = CHILD_VERSION[specialty]!);
    scored.push({ specialty, subspecialty, urgency: rule.urgency ?? 'routine', reason: rule.reason, score });
  }
  scored.sort((a, b) => b.score - a.score);
  // A tooth problem with any swelling may be an infection: suggest seeing the dentist soon.
  const dental = scored[0]?.specialty === 'dentistry' ? scored[0] : undefined;
  if (dental && /swell|swollen|ورم|وارم|منفوخ/.test(text)) {
    const infection = GUIDE.find((r) => r.words.includes('abscess'))!;
    Object.assign(dental, { urgency: 'soon' as const, subspecialty: o.ageGroup === 'child' ? dental.subspecialty : 'endodontics', reason: infection.reason });
  }
  const out: GuideMatch[] = [];
  for (const m of scored) {
    if (out.some((x) => x.specialty === m.specialty)) continue;
    out.push(m);
    if (out.length === (o.max ?? 3)) break;
  }
  return out;
}
