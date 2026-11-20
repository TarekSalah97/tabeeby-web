-- Reference data for launch. Real lists should be reviewed by the medical team.

insert into governorates (slug, name_en, name_ar, is_active) values
  ('alexandria', 'Alexandria', 'الإسكندرية', true),
  ('cairo', 'Cairo', 'القاهرة', false),
  ('giza', 'Giza', 'الجيزة', false);

insert into districts (governorate_id, slug, name_en, name_ar)
select g.id, d.slug, d.name_en, d.name_ar
from governorates g,
(values
  ('smouha', 'Smouha', 'سموحة'),
  ('roushdy', 'Roushdy', 'رشدي'),
  ('louran', 'Louran', 'لوران'),
  ('sporting', 'Sporting', 'سبورتنج'),
  ('stanley', 'Stanley', 'ستانلي'),
  ('gleem', 'Gleem', 'جليم'),
  ('sidi-gaber', 'Sidi Gaber', 'سيدي جابر'),
  ('cleopatra', 'Cleopatra', 'كليوباترا'),
  ('ibrahimia', 'Ibrahimia', 'الإبراهيمية'),
  ('shatby', 'Shatby', 'الشاطبي'),
  ('azarita', 'Azarita', 'الأزاريطة'),
  ('raml-station', 'Raml Station', 'محطة الرمل'),
  ('mansheya', 'Mansheya', 'المنشية'),
  ('moharram-bey', 'Moharram Bey', 'محرم بك'),
  ('kafr-abdo', 'Kafr Abdo', 'كفر عبده'),
  ('san-stefano', 'San Stefano', 'سان ستيفانو'),
  ('sidi-bishr', 'Sidi Bishr', 'سيدي بشر'),
  ('miami', 'Miami', 'ميامي'),
  ('asafra', 'Asafra', 'العصافرة'),
  ('mandara', 'Mandara', 'المندرة'),
  ('montaza', 'Montaza', 'المنتزه'),
  ('maamoura', 'Maamoura', 'المعمورة'),
  ('agami', 'Agami', 'العجمي'),
  ('victoria', 'Victoria', 'فيكتوريا')
) as d(slug, name_en, name_ar)
where g.slug = 'alexandria';

insert into specialties (slug, kind, name_en, name_ar, sort) values
  ('dentistry', 'dental', 'Dentistry', 'طب الأسنان', 10),
  ('cardiology', 'medical', 'Cardiology', 'أمراض القلب', 20),
  ('orthopedics', 'medical', 'Orthopedics', 'العظام', 30),
  ('pediatrics', 'medical', 'Pediatrics', 'طب الأطفال', 40),
  ('dermatology', 'medical', 'Dermatology', 'الجلدية', 50),
  ('obgyn', 'medical', 'Obstetrics & Gynecology', 'النساء والتوليد', 60),
  ('ent', 'medical', 'ENT', 'الأنف والأذن والحنجرة', 70),
  ('neurology', 'medical', 'Neurology', 'المخ والأعصاب', 80),
  ('ophthalmology', 'medical', 'Ophthalmology', 'الرمد', 90),
  ('internal-medicine', 'medical', 'Internal Medicine', 'الباطنة', 100),
  ('psychiatry', 'medical', 'Psychiatry', 'الطب النفسي', 110),
  ('urology', 'medical', 'Urology', 'المسالك البولية', 120);

insert into subspecialties (specialty_id, slug, name_en, name_ar)
select s.id, x.slug, x.name_en, x.name_ar
from specialties s
join (values
  ('dentistry', 'orthodontics', 'Orthodontics', 'تقويم الأسنان'),
  ('dentistry', 'endodontics', 'Endodontics (root canal)', 'علاج الجذور والعصب'),
  ('dentistry', 'implants', 'Implants', 'زراعة الأسنان'),
  ('dentistry', 'pediatric-dentistry', 'Pediatric dentistry', 'أسنان الأطفال'),
  ('dentistry', 'cosmetic-dentistry', 'Cosmetic dentistry', 'تجميل الأسنان'),
  ('cardiology', 'interventional', 'Interventional cardiology', 'القسطرة القلبية'),
  ('cardiology', 'heart-failure', 'Heart failure', 'قصور القلب'),
  ('cardiology', 'echocardiography', 'Echocardiography', 'إيكو القلب'),
  ('cardiology', 'electrophysiology', 'Electrophysiology', 'كهرباء القلب'),
  ('cardiology', 'pediatric-cardiology', 'Pediatric cardiology', 'قلب الأطفال'),
  ('orthopedics', 'knee', 'Knee', 'الركبة'),
  ('orthopedics', 'spine', 'Spine', 'العمود الفقري'),
  ('orthopedics', 'shoulder', 'Shoulder', 'الكتف'),
  ('orthopedics', 'sports-injuries', 'Sports injuries', 'إصابات الملاعب'),
  ('pediatrics', 'neonatology', 'Neonatology', 'حديثي الولادة'),
  ('pediatrics', 'allergy-asthma', 'Allergy & asthma', 'الحساسية والربو'),
  ('pediatrics', 'development', 'Growth & development', 'النمو والتطور'),
  ('dermatology', 'acne', 'Acne', 'حب الشباب'),
  ('dermatology', 'hair', 'Hair & scalp', 'الشعر وفروة الرأس'),
  ('dermatology', 'cosmetic-dermatology', 'Cosmetic dermatology', 'تجميل الجلد'),
  ('obgyn', 'high-risk-pregnancy', 'High-risk pregnancy', 'الحمل عالي الخطورة'),
  ('obgyn', 'fertility', 'Fertility', 'الخصوبة وتأخر الإنجاب'),
  ('obgyn', 'laparoscopy', 'Laparoscopy', 'مناظير النساء'),
  ('ent', 'sinus', 'Sinus', 'الجيوب الأنفية'),
  ('ent', 'hearing', 'Hearing', 'السمع'),
  ('ent', 'pediatric-ent', 'Pediatric ENT', 'أنف وأذن الأطفال'),
  ('neurology', 'headache', 'Headache & migraine', 'الصداع والصداع النصفي'),
  ('neurology', 'epilepsy', 'Epilepsy', 'الصرع'),
  ('neurology', 'stroke', 'Stroke', 'السكتة الدماغية'),
  ('ophthalmology', 'retina', 'Retina', 'الشبكية'),
  ('ophthalmology', 'lasik', 'LASIK & refractive', 'الليزك وتصحيح النظر'),
  ('ophthalmology', 'pediatric-ophthalmology', 'Pediatric ophthalmology', 'عيون الأطفال'),
  ('internal-medicine', 'diabetes', 'Diabetes & endocrine', 'السكر والغدد'),
  ('internal-medicine', 'gastroenterology', 'Gastroenterology', 'الجهاز الهضمي'),
  ('internal-medicine', 'hepatology', 'Liver', 'الكبد'),
  ('psychiatry', 'adult-psychiatry', 'Adult psychiatry', 'الطب النفسي للبالغين'),
  ('psychiatry', 'child-psychiatry', 'Child & adolescent', 'الطب النفسي للأطفال والمراهقين'),
  ('urology', 'andrology', 'Andrology', 'أمراض الذكورة'),
  ('urology', 'stones', 'Kidney stones', 'حصوات الكلى')
) as x(spec, slug, name_en, name_ar) on x.spec = s.slug;

insert into condition_keywords (term_en, term_ar, specialty_id, subspecialty_id)
select x.term_en, x.term_ar, s.id, ss.id
from (values
  ('migraine', 'صداع نصفي', 'neurology', 'headache'),
  ('headache', 'صداع', 'neurology', 'headache'),
  ('root canal', 'حشو عصب', 'dentistry', 'endodontics'),
  ('toothache', 'ألم الأسنان', 'dentistry', 'endodontics'),
  ('braces', 'تقويم', 'dentistry', 'orthodontics'),
  ('knee pain', 'ألم الركبة', 'orthopedics', 'knee'),
  ('back pain', 'ألم الظهر', 'orthopedics', 'spine'),
  ('shoulder pain', 'ألم الكتف', 'orthopedics', 'shoulder'),
  ('sports injury', 'إصابة ملاعب', 'orthopedics', 'sports-injuries'),
  ('asthma', 'ربو', 'pediatrics', 'allergy-asthma'),
  ('acne', 'حب الشباب', 'dermatology', 'acne'),
  ('hair loss', 'تساقط الشعر', 'dermatology', 'hair'),
  ('palpitations', 'خفقان', 'cardiology', null),
  ('high blood pressure', 'ضغط مرتفع', 'cardiology', null),
  ('pregnancy', 'حمل', 'obgyn', null),
  ('diabetes', 'سكر', 'internal-medicine', 'diabetes'),
  ('sinusitis', 'جيوب أنفية', 'ent', 'sinus'),
  ('anxiety', 'قلق', 'psychiatry', null)
) as x(term_en, term_ar, spec, sub)
join specialties s on s.slug = x.spec
left join subspecialties ss on ss.specialty_id = s.id and ss.slug = x.sub;
