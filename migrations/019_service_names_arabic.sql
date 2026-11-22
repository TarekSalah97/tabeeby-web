-- Services get an Arabic name next to the main (usually English) one, so Arabic pages show Arabic.
-- The visit keeps both names as they were when booked.
alter table clinic_services add column name_ar text check (name_ar is null or char_length(btrim(name_ar)) between 2 and 80);
alter table appointments add column service_name_ar text;

-- Fill the Arabic name for services named after a known suggestion, or typed in Arabic already.
with pairs(en, ar) as (values
  ('Laser hair removal session', 'جلسة ليزر لإزالة الشعر'),
  ('Botox', 'بوتوكس'),
  ('Filler', 'فيلر'),
  ('Chemical peel', 'تقشير كيميائي'),
  ('Plasma (PRP) session', 'جلسة بلازما'),
  ('Mole removal', 'إزالة حسنة'),
  ('Mesotherapy', 'ميزوثيرابي'),
  ('Scaling and polishing', 'تنظيف جير وتلميع'),
  ('Filling', 'حشو'),
  ('Root canal treatment', 'علاج عصب'),
  ('Extraction', 'خلع'),
  ('Teeth whitening', 'تبييض الأسنان'),
  ('Braces check-up', 'متابعة تقويم'),
  ('Implant consultation', 'استشارة زراعة'),
  ('Echocardiography', 'إيكو على القلب'),
  ('ECG', 'رسم قلب'),
  ('Stress test', 'رسم قلب بالمجهود'),
  ('24-hour Holter', 'هولتر 24 ساعة'),
  ('Abdominal ultrasound', 'سونار على البطن'),
  ('Fibroscan', 'فيبروسكان'),
  ('Diabetes check-up', 'متابعة السكر'),
  ('Home visit', 'زيارة منزلية'),
  ('Vaccination visit', 'زيارة تطعيم'),
  ('Newborn check-up', 'كشف حديثي الولادة'),
  ('Growth check-up', 'متابعة النمو'),
  ('Nebuliser session', 'جلسة بخار'),
  ('Pregnancy ultrasound', 'سونار حمل'),
  ('4D ultrasound', 'سونار رباعي الأبعاد'),
  ('Pap smear', 'مسحة عنق الرحم'),
  ('IUD insertion', 'تركيب لولب'),
  ('Follicle scan', 'متابعة تبويض'),
  ('Joint injection', 'حقن مفصل'),
  ('Plasma (PRP) injection', 'حقن بلازما'),
  ('Cast application', 'تركيب جبيرة'),
  ('Physiotherapy session', 'جلسة علاج طبيعي'),
  ('Eye pressure test', 'قياس ضغط العين'),
  ('Field of vision test', 'مجال إبصار'),
  ('OCT scan', 'أشعة مقطعية على العين'),
  ('Glasses prescription', 'كشف نظارة'),
  ('Ear wax removal', 'تنظيف الأذن'),
  ('Hearing test', 'قياس سمع'),
  ('Nasal endoscopy', 'منظار أنف'),
  ('EEG', 'رسم مخ'),
  ('Nerve conduction study', 'رسم أعصاب'),
  ('Botox for migraine', 'بوتوكس للصداع النصفي'),
  ('Urinary tract ultrasound', 'سونار مسالك'),
  ('Uroflowmetry', 'قياس سريان البول'),
  ('Cystoscopy', 'منظار مثانة'),
  ('Therapy session', 'جلسة علاج نفسي'),
  ('Online session', 'جلسة أونلاين'),
  ('Family session', 'جلسة أسرية')
)
update clinic_services s set name_ar = p.ar from pairs p where s.name_ar is null and lower(btrim(s.name)) = lower(p.en);
update clinic_services set name_ar = name where name_ar is null and name ~ '[؀-ۿ]';

update appointments a set service_name_ar = s.name_ar
  from clinic_services s where a.service_id = s.id and a.service_name_ar is null and s.name_ar is not null;
