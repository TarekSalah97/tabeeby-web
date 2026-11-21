/**
 * Fictional people and clinical notes for the demo/test website. Nothing here is real:
 * names, numbers and stories are invented for walkthroughs.
 */

export interface DemoDoctor {
  name: string;
  phone: string;
  specialty: string;
  subs: string[];
  titleEn: string;
  titleAr: string;
  district: string;
  clinic: string;
  fee: number;
  followUpFee: number;
  days: number[];
  from: string;
  to: string;
  gradYear: number;
  positions: [string, string, string, string | null][];
  /** Which template set to use for visit notes. */
  notes: NoteSet;
}

export const DOCTORS: DemoDoctor[] = [
  { name: 'Ahmed Hassan', phone: '+201000000101', specialty: 'cardiology', subs: ['heart-failure', 'echocardiography'], titleEn: 'Consultant Cardiologist · MD', titleAr: 'استشاري أمراض القلب · دكتوراه', district: 'smouha', clinic: 'Smouha Heart Clinic', fee: 500, followUpFee: 250, days: [0, 2, 4], from: '17:00', to: '21:00', gradYear: 2006, positions: [['Resident, Cardiology', 'University Hospital', '2010-01-01', '2014-01-01'], ['Consultant Cardiologist', 'Demo Hospital', '2014-01-01', null]], notes: 'cardiology' },
  { name: 'Sara Mostafa', phone: '+201000000102', specialty: 'cardiology', subs: ['interventional'], titleEn: 'Lecturer of Cardiology', titleAr: 'مدرس أمراض القلب', district: 'roushdy', clinic: 'Roushdy Medical Center', fee: 450, followUpFee: 200, days: [1, 3], from: '16:00', to: '20:00', gradYear: 2011, positions: [['Specialist, Cardiology', 'Demo Hospital', '2016-01-01', null]], notes: 'cardiology' },
  { name: 'Omar Khalil', phone: '+201000000103', specialty: 'orthopedics', subs: ['knee', 'sports-injuries'], titleEn: 'Orthopedic Surgeon', titleAr: 'جراح عظام', district: 'sporting', clinic: 'Sporting Ortho', fee: 400, followUpFee: 200, days: [0, 1, 2, 3, 4, 6], from: '18:00', to: '22:00', gradYear: 2013, positions: [['Orthopedic Surgeon', 'Demo Sports Clinic', '2019-01-01', null]], notes: 'orthopedics' },
  { name: 'Nour El-Sayed', phone: '+201000000104', specialty: 'dentistry', subs: ['endodontics', 'cosmetic-dentistry'], titleEn: 'Dentist · Endodontics', titleAr: 'طبيبة أسنان · علاج جذور', district: 'louran', clinic: 'Louran Dental', fee: 300, followUpFee: 150, days: [0, 1, 2, 3, 4, 6], from: '12:00', to: '20:00', gradYear: 2016, positions: [['Dentist', 'Demo Dental Center', '2020-01-01', null]], notes: 'dentistry' },
  { name: 'Mona Adel', phone: '+201000000105', specialty: 'pediatrics', subs: ['allergy-asthma'], titleEn: 'Pediatrician', titleAr: 'طبيبة أطفال', district: 'stanley', clinic: 'Stanley Kids Clinic', fee: 350, followUpFee: 150, days: [0, 1, 2, 3, 4, 5, 6], from: '10:00', to: '14:00', gradYear: 2009, positions: [['Pediatrician', 'Demo Children’s Hospital', '2015-01-01', null]], notes: 'pediatrics' },
  { name: 'Karim Youssef', phone: '+201000000106', specialty: 'neurology', subs: ['headache'], titleEn: 'Consultant Neurologist', titleAr: 'استشاري المخ والأعصاب', district: 'gleem', clinic: 'Gleem Neuro', fee: 600, followUpFee: 300, days: [1, 3, 5], from: '15:00', to: '19:00', gradYear: 2005, positions: [['Neurologist', 'Demo Hospital', '2012-01-01', '2018-01-01'], ['Consultant Neurologist', 'Demo Neuro Center', '2018-01-01', null]], notes: 'neurology' },
  { name: 'Hala Fathy', phone: '+201000000107', specialty: 'obgyn', subs: ['high-risk-pregnancy', 'laparoscopy'], titleEn: 'Consultant Obstetrics & Gynecology', titleAr: 'استشاري النساء والتوليد', district: 'smouha', clinic: 'Smouha Women’s Clinic', fee: 450, followUpFee: 200, days: [0, 2, 4, 6], from: '16:00', to: '21:00', gradYear: 2007, positions: [['Consultant OB/GYN', 'Demo Maternity Hospital', '2013-01-01', null]], notes: 'obgyn' },
  { name: 'Tarek Samir', phone: '+201000000108', specialty: 'dermatology', subs: ['acne', 'hair'], titleEn: 'Dermatologist', titleAr: 'أخصائي الجلدية', district: 'roushdy', clinic: 'Roushdy Skin Clinic', fee: 350, followUpFee: 150, days: [1, 2, 3, 4], from: '17:00', to: '21:00', gradYear: 2014, positions: [['Dermatologist', 'Demo Skin Center', '2018-01-01', null]], notes: 'dermatology' },
  { name: 'Yasser Nabil', phone: '+201000000109', specialty: 'internal-medicine', subs: ['diabetes', 'gastroenterology'], titleEn: 'Consultant Internal Medicine', titleAr: 'استشاري الباطنة', district: 'sporting', clinic: 'Sporting Internal Medicine', fee: 400, followUpFee: 200, days: [0, 1, 2, 3, 4], from: '18:00', to: '22:00', gradYear: 2004, positions: [['Internist', 'Demo General Hospital', '2010-01-01', null]], notes: 'internal' },
];

export interface DemoPatient {
  name: string;
  phone: string;
  sex: 'male' | 'female';
  dob: string;
  occupation: string;
  marital: 'single' | 'married' | 'divorced' | 'widowed';
  habits: string[];
  allergies: string;
  chronic: string;
  past: string;
  meds: string;
  family: string;
}

const P = (name: string, n: number, sex: 'male' | 'female', dob: string, occupation: string, marital: DemoPatient['marital'], habits: string[], allergies: string, chronic: string, past: string, meds: string, family: string): DemoPatient => ({
  name, phone: `+2010000002${String(n).padStart(2, '0')}`, sex, dob, occupation, marital, habits, allergies, chronic, past, meds, family,
});

export const PATIENTS: DemoPatient[] = [
  P('Yasmin Farouk', 1, 'female', '1990-04-12', 'Teacher', 'married', ['caffeine'], 'Penicillin (rash)', 'None', 'Appendectomy 2012', 'None', 'Mother: hypertension'),
  P('Mahmoud Saleh', 2, 'male', '1968-09-03', 'Accountant', 'married', ['smoking'], 'None known', 'Hypertension, type 2 diabetes', 'None', 'Amlodipine 5 mg, Metformin 1000 mg', 'Father: MI at 60'),
  P('Fatma Ibrahim', 3, 'female', '1975-01-22', 'Housewife', 'married', [], 'Sulfa drugs', 'Hypothyroidism', 'Two caesarean sections', 'Levothyroxine 75 mcg', 'Sister: breast cancer'),
  P('Khaled Mansour', 4, 'male', '1995-07-30', 'Engineer', 'single', ['exercise', 'shisha'], 'None known', 'None', 'ACL repair (left) 2019', 'None', 'Unremarkable'),
  P('Mariam Gaber', 5, 'female', '2018-02-14', 'Child (KG2)', 'single', [], 'Egg (hives)', 'Mild asthma', 'Bronchiolitis at 1 year', 'Salbutamol inhaler as needed', 'Father: asthma'),
  P('Hossam Rashad', 6, 'male', '1958-11-05', 'Retired', 'widowed', ['ex_smoker'], 'Aspirin (stomach upset)', 'Atrial fibrillation, CKD stage 2', 'Prostate surgery 2016', 'Apixaban 5 mg, Bisoprolol 5 mg', 'Brother: stroke'),
  P('Nada Wael', 7, 'female', '1999-05-19', 'University student', 'single', ['caffeine'], 'None known', 'None', 'None', 'Oral contraceptive', 'Mother: migraine'),
  P('Amr Tawfik', 8, 'male', '1983-03-08', 'Driver', 'married', ['smoking', 'caffeine'], 'None known', 'Chronic low back pain', 'None', 'Occasional ibuprofen', 'Father: diabetes'),
  P('Salma Hany', 9, 'female', '1992-10-01', 'Pharmacist', 'married', [], 'None known', 'Iron-deficiency anaemia', 'None', 'Iron supplement', 'Unremarkable'),
  P('Youssef Adly', 10, 'male', '2015-06-25', 'Child (Grade 4)', 'single', [], 'None known', 'None', 'Tonsillectomy 2021', 'None', 'Unremarkable'),
  P('Heba Kamal', 11, 'female', '1987-12-12', 'Nurse', 'married', ['caffeine'], 'Latex', 'Polycystic ovaries', 'Laparoscopic ovarian drilling 2020', 'Metformin 500 mg', 'Mother: type 2 diabetes'),
  P('Mostafa Zaki', 12, 'male', '1972-08-17', 'Shop owner', 'married', ['shisha'], 'None known', 'GERD, fatty liver', 'Cholecystectomy 2018', 'Esomeprazole 40 mg', 'Father: liver cirrhosis (HCV)'),
  P('Rana Shawky', 13, 'female', '2001-01-09', 'Student', 'single', [], 'None known', 'Acne', 'None', 'Topical adapalene', 'Unremarkable'),
  P('Adel Morsy', 14, 'male', '1964-04-28', 'Lawyer', 'married', ['ex_smoker'], 'None known', 'Type 2 diabetes, dyslipidaemia', 'CABG 2019', 'Atorvastatin 40 mg, Aspirin 75 mg, Insulin glargine 20 U', 'Mother: diabetes'),
  P('Doaa Fawzy', 15, 'female', '1994-09-14', 'Designer', 'married', [], 'None known', 'None', 'None', 'Folic acid', 'Unremarkable'),
  P('Sherif Lotfy', 16, 'male', '1979-02-02', 'Sales manager', 'divorced', ['smoking', 'alcohol'], 'None known', 'Gout', 'None', 'Allopurinol 100 mg', 'Father: gout'),
  P('Aya Nasser', 17, 'female', '2010-11-30', 'Student (prep)', 'single', [], 'Peanuts', 'None', 'Fractured radius 2019', 'None', 'Unremarkable'),
  P('Ibrahim Helmy', 18, 'male', '1950-06-06', 'Retired teacher', 'married', [], 'None known', 'Parkinson’s disease, hypertension', 'Cataract surgery both eyes', 'Levodopa/carbidopa, Losartan 50 mg', 'Unremarkable'),
  P('Laila Samy', 19, 'female', '1985-05-05', 'Bank employee', 'married', ['caffeine'], 'Ibuprofen (asthma flare)', 'Migraine', 'None', 'Sumatriptan as needed', 'Mother: migraine'),
  P('Hany Abdo', 20, 'male', '1990-12-20', 'Chef', 'married', ['smoking'], 'None known', 'None', 'Burn on left hand 2015', 'None', 'Unremarkable'),
  P('Ghada Selim', 21, 'female', '1969-07-15', 'Housewife', 'widowed', [], 'Codeine', 'Osteoarthritis of both knees, hypertension', 'Hysterectomy 2014', 'Perindopril 5 mg, Paracetamol as needed', 'Sister: rheumatoid arthritis'),
  P('Ziad Emad', 22, 'male', '2020-03-03', 'Child', 'single', [], 'None known', 'None', 'None', 'Vitamin D drops', 'Unremarkable'),
  P('Noha Ragab', 23, 'female', '1997-08-08', 'Call-centre agent', 'single', ['caffeine'], 'None known', 'Seborrhoeic dermatitis', 'None', 'Ketoconazole shampoo', 'Unremarkable'),
  P('Walid Fekry', 24, 'male', '1976-10-10', 'Taxi owner', 'married', ['smoking', 'shisha'], 'None known', 'Hypertension', 'Hernia repair 2010', 'Amlodipine 10 mg', 'Father: hypertension'),
];

export interface Med {
  medicine: string;
  form: string;
  dose: string;
  frequency: string;
  timing?: string;
  duration?: string;
}
export interface VisitTemplate {
  complaint: string;
  history: string;
  exam: string;
  diagnosis: string;
  plan: string;
  meds: Med[];
  labs: string[];
  /** Typical for follow-up visits rather than first visits. */
  followUp?: boolean;
}

const m = (medicine: string, form: string, dose: string, frequency: string, timing?: string, duration?: string): Med => ({ medicine, form, dose, frequency, timing, duration });

export type NoteSet = 'cardiology' | 'orthopedics' | 'dentistry' | 'pediatrics' | 'neurology' | 'obgyn' | 'dermatology' | 'internal';

export const TEMPLATES: Record<NoteSet, VisitTemplate[]> = {
  cardiology: [
    { complaint: 'Chest tightness on climbing stairs for 3 weeks', history: 'Retrosternal tightness after 2 flights of stairs, relieved by rest within 5 minutes. No pain at rest. Smoker 20 pack-years.', exam: 'BP 150/95, HR 84 regular. S1 S2 normal, no murmurs. Chest clear.', diagnosis: 'Suspected stable angina', plan: 'ECG, echo and lipid profile. Start aspirin and statin. Stress test after results. Stop smoking.', meds: [m('Aspirin', 'tablet', '75 mg', 'once_daily', 'after_meals', 'Long term'), m('Atorvastatin', 'tablet', '40 mg', 'once_daily', 'bedtime', 'Long term')], labs: ['ecg', 'echo', 'lipid'] },
    { complaint: 'Palpitations, worse at night', history: 'Episodes of rapid irregular heartbeat lasting minutes, 2–3 times a week. Heavy coffee intake. No syncope.', exam: 'HR 96 irregular, BP 130/80. No murmurs.', diagnosis: 'Palpitations — rule out paroxysmal AF', plan: 'ECG and Holter, thyroid function. Cut down caffeine. Review with results.', meds: [m('Bisoprolol', 'tablet', '2.5 mg', 'once_daily', 'morning', '1 month')], labs: ['ecg', 'tsh', 'electrolytes'] },
    { complaint: 'Blood pressure follow-up', history: 'Home readings 135–145/85–90 on current treatment. Occasional morning headache. Adherent to medicines.', exam: 'BP 142/88, HR 72. No oedema.', diagnosis: 'Essential hypertension — not at target', plan: 'Increase amlodipine. Low-salt diet, walking 30 min daily. Kidney function. Review in 4 weeks.', meds: [m('Amlodipine', 'tablet', '10 mg', 'once_daily', 'morning', 'Long term')], labs: ['kft', 'electrolytes'], followUp: true },
    { complaint: 'Shortness of breath and ankle swelling', history: 'Breathless on walking 100 m, needs 2 pillows at night, ankles swollen for 2 weeks.', exam: 'BP 120/75, HR 98. Bibasal crackles, pitting oedema to mid-shin.', diagnosis: 'Heart failure — decompensated', plan: 'Echo, kidney function. Diuretic, daily weight, fluid 1.5 L/day. Urgent review if worse.', meds: [m('Furosemide', 'tablet', '40 mg', 'once_daily', 'morning', '2 weeks'), m('Spironolactone', 'tablet', '25 mg', 'once_daily', 'morning', 'Long term')], labs: ['echo', 'kft', 'electrolytes', 'xray_chest'] },
    { complaint: 'Review after echo', history: 'Echo: EF 55%, mild LVH. Chest pain less frequent on treatment.', exam: 'BP 128/80, HR 68.', diagnosis: 'Hypertensive heart disease, stable', plan: 'Continue treatment. Repeat lipid profile in 3 months.', meds: [], labs: [], followUp: true },
  ],
  orthopedics: [
    { complaint: 'Right knee pain for 2 months', history: 'Pain on stairs and after long standing, morning stiffness under 30 minutes. No trauma.', exam: 'Mild effusion, crepitus, tenderness medial joint line. Full range with pain at end.', diagnosis: 'Osteoarthritis right knee', plan: 'X-ray both knees standing. Weight loss, quadriceps exercises. Analgesia. Physiotherapy 10 sessions.', meds: [m('Paracetamol', 'tablet', '1 g', 'three_daily', 'after_meals', '2 weeks'), m('Diclofenac gel', 'gel', 'Thin layer', 'three_daily', undefined, '2 weeks')], labs: ['xray_other'] },
    { complaint: 'Low back pain after lifting', history: 'Sudden low back pain while lifting a box 5 days ago. No leg pain, no numbness, bladder normal.', exam: 'Paraspinal spasm, SLR negative both sides, neurology intact.', diagnosis: 'Acute mechanical low back pain', plan: 'Stay active, avoid lifting 2 weeks, heat. Muscle relaxant. Return if leg weakness or bladder change.', meds: [m('Ibuprofen', 'tablet', '400 mg', 'three_daily', 'after_meals', '5 days'), m('Tizanidine', 'tablet', '2 mg', 'twice_daily', undefined, '5 days')], labs: [] },
    { complaint: 'Twisted left ankle playing football', history: 'Inversion injury yesterday, able to walk with pain, swelling lateral ankle.', exam: 'Swelling and tenderness over ATFL, no bony tenderness, weight bearing possible.', diagnosis: 'Grade 2 lateral ankle sprain', plan: 'RICE, ankle brace 3 weeks, analgesia. Physiotherapy for balance after 1 week.', meds: [m('Paracetamol', 'tablet', '1 g', 'three_daily', 'after_meals', '5 days')], labs: [] },
    { complaint: 'Shoulder pain when lifting the arm', history: 'Right shoulder pain for 6 weeks, worse at night and lifting arm overhead.', exam: 'Painful arc 60–120°, positive Hawkins test. Strength normal.', diagnosis: 'Rotator cuff tendinopathy (right)', plan: 'MRI shoulder if no better. Exercises. Consider injection if no improvement in 6 weeks.', meds: [m('Naproxen', 'tablet', '500 mg', 'twice_daily', 'after_meals', '10 days')], labs: ['mri'] },
    { complaint: 'Knee follow-up after physiotherapy', history: 'Pain improved by about half, walking longer distances.', exam: 'No effusion, better quadriceps strength.', diagnosis: 'Osteoarthritis right knee — improving', plan: 'Continue home exercises. Review in 3 months or sooner if worse.', meds: [], labs: [], followUp: true },
  ],
  dentistry: [
    { complaint: 'Toothache, lower left, worse with cold', history: 'Sharp pain with cold and sweets for a week, lingers a few seconds.', exam: 'Deep caries 36 distal, tender to cold, no swelling.', diagnosis: 'Reversible pulpitis 36', plan: 'Periapical X-ray. Composite filling with liner next visit.', meds: [m('Ibuprofen', 'tablet', '400 mg', 'as_needed', 'after_meals', '3 days')], labs: ['xray_periapical'] },
    { complaint: 'Severe throbbing tooth pain at night', history: 'Spontaneous throbbing pain upper right for 3 days, keeps patient awake.', exam: 'Large carious lesion 16, tender to percussion.', diagnosis: 'Irreversible pulpitis 16', plan: 'Root canal treatment started: access and pulp extirpation. Complete in 2 visits, then crown.', meds: [m('Amoxicillin', 'capsule', '500 mg', 'three_daily', undefined, '5 days'), m('Ibuprofen', 'tablet', '400 mg', 'three_daily', 'after_meals', '3 days')], labs: ['xray_periapical'] },
    { complaint: 'Bleeding gums when brushing', history: 'Gums bleed on brushing for months, bad breath.', exam: 'Generalised plaque and calculus, gingival inflammation, no pockets over 4 mm.', diagnosis: 'Plaque-induced gingivitis', plan: 'Scaling and polishing done. Brushing technique, floss daily. Review in 6 months.', meds: [m('Chlorhexidine 0.12%', 'mouthwash', '15 ml', 'twice_daily', undefined, '2 weeks')], labs: [] },
    { complaint: 'Root canal — second visit', history: 'Pain resolved after first visit.', exam: 'Temporary filling intact, no tenderness.', diagnosis: 'RCT 16 in progress', plan: 'Obturation done. Crown preparation in 2 weeks.', meds: [], labs: ['xray_periapical'], followUp: true },
    { complaint: 'Wants teeth whitening and check-up', history: 'Staining from tea and coffee. No pain.', exam: 'Extrinsic staining, no caries, healthy gums.', diagnosis: 'Extrinsic staining', plan: 'Cleaning and in-office whitening booked. Avoid dark drinks for 48 hours after.', meds: [], labs: ['xray_panoramic'] },
  ],
  pediatrics: [
    { complaint: 'Fever and cough for 3 days', history: 'Fever up to 39 °C, dry cough, runny nose. Eating less, drinking well. Vaccines up to date.', exam: 'Temp 38.4 °C, RR 26, chest clear, red throat, ears normal.', diagnosis: 'Viral upper respiratory tract infection', plan: 'Fluids, rest, paracetamol for fever. Return if breathing fast, not drinking or fever over 5 days.', meds: [m('Paracetamol 120 mg/5 ml', 'syrup', '7.5 ml', 'every_6h', undefined, 'When fever')], labs: [] },
    { complaint: 'Diarrhoea and vomiting since yesterday', history: '6 loose stools and 3 vomits, no blood. Passing urine normally.', exam: 'Alert, mild dehydration, soft abdomen.', diagnosis: 'Acute gastroenteritis with mild dehydration', plan: 'Oral rehydration solution in small frequent sips, zinc for 10 days. Return if lethargic or no urine for 8 hours.', meds: [m('Oral rehydration salts', 'sachet', '1 sachet in 200 ml', 'see_instructions', undefined, 'Until better'), m('Zinc 20 mg/5 ml', 'syrup', '5 ml', 'once_daily', undefined, '10 days')], labs: ['stool'] },
    { complaint: 'Wheezing at night', history: 'Night cough and wheeze 3 nights a week for a month, worse with cold weather. Known mild asthma.', exam: 'Scattered expiratory wheeze, no distress, SpO2 97%.', diagnosis: 'Asthma — not well controlled', plan: 'Start inhaled steroid with spacer, reliever as needed. Written asthma plan. Review in 4 weeks.', meds: [m('Fluticasone 50 mcg', 'inhaler', '2 puffs', 'twice_daily', undefined, '3 months'), m('Salbutamol 100 mcg', 'inhaler', '2 puffs', 'as_needed', undefined, 'When wheezy')], labs: [] },
    { complaint: 'Growth and development check', history: 'Routine visit. Eating well, school performance good.', exam: 'Weight and height on 50th centile. Normal development.', diagnosis: 'Healthy child', plan: 'Vitamin D, balanced diet, next check in 6 months.', meds: [m('Vitamin D3 drops', 'drops', '400 IU', 'once_daily', undefined, '3 months')], labs: [] },
    { complaint: 'Ear pain and fever', history: 'Pulling at right ear, fever 38.8 °C since last night.', exam: 'Right tympanic membrane red and bulging.', diagnosis: 'Acute otitis media (right)', plan: 'Antibiotic for 7 days, paracetamol. Review if not better in 48 hours.', meds: [m('Amoxicillin 250 mg/5 ml', 'suspension', '8 ml', 'twice_daily', undefined, '7 days')], labs: [] },
  ],
  neurology: [
    { complaint: 'Recurrent one-sided headaches', history: 'Throbbing left-sided headache 4 times a month with nausea and light sensitivity, lasting a day. Triggered by lack of sleep.', exam: 'Normal neurological examination. Fundi normal.', diagnosis: 'Migraine without aura', plan: 'Headache diary, regular sleep. Triptan for attacks. Start prophylaxis.', meds: [m('Sumatriptan', 'tablet', '50 mg', 'as_needed', undefined, 'At attack'), m('Propranolol', 'tablet', '40 mg', 'twice_daily', undefined, '3 months')], labs: [] },
    { complaint: 'Numbness and tingling in both feet', history: 'Burning and pins-and-needles in feet for 6 months, worse at night. Diabetic for 10 years.', exam: 'Reduced vibration and pinprick to ankles, absent ankle reflexes.', diagnosis: 'Diabetic peripheral neuropathy', plan: 'HbA1c, B12. Foot care advice. Pregabalin at night.', meds: [m('Pregabalin', 'capsule', '75 mg', 'once_daily', 'bedtime', '1 month')], labs: ['hba1c', 'vit_b12'] },
    { complaint: 'Dizziness when turning in bed', history: 'Brief spinning episodes lasting under a minute when lying down or turning, for 2 weeks.', exam: 'Positive Dix-Hallpike on the right. Otherwise normal.', diagnosis: 'Benign paroxysmal positional vertigo (right)', plan: 'Epley manoeuvre done in clinic. Home exercises.', meds: [m('Betahistine', 'tablet', '16 mg', 'three_daily', 'after_meals', '2 weeks')], labs: [] },
    { complaint: 'Seizure follow-up', history: 'No seizures for 8 months on treatment. Some tiredness.', exam: 'Normal.', diagnosis: 'Focal epilepsy — controlled', plan: 'Continue levetiracetam. No driving until seizure-free 12 months. Review in 6 months.', meds: [m('Levetiracetam', 'tablet', '500 mg', 'twice_daily', undefined, '6 months')], labs: ['cbc', 'lft'], followUp: true },
    { complaint: 'Tremor of hands', history: 'Slow movements and resting tremor right hand for a year.', exam: 'Resting tremor right hand, cogwheel rigidity, reduced arm swing.', diagnosis: 'Parkinson’s disease', plan: 'MRI brain. Adjust levodopa dose. Physiotherapy.', meds: [m('Levodopa/Carbidopa', 'tablet', '100/25 mg', 'three_daily', 'empty_stomach', '3 months')], labs: ['mri'] },
  ],
  obgyn: [
    { complaint: 'Missed period, positive home test', history: 'LMP 7 weeks ago, nausea in the mornings. First pregnancy.', exam: 'BP 110/70. Abdomen soft.', diagnosis: 'Early intrauterine pregnancy ~7 weeks', plan: 'Pelvic ultrasound, routine antenatal tests. Folic acid. Next visit in 4 weeks.', meds: [m('Folic acid', 'tablet', '5 mg', 'once_daily', undefined, '12 weeks')], labs: ['us_pelvis', 'cbc', 'blood_group', 'hbsag', 'hcv_ab'] },
    { complaint: 'Irregular periods and acne', history: 'Cycles every 45–60 days for 2 years, weight gain, facial acne.', exam: 'BMI 29, mild hirsutism.', diagnosis: 'Polycystic ovary syndrome', plan: 'Pelvic ultrasound, hormonal profile. Weight loss plan. Metformin.', meds: [m('Metformin', 'tablet', '500 mg', 'twice_daily', 'with_meals', '3 months')], labs: ['us_pelvis', 'fbs', 'tsh'] },
    { complaint: 'Pregnancy follow-up — 28 weeks', history: 'Feeling baby move well. Mild back ache.', exam: 'BP 115/75, fundal height 28 cm, FHR 140.', diagnosis: 'Normal pregnancy, 28 weeks', plan: 'Glucose test, iron. Next visit in 4 weeks.', meds: [m('Ferrous sulphate', 'tablet', '200 mg', 'once_daily', 'empty_stomach', 'Until delivery')], labs: ['ppbs', 'cbc', 'us_pelvis'], followUp: true },
    { complaint: 'Lower abdominal pain with periods', history: 'Painful periods for years, getting worse, pain during intercourse.', exam: 'Tender posterior fornix.', diagnosis: 'Suspected endometriosis', plan: 'Ultrasound. Pain relief and hormonal treatment. Discuss laparoscopy if no response.', meds: [m('Mefenamic acid', 'capsule', '500 mg', 'three_daily', 'after_meals', 'During periods')], labs: ['us_pelvis'] },
    { complaint: 'Vaginal discharge and itching', history: 'White discharge and itching for a week. No fever.', exam: 'Thick white discharge, vulval redness.', diagnosis: 'Vulvovaginal candidiasis', plan: 'Antifungal treatment. Cotton underwear. Return if recurrent.', meds: [m('Fluconazole', 'capsule', '150 mg', 'single_dose'), m('Clotrimazole', 'cream', 'Apply', 'twice_daily', undefined, '7 days')], labs: [] },
  ],
  dermatology: [
    { complaint: 'Acne on face and back', history: 'Inflammatory spots for 2 years, leaving dark marks. Tried over-the-counter creams.', exam: 'Papules and pustules on face and upper back, some post-inflammatory hyperpigmentation.', diagnosis: 'Moderate acne vulgaris', plan: 'Topical retinoid at night, benzoyl peroxide wash, oral doxycycline 3 months. Sunscreen.', meds: [m('Doxycycline', 'capsule', '100 mg', 'once_daily', 'after_meals', '3 months'), m('Adapalene 0.1%', 'gel', 'Thin layer', 'once_daily', 'bedtime', '3 months')], labs: [] },
    { complaint: 'Itchy dry patches on elbows', history: 'Itchy rash for years, flares in winter. Asthma as a child.', exam: 'Dry lichenified plaques on both elbow creases.', diagnosis: 'Atopic eczema', plan: 'Emollient twice daily, short course of steroid cream, avoid hot showers.', meds: [m('Mometasone 0.1%', 'cream', 'Thin layer', 'once_daily', undefined, '2 weeks')], labs: [] },
    { complaint: 'Hair loss', history: 'Diffuse hair shedding for 4 months after a severe flu. Heavy periods.', exam: 'Positive pull test, no scarring.', diagnosis: 'Telogen effluvium', plan: 'Ferritin, thyroid, vitamin D. Reassurance; regrowth expected in 6 months.', meds: [m('Minoxidil 5%', 'spray', '1 ml', 'twice_daily', undefined, '6 months')], labs: ['ferritin', 'tsh', 'vit_d', 'cbc'] },
    { complaint: 'Dandruff and red scalp', history: 'Flaking and itchy scalp, eyebrows too.', exam: 'Greasy scale on scalp and eyebrows.', diagnosis: 'Seborrhoeic dermatitis', plan: 'Ketoconazole shampoo twice weekly, mild steroid lotion for flares.', meds: [m('Ketoconazole 2%', 'other', 'Shampoo', 'see_instructions', undefined, '1 month')], labs: [] },
    { complaint: 'Acne follow-up', history: 'Much fewer spots, mild dryness.', exam: 'Few comedones, no active pustules.', diagnosis: 'Acne — improving', plan: 'Stop doxycycline, continue retinoid. Review in 3 months.', meds: [], labs: [], followUp: true },
  ],
  internal: [
    { complaint: 'Diabetes follow-up, high readings', history: 'Fasting sugar 160–190 at home. Snacking at night. Feet fine.', exam: 'BP 135/85, BMI 31. Feet: normal pulses and sensation.', diagnosis: 'Type 2 diabetes — poorly controlled', plan: 'HbA1c, kidney function, lipids. Add gliclazide. Diet referral, walking 30 min daily.', meds: [m('Metformin', 'tablet', '1000 mg', 'twice_daily', 'with_meals', 'Long term'), m('Gliclazide MR', 'tablet', '60 mg', 'once_daily', 'morning', 'Long term')], labs: ['hba1c', 'kft', 'lipid', 'urine'], followUp: true },
    { complaint: 'Burning upper abdominal pain', history: 'Epigastric burning after meals and at night for a month, sour taste. Smokes shisha.', exam: 'Mild epigastric tenderness, no masses.', diagnosis: 'Dyspepsia — rule out H. pylori', plan: 'H. pylori stool antigen, CBC. PPI 4 weeks. Avoid late meals and spicy food.', meds: [m('Esomeprazole', 'tablet', '40 mg', 'once_daily', 'before_meals', '4 weeks')], labs: ['h_pylori', 'cbc'] },
    { complaint: 'Tiredness and dizziness', history: 'Tired for 2 months, breathless on stairs, heavy periods.', exam: 'Pale conjunctivae, HR 98.', diagnosis: 'Suspected iron-deficiency anaemia', plan: 'CBC, ferritin. Iron supplement. Gynaecology review for heavy periods.', meds: [m('Ferrous fumarate', 'tablet', '200 mg', 'once_daily', 'empty_stomach', '3 months')], labs: ['cbc', 'ferritin', 'iron'] },
    { complaint: 'Fever and burning urine', history: 'Fever 38.5 °C, burning and frequent urination for 2 days, back pain.', exam: 'Temp 38.3 °C, right loin tenderness.', diagnosis: 'Acute pyelonephritis', plan: 'Urine culture, CBC, kidney function. Antibiotics 7 days, plenty of fluids. Hospital if vomiting.', meds: [m('Ciprofloxacin', 'tablet', '500 mg', 'twice_daily', undefined, '7 days'), m('Paracetamol', 'tablet', '1 g', 'as_needed', undefined, 'When fever')], labs: ['urine', 'urine_culture', 'cbc', 'kft'] },
    { complaint: 'Abnormal liver tests on check-up', history: 'ALT mildly raised on routine test. No alcohol. Overweight.', exam: 'BMI 32, liver edge just palpable.', diagnosis: 'Fatty liver disease', plan: 'Abdominal ultrasound, hepatitis screen. Weight loss 7–10%, exercise.', meds: [], labs: ['us_abdomen', 'lft', 'hcv_ab', 'hbsag'] },
  ],
};

/** Which demo patients see which kind of doctor (adults, children, women…). */
export function patientsFor(d: DemoDoctor): number[] {
  const ages = PATIENTS.map((p) => 2026 - Number(p.dob.slice(0, 4)));
  const idx = PATIENTS.map((_, i) => i);
  switch (d.notes) {
    case 'pediatrics':
      return idx.filter((i) => ages[i]! < 16);
    case 'obgyn':
      return idx.filter((i) => PATIENTS[i]!.sex === 'female' && ages[i]! >= 18 && ages[i]! < 55);
    case 'cardiology':
    case 'internal':
      return idx.filter((i) => ages[i]! >= 25);
    default:
      return idx.filter((i) => ages[i]! >= 8);
  }
}

export const REVIEW_COMMENTS = [
  'Very professional and explained everything clearly.',
  'Short waiting time and a clean clinic.',
  'الدكتور محترم جدًا وشرح لي كل حاجة.',
  'Good doctor, but I waited 40 minutes.',
  'Helped me a lot, my pain is much better.',
  'العيادة نظيفة والمواعيد مظبوطة.',
  '',
];

export const MESSAGES: [string, string][] = [
  ['Doctor, can I take the medicine before breakfast?', 'Yes, take it 30 minutes before breakfast with water.'],
  ['هل أكمل العلاج لو حسيت إني أحسن؟', 'أيوه، كمّل المدة كاملة حتى لو حسيت بتحسن.'],
  ['The lab results are ready, should I bring them?', 'Please bring them to your next visit, or book a follow-up this week.'],
];
