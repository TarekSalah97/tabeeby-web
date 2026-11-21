/*
 * "Tabeeby AI" — a FICTIONAL diagnosis helper that exists only on the demo site (DEMO_MODE=true).
 *
 * It is not an AI model and not medical advice: it matches words in the doctor's notes against a
 * small hand-written list of common presentations and returns textbook possibilities, tests to
 * consider, red flags and questions to ask. It shows what such a feature could feel like.
 *
 * Privacy: the notes are processed in memory for the one request; nothing is stored or logged.
 * Clinical wording is in English, as Egyptian doctors write their notes.
 */

export type Likelihood = 'high' | 'medium' | 'low';

export interface AssistSuggestion {
  condition: string;
  likelihood: Likelihood;
  why: string;
}

export interface AssistResult {
  matched: boolean;
  suggestions: AssistSuggestion[];
  tests: string[];
  redFlags: string[];
  questions: string[];
  /** Notes from the patient's file the doctor should keep in mind (allergies, age, habits). */
  cautions: string[];
}

export interface AssistInput {
  complaint: string;
  history: string;
  examination: string;
  patient: { ageYears: number | null; sex: string | null; allergies: string | null; habits: string[]; chronic: string | null; medications: string | null };
}

interface Rule {
  words: string[];
  ddx: [string, Likelihood, string][];
  tests: string[];
  flags: string[];
  ask: string[];
}

const RULES: Rule[] = [
  {
    words: ['chest', 'tightness', 'angina', 'retrosternal', 'ألم في الصدر', 'صدر'],
    ddx: [
      ['Stable angina', 'high', 'Exertional chest tightness relieved by rest'],
      ['Gastro-oesophageal reflux', 'medium', 'Retrosternal discomfort can be oesophageal'],
      ['Musculoskeletal chest wall pain', 'low', 'Consider if reproducible on palpation'],
    ],
    tests: ['ECG', 'Lipid profile', 'HbA1c', 'Echocardiography', 'Exercise stress test'],
    flags: ['Pain at rest or lasting > 20 min — rule out acute coronary syndrome', 'Syncope, sweating or breathlessness with the pain'],
    ask: ['How many flights of stairs bring it on?', 'Does it spread to the arm, jaw or back?', 'Smoking, diabetes, family history of early heart disease?'],
  },
  {
    words: ['palpitation', 'heartbeat', 'irregular', 'خفقان'],
    ddx: [
      ['Paroxysmal atrial fibrillation', 'medium', 'Episodes of fast irregular heartbeat'],
      ['Sinus tachycardia (caffeine, anxiety, thyroid)', 'high', 'Common, reversible causes'],
      ['Supraventricular tachycardia', 'low', 'Sudden-onset regular fast episodes'],
    ],
    tests: ['ECG', 'Holter monitor', 'TSH', 'Electrolytes', 'CBC'],
    flags: ['Syncope or near-syncope', 'Chest pain or breathlessness during episodes'],
    ask: ['Regular or irregular? Sudden start and stop?', 'Caffeine, energy drinks, weight loss, heat intolerance?'],
  },
  {
    words: ['breath', 'breathless', 'dyspnoea', 'ankle swelling', 'oedema', 'pillows', 'ضيق في التنفس', 'تورم'],
    ddx: [
      ['Heart failure', 'high', 'Exertional breathlessness, orthopnoea and ankle swelling'],
      ['Chronic kidney disease with fluid overload', 'low', 'Consider if creatinine raised'],
      ['Anaemia', 'low', 'Can cause exertional breathlessness'],
    ],
    tests: ['Echocardiography', 'BNP / NT-proBNP', 'Kidney function', 'CBC', 'Chest X-ray', 'ECG'],
    flags: ['Breathless at rest or unable to lie flat', 'Oxygen saturation below 92%'],
    ask: ['How many pillows at night? Waking up breathless?', 'Weight gain over the last weeks?'],
  },
  {
    words: ['blood pressure', 'hypertension', 'bp ', 'ضغط'],
    ddx: [
      ['Uncontrolled essential hypertension', 'high', 'Home readings above target'],
      ['White-coat effect', 'low', 'Compare clinic and home readings'],
      ['Secondary hypertension', 'low', 'Consider if young or resistant to 3 drugs'],
    ],
    tests: ['Kidney function', 'Electrolytes', 'Urine albumin/creatinine ratio', 'Lipid profile', 'ECG'],
    flags: ['BP ≥ 180/120 with headache, chest pain or visual change'],
    ask: ['Taking the tablets every day?', 'Salt intake, NSAIDs, decongestants?'],
  },
  {
    words: ['knee'],
    ddx: [
      ['Knee osteoarthritis', 'high', 'Pain on stairs, short morning stiffness'],
      ['Meniscal tear', 'medium', 'Consider with locking or giving way'],
      ['Patellofemoral pain', 'low', 'Pain sitting long or on stairs in younger patients'],
    ],
    tests: ['Knee X-ray (standing)', 'MRI if mechanical symptoms'],
    flags: ['Hot swollen joint with fever — rule out septic arthritis'],
    ask: ['Locking, clicking or giving way?', 'Swelling after activity?'],
  },
  {
    words: ['back pain', 'low back', 'lifting a box', 'ألم الظهر', 'ظهر'],
    ddx: [
      ['Mechanical low back strain', 'high', 'Onset with lifting, no leg symptoms'],
      ['Lumbar disc prolapse', 'medium', 'Consider if pain radiates below the knee'],
    ],
    tests: ['Usually none in the first 6 weeks', 'Lumbar MRI only with red flags or persistent radicular pain'],
    flags: ['Saddle numbness or bladder/bowel change — cauda equina', 'Fever, weight loss, history of cancer'],
    ask: ['Pain or numbness down the leg?', 'Any change in passing urine?'],
  },
  {
    words: ['ankle', 'twisted', 'sprain', 'inversion'],
    ddx: [
      ['Lateral ankle sprain', 'high', 'Inversion injury, lateral swelling, able to walk'],
      ['Lateral malleolus fracture', 'low', 'Check Ottawa ankle rules'],
    ],
    tests: ['Ankle X-ray if Ottawa rules positive'],
    flags: ['Unable to bear weight for 4 steps', 'Bone tenderness at the posterior malleolus'],
    ask: ['Could you walk straight after?', 'Previous sprains on the same side?'],
  },
  {
    words: ['shoulder', 'lifting the arm', 'overhead'],
    ddx: [
      ['Rotator cuff tendinopathy / impingement', 'high', 'Pain lifting overhead, worse at night'],
      ['Frozen shoulder', 'medium', 'Consider if passive movement also limited'],
      ['Referred pain from the neck', 'low', 'Check neck movements'],
    ],
    tests: ['Shoulder ultrasound', 'X-ray if trauma or older patient'],
    flags: ['Left shoulder pain with exertion — think cardiac'],
    ask: ['Can you lift the arm yourself? Can I lift it for you?', 'Pain lying on that side?'],
  },
  {
    words: ['tooth', 'toothache', 'cold', 'sweets', 'سن', 'ضرس'],
    ddx: [
      ['Reversible pulpitis (caries)', 'high', 'Short sharp pain with cold or sweets'],
      ['Irreversible pulpitis', 'medium', 'Spontaneous lingering or night pain'],
      ['Dentine hypersensitivity', 'low', 'Exposed roots, pain only with stimulus'],
    ],
    tests: ['Periapical X-ray', 'Cold and percussion tests'],
    flags: ['Facial swelling, fever or difficulty swallowing — spreading infection'],
    ask: ['Does the pain linger after the cold is gone?', 'Pain that wakes you at night?'],
  },
  {
    words: ['throbbing tooth', 'abscess', 'night', 'swelling gum'],
    ddx: [
      ['Irreversible pulpitis', 'high', 'Spontaneous throbbing night pain'],
      ['Acute apical abscess', 'medium', 'Tender to percussion, swelling'],
    ],
    tests: ['Periapical X-ray', 'Percussion and vitality tests'],
    flags: ['Swelling spreading to the eye or neck'],
    ask: ['Any swelling of the face?', 'Pain on biting?'],
  },
  {
    words: ['gums', 'bleeding gums', 'bad breath', 'لثة'],
    ddx: [
      ['Plaque-induced gingivitis', 'high', 'Bleeding on brushing, plaque and calculus'],
      ['Chronic periodontitis', 'medium', 'Consider with pockets or mobile teeth'],
    ],
    tests: ['Periodontal charting', 'Bitewing X-rays', 'HbA1c if recurrent or severe'],
    flags: ['Bleeding elsewhere or easy bruising — check CBC'],
    ask: ['How often and how do you brush and floss?', 'Diabetes or smoking?'],
  },
  {
    words: ['fever', 'cough', 'runny nose', 'cold', 'سخونية', 'كحة', 'حرارة'],
    ddx: [
      ['Viral upper respiratory tract infection', 'high', 'Fever, cough and runny nose for a few days'],
      ['Community-acquired pneumonia', 'low', 'Consider with fast breathing or focal chest signs'],
      ['Influenza', 'medium', 'Sudden high fever and body aches in season'],
    ],
    tests: ['Usually none', 'CBC and CRP if unwell', 'Chest X-ray if focal signs'],
    flags: ['Fast breathing, chest indrawing or low oxygen saturation', 'Not drinking, drowsy, or fever in an infant under 3 months'],
    ask: ['Drinking and passing urine normally?', 'Any breathing difficulty?'],
  },
  {
    words: ['diarrhoea', 'diarrhea', 'vomiting', 'loose stools', 'إسهال', 'ترجيع', 'قيء'],
    ddx: [
      ['Acute viral gastroenteritis', 'high', 'Short history of loose stools and vomiting without blood'],
      ['Food poisoning', 'medium', 'Others who ate the same food affected?'],
      ['Bacterial dysentery', 'low', 'Consider with blood in the stool'],
    ],
    tests: ['Usually none', 'Electrolytes if dehydrated', 'Stool analysis if bloody or > 7 days'],
    flags: ['Signs of dehydration: sunken eyes, no urine for 8 hours, lethargy', 'Blood in the stool or high fever'],
    ask: ['How many stools and vomits today?', 'Passing urine normally?'],
  },
  {
    words: ['wheeze', 'wheezing', 'asthma', 'night cough', 'ربو'],
    ddx: [
      ['Asthma — partly controlled', 'high', 'Night symptoms 3 nights a week'],
      ['Viral-induced wheeze', 'medium', 'If only with colds'],
    ],
    tests: ['Peak flow / spirometry (if old enough)'],
    flags: ['Unable to complete sentences, SpO2 < 92%', 'Silent chest'],
    ask: ['How often is the reliever inhaler used?', 'Triggers: cold air, dust, smoke at home?'],
  },
  {
    words: ['ear', 'ear pain', 'أذن', 'ودن'],
    ddx: [
      ['Acute otitis media', 'high', 'Ear pain with fever, red bulging drum'],
      ['Otitis externa', 'medium', 'Pain on moving the ear, canal swelling'],
    ],
    tests: ['Otoscopy'],
    flags: ['Swelling behind the ear (mastoiditis)', 'Facial weakness'],
    ask: ['Any discharge from the ear?', 'Swimming recently?'],
  },
  {
    words: ['headache', 'migraine', 'light sensitivity', 'صداع'],
    ddx: [
      ['Migraine without aura', 'high', 'One-sided throbbing headache with nausea and photophobia'],
      ['Tension-type headache', 'medium', 'Band-like, no nausea'],
      ['Medication-overuse headache', 'low', 'Painkillers on > 10 days a month'],
    ],
    tests: ['None if typical and normal neuro exam'],
    flags: ['Sudden worst-ever headache (thunderclap)', 'New headache after 50, fever with neck stiffness, focal deficit'],
    ask: ['How many days a month? How many painkillers?', 'Any visual aura before the pain?'],
  },
  {
    words: ['numbness', 'tingling', 'burning feet', 'pins', 'تنميل'],
    ddx: [
      ['Diabetic peripheral neuropathy', 'high', 'Symmetrical burning feet in a diabetic'],
      ['Vitamin B12 deficiency neuropathy', 'medium', 'Especially on metformin'],
      ['Hypothyroidism', 'low', 'Check thyroid'],
    ],
    tests: ['HbA1c', 'Vitamin B12', 'TSH', 'Kidney function', 'Monofilament foot exam'],
    flags: ['Foot ulcer or colour change', 'Rapidly spreading weakness'],
    ask: ['Any cuts or ulcers you did not feel?', 'How long on metformin?'],
  },
  {
    words: ['dizziness', 'dizzy', 'spinning', 'vertigo', 'دوخة'],
    ddx: [
      ['Benign paroxysmal positional vertigo (BPPV)', 'high', 'Brief spinning with head position change'],
      ['Vestibular neuritis', 'low', 'Constant vertigo for days after a cold'],
      ['Orthostatic hypotension', 'medium', 'Light-headed on standing rather than spinning'],
    ],
    tests: ['Dix–Hallpike test', 'Lying and standing BP'],
    flags: ['Double vision, slurred speech, weakness or unsteady walking — think stroke'],
    ask: ['Is the room spinning or do you feel faint?', 'Hearing loss or ringing?'],
  },
  {
    words: ['seizure', 'fits', 'epilepsy', 'convulsion', 'تشنج', 'صرع'],
    ddx: [
      ['Epilepsy — on treatment', 'high', 'Known seizures, review of control and side effects'],
      ['Provoked seizure (sleep loss, alcohol, low sugar)', 'low', 'Look for triggers'],
    ],
    tests: ['Drug level if relevant', 'CBC and liver function on long-term treatment', 'EEG / MRI if new or changing'],
    flags: ['Seizure lasting > 5 minutes or repeated without recovery — status epilepticus'],
    ask: ['Date of the last seizure?', 'Missed doses, sleep loss, pregnancy plans?'],
  },
  {
    words: ['tremor', 'slow movements', 'رعشة'],
    ddx: [
      ['Parkinson disease', 'high', 'Resting tremor with slowness'],
      ['Essential tremor', 'medium', 'Tremor on action, often family history'],
      ['Drug-induced parkinsonism', 'low', 'Check for antipsychotics or metoclopramide'],
    ],
    tests: ['Clinical diagnosis', 'TSH'],
    flags: ['Falls'],
    ask: ['Is the tremor at rest or when using the hand?', 'Any new medicines?'],
  },
  {
    words: ['missed period', 'positive test', 'pregnan', 'حمل'],
    ddx: [
      ['Early intrauterine pregnancy', 'high', 'Positive test and missed period'],
      ['Ectopic pregnancy', 'low', 'Must be excluded if pain or bleeding'],
    ],
    tests: ['Pelvic ultrasound', 'Quantitative beta-hCG if location unclear', 'CBC, blood group, urine analysis'],
    flags: ['One-sided pain, bleeding or fainting — rule out ectopic'],
    ask: ['Date of last period?', 'Any pain or bleeding?'],
  },
  {
    words: ['irregular periods', 'irregular cycle', 'acne', 'weight gain', 'hirsutism'],
    ddx: [
      ['Polycystic ovary syndrome (PCOS)', 'high', 'Irregular cycles, acne and weight gain'],
      ['Hypothyroidism', 'low', 'Check TSH'],
      ['Hyperprolactinaemia', 'low', 'Ask about breast discharge'],
    ],
    tests: ['Pelvic ultrasound', 'LH, FSH, testosterone', 'TSH', 'Prolactin', 'Fasting glucose / HbA1c'],
    flags: ['No periods for > 3 months with endometrial thickening'],
    ask: ['Planning a pregnancy?', 'Excess hair growth?'],
  },
  {
    words: ['painful periods', 'dysmenorrhoea', 'pelvic pain', 'intercourse'],
    ddx: [
      ['Endometriosis', 'high', 'Worsening period pain with painful intercourse'],
      ['Primary dysmenorrhoea', 'medium', 'Pain only with periods since teenage years'],
      ['Adenomyosis', 'low', 'Heavy painful periods with a bulky uterus'],
    ],
    tests: ['Transvaginal ultrasound', 'CA-125 (limited value)'],
    flags: ['Fever with pelvic pain — pelvic inflammatory disease'],
    ask: ['Pain getting worse each year?', 'Trying to conceive?'],
  },
  {
    words: ['discharge', 'itching', 'vulval', 'إفرازات'],
    ddx: [
      ['Vulvovaginal candidiasis', 'high', 'Thick white discharge with itching'],
      ['Bacterial vaginosis', 'medium', 'Thin fishy-smelling discharge'],
      ['Trichomoniasis', 'low', 'Frothy discharge'],
    ],
    tests: ['High vaginal swab', 'Urine analysis'],
    flags: ['Fever or pelvic pain', 'Recurrent infections — check glucose'],
    ask: ['Colour and smell of the discharge?', 'Recent antibiotics?'],
  },
  {
    words: ['acne', 'spots', 'pimples', 'حب الشباب'],
    ddx: [
      ['Acne vulgaris (inflammatory)', 'high', 'Papules and pustules on face and back'],
      ['Hormonal acne / PCOS', 'low', 'In women with irregular cycles'],
    ],
    tests: ['None routinely', 'Lipids and LFTs before isotretinoin', 'Pregnancy test before isotretinoin'],
    flags: ['Nodules and scarring — treat early'],
    ask: ['Which treatments tried and for how long?', 'Regular periods?'],
  },
  {
    words: ['itchy', 'rash', 'eczema', 'dry patches', 'حكة', 'هرش'],
    ddx: [
      ['Atopic dermatitis', 'high', 'Itchy flexural dry plaques with atopy'],
      ['Psoriasis', 'medium', 'Well-defined scaly plaques on elbows and knees'],
      ['Contact dermatitis', 'low', 'Related to a new product'],
    ],
    tests: ['Usually none', 'Patch testing if contact allergy suspected'],
    flags: ['Weeping, crusted or painful patches — infection or eczema herpeticum'],
    ask: ['Any asthma or hay fever?', 'New soaps, creams or detergents?'],
  },
  {
    words: ['hair loss', 'shedding', 'تساقط الشعر'],
    ddx: [
      ['Telogen effluvium', 'high', 'Diffuse shedding 2–4 months after illness'],
      ['Iron deficiency', 'medium', 'Heavy periods'],
      ['Female/male pattern hair loss', 'low', 'Gradual thinning at the crown'],
    ],
    tests: ['CBC', 'Ferritin', 'TSH', 'Vitamin D'],
    flags: ['Patchy loss with scarring'],
    ask: ['Any illness, surgery or stress 3 months ago?', 'Heavy periods or dieting?'],
  },
  {
    words: ['dandruff', 'scalp', 'flaking'],
    ddx: [
      ['Seborrhoeic dermatitis', 'high', 'Greasy scale on scalp and eyebrows'],
      ['Scalp psoriasis', 'medium', 'Thick well-defined plaques'],
    ],
    tests: ['None'],
    flags: [],
    ask: ['Worse with stress or winter?'],
  },
  {
    words: ['diabetes', 'sugar', 'fasting', 'سكر'],
    ddx: [
      ['Type 2 diabetes — poorly controlled', 'high', 'Home fasting readings above target'],
      ['Medication non-adherence', 'medium', 'Check how tablets are taken'],
    ],
    tests: ['HbA1c', 'Kidney function', 'Urine albumin/creatinine ratio', 'Lipid profile', 'Fundus examination'],
    flags: ['Glucose > 300 with vomiting or drowsiness — DKA/HHS', 'Foot ulcer'],
    ask: ['Diet and night snacks?', 'Any hypoglycaemia episodes?'],
  },
  {
    words: ['epigastric', 'burning', 'heartburn', 'sour', 'stomach', 'معدة', 'حموضة'],
    ddx: [
      ['Gastro-oesophageal reflux disease', 'high', 'Burning after meals and at night with sour taste'],
      ['Peptic ulcer / H. pylori gastritis', 'medium', 'Epigastric pain, smoking, NSAIDs'],
      ['Biliary colic', 'low', 'Right upper pain after fatty meals'],
    ],
    tests: ['H. pylori stool antigen', 'CBC', 'Upper endoscopy if alarm features'],
    flags: ['Weight loss, vomiting blood, black stools, trouble swallowing, age > 55 with new symptoms'],
    ask: ['Painkillers like ibuprofen or aspirin?', 'Black stools or weight loss?'],
  },
  {
    words: ['tired', 'tiredness', 'fatigue', 'pale', 'heavy periods', 'تعب', 'إرهاق'],
    ddx: [
      ['Iron-deficiency anaemia', 'high', 'Tiredness, pallor and heavy periods'],
      ['Hypothyroidism', 'medium', 'Tiredness, weight gain, cold intolerance'],
      ['Depression / poor sleep', 'low', 'Ask about mood and sleep'],
    ],
    tests: ['CBC', 'Ferritin', 'TSH', 'Fasting glucose', 'Vitamin B12'],
    flags: ['Weight loss, night sweats or bleeding'],
    ask: ['How heavy are the periods (pads per day, clots)?', 'Mood and sleep?'],
  },
  {
    words: ['burning urine', 'dysuria', 'urination', 'frequency', 'حرقان', 'بول'],
    ddx: [
      ['Acute pyelonephritis', 'high', 'Fever with urinary symptoms and back pain'],
      ['Lower urinary tract infection (cystitis)', 'medium', 'Burning and frequency without fever'],
      ['Renal stone with infection', 'low', 'Colicky loin pain'],
    ],
    tests: ['Urine analysis', 'Urine culture', 'CBC, CRP', 'Kidney function', 'Kidney ultrasound'],
    flags: ['Vomiting, unable to keep fluids, low blood pressure — consider admission', 'Pregnancy'],
    ask: ['Fever with chills?', 'Possibility of pregnancy?'],
  },
];

const MAX_RULES = 2;
const MAX_SUGGESTIONS = 5;

function score(rule: Rule, complaint: string, rest: string): number {
  let s = 0;
  for (const w of rule.words) {
    // Longer phrases are more specific ("burning urine" beats "fever").
    const weight = w.trim().split(/\s+/).length;
    if (complaint.includes(w)) s += 3 * weight;
    if (rest.includes(w)) s += weight;
  }
  return s;
}

const uniq = (xs: string[]) => [...new Set(xs)];

export function assist(input: AssistInput): AssistResult {
  const complaint = ` ${input.complaint.toLowerCase()} `;
  const rest = ` ${input.history.toLowerCase()} ${input.examination.toLowerCase()} `;
  const ranked = RULES.map((r) => ({ r, s: score(r, complaint, rest) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_RULES);

  const cautions: string[] = [];
  const p = input.patient;
  const allergies = (p.allergies ?? '').trim();
  if (allergies && !/^(none|no|nil|none known|nkda)\b/i.test(allergies)) cautions.push(`Allergy on file: ${allergies}`);
  if (p.medications && !/^none\b/i.test(p.medications.trim())) cautions.push(`Current medicines: ${p.medications} — check interactions`);
  if (p.chronic && !/^none\b/i.test(p.chronic.trim())) cautions.push(`Known conditions: ${p.chronic}`);
  if (p.habits.includes('smoking')) cautions.push('Smoker — raises cardiovascular and respiratory risk');
  if (p.ageYears !== null && p.ageYears < 12) cautions.push('Child — use weight-based doses');
  if (p.ageYears !== null && p.ageYears >= 65) cautions.push('Older adult — start low with doses, check kidney function');

  if (!ranked.length) return { matched: false, suggestions: [], tests: [], redFlags: [], questions: [], cautions };

  const top = ranked[0]!.r;
  const suggestions: AssistSuggestion[] = [];
  for (const { r } of ranked) {
    for (const [condition, likelihood, why] of r.ddx) {
      if (suggestions.some((s) => s.condition === condition)) continue;
      // Possibilities from the second-best match are shown one level less likely.
      const lvl: Likelihood = r === top ? likelihood : likelihood === 'high' ? 'medium' : 'low';
      suggestions.push({ condition, likelihood: lvl, why });
    }
  }
  const order: Record<Likelihood, number> = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => order[a.likelihood] - order[b.likelihood]);

  return {
    matched: true,
    suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
    tests: uniq(ranked.flatMap((x) => x.r.tests)).slice(0, 8),
    redFlags: uniq(ranked.flatMap((x) => x.r.flags)).slice(0, 5),
    questions: uniq(ranked.flatMap((x) => x.r.ask)).slice(0, 5),
    cautions,
  };
}
