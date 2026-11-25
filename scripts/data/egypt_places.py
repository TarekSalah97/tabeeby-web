# Egypt's 27 governorates and their main cities / districts (English | Arabic).
# Used once to generate migrations/028_egypt_places_and_subspecialties.sql.
# Alexandria's first 24 districts already exist (migration 002) and keep their slugs.

GOVERNORATES = [
    # slug, English, Arabic, sort, districts
    ('alexandria', 'Alexandria', 'الإسكندرية', 1, """
Bab Sharqi|باب شرقي
Attarin|العطارين
El Gomrok|الجمرك
Karmouz|كرموز
El Labban|اللبان
Mina El Basal|مينا البصل
El Wardian|الورديان
El Max|المكس
Dekheila|الدخيلة
Sidi Kerir|سيدي كرير
Bitash|البيطاش
Hannoville|الهانوفيل
El Amreya|العامرية
King Mariout|كينج مريوط
Borg El Arab|برج العرب
New Borg El Arab|برج العرب الجديدة
Abu Qir|أبو قير
Bolkly|بولكلي
Zizinia|زيزينيا
Saba Pasha|سابا باشا
Fleming|فلمنج
Bacchus|باكوس
Camp Caesar|كامب شيزار
El Hadara|الحضرة
Ezbet Saad|عزبة سعد
Abis|أبيس
Khorshid|خورشيد
"""),
    ('cairo', 'Cairo', 'القاهرة', 2, """
Nasr City|مدينة نصر
Heliopolis|مصر الجديدة
New Cairo|القاهرة الجديدة
Fifth Settlement|التجمع الخامس
First Settlement|التجمع الأول
Third Settlement|التجمع الثالث
Rehab City|مدينة الرحاب
Madinaty|مدينتي
El Shorouk|الشروق
Badr City|مدينة بدر
New Administrative Capital|العاصمة الإدارية الجديدة
Maadi|المعادي
Zahraa El Maadi|زهراء المعادي
Degla|دجلة
Hadayek El Maadi|حدائق المعادي
Mokattam|المقطم
Katameya|القطامية
Zamalek|الزمالك
Downtown Cairo|وسط البلد
Garden City|جاردن سيتي
Abdeen|عابدين
Bulaq|بولاق أبو العلا
El Azbakeya|الأزبكية
El Mosky|الموسكي
El Gamaliya|الجمالية
El Darb El Ahmar|الدرب الأحمر
El Khalifa|الخليفة
Sayeda Zeinab|السيدة زينب
El Manial|المنيل
Old Cairo|مصر القديمة
Dar El Salam|دار السلام
El Basatin|البساتين
Tora|طرة
Helwan|حلوان
El Maasara|المعصرة
15th of May City|مدينة 15 مايو
El Tebbin|التبين
Shubra|شبرا
Rod El Farag|روض الفرج
El Sahel|الساحل
El Sharabiya|الشرابية
El Zawya El Hamra|الزاوية الحمراء
Hadayek El Kobba|حدائق القبة
El Waili|الوايلي
Abbasiya|العباسية
El Zeitoun|الزيتون
El Matariya|المطرية
Ain Shams|عين شمس
El Marg|المرج
El Salam City|مدينة السلام
El Nozha|النزهة
Sheraton|شيراتون
Ezbet El Nakhl|عزبة النخل
"""),
    ('giza', 'Giza', 'الجيزة', 3, """
Dokki|الدقي
Mohandessin|المهندسين
Agouza|العجوزة
Giza|الجيزة
Haram|الهرم
Faisal|فيصل
Hadayek El Ahram|حدائق الأهرام
Omraniya|العمرانية
Talbiya|الطالبية
Bulaq El Dakrour|بولاق الدكرور
Imbaba|إمبابة
Warraq|الوراق
Kit Kat|الكيت كات
Manial Shiha|منيل شيحة
Sheikh Zayed City|الشيخ زايد
6th of October City|مدينة 6 أكتوبر
Hadayek October|حدائق أكتوبر
Kerdasa|كرداسة
Abu Rawash|أبو رواش
Abu El Nomros|أبو النمرس
El Hawamdiya|الحوامدية
El Badrashin|البدرشين
El Ayat|العياط
El Saff|الصف
Atfih|أطفيح
Osim|أوسيم
Manshiyat El Qanater|منشأة القناطر
El Wahat El Bahariya|الواحات البحرية
"""),
    ('qalyubia', 'Qalyubia', 'القليوبية', 10, """
Banha|بنها
Shubra El Kheima|شبرا الخيمة
Qalyub|قليوب
El Khanka|الخانكة
El Obour City|مدينة العبور
Shibin El Qanater|شبين القناطر
Toukh|طوخ
Qaha|قها
Kafr Shukr|كفر شكر
El Khosous|الخصوص
El Qanater El Khayreya|القناطر الخيرية
"""),
    ('sharqia', 'Sharqia', 'الشرقية', 11, """
Zagazig|الزقازيق
10th of Ramadan City|مدينة العاشر من رمضان
Belbeis|بلبيس
Minya El Qamh|منيا القمح
Abu Hammad|أبو حماد
Abu Kabir|أبو كبير
Faqous|فاقوس
Hihya|ههيا
Diyarb Negm|ديرب نجم
Kafr Saqr|كفر صقر
Awlad Saqr|أولاد صقر
Mashtoul El Souk|مشتول السوق
El Husseiniya|الحسينية
San El Hagar|صان الحجر
El Ibrahimiya|الإبراهيمية
El Qanayat|القنايات
El Salhiya El Gedida|الصالحية الجديدة
El Qurein|القرين
"""),
    ('dakahlia', 'Dakahlia', 'الدقهلية', 12, """
Mansoura|المنصورة
Talkha|طلخا
Mit Ghamr|ميت غمر
Aga|أجا
El Sinbillawin|السنبلاوين
Dikirnis|دكرنس
Belqas|بلقاس
Sherbin|شربين
El Manzala|المنزلة
El Gamaliya|الجمالية
Minyat El Nasr|منية النصر
Mit Salsil|ميت سلسيل
Nabaroh|نبروه
Temay El Amdid|تمي الأمديد
El Kurdi|الكردي
Beni Ebeid|بني عبيد
El Matareya|المطرية
Gamasa|جمصة
New Mansoura|المنصورة الجديدة
"""),
    ('gharbia', 'Gharbia', 'الغربية', 13, """
Tanta|طنطا
El Mahalla El Kubra|المحلة الكبرى
Kafr El Zayat|كفر الزيات
Zefta|زفتى
Samanoud|سمنود
El Santa|السنطة
Basyoun|بسيون
Qutur|قطور
"""),
    ('menoufia', 'Menoufia', 'المنوفية', 14, """
Shebin El Kom|شبين الكوم
Menouf|منوف
Sadat City|مدينة السادات
Ashmoun|أشمون
Quesna|قويسنا
Tala|تلا
El Bagour|الباجور
Berket El Sabaa|بركة السبع
El Shohada|الشهداء
Sers El Lyan|سرس الليان
"""),
    ('kafr-el-sheikh', 'Kafr El Sheikh', 'كفر الشيخ', 15, """
Kafr El Sheikh|كفر الشيخ
Desouk|دسوق
Fuwa|فوه
Metoubes|مطوبس
Baltim|بلطيم
Sidi Salem|سيدي سالم
Qallin|قلين
Biyala|بيلا
El Hamoul|الحامول
El Riyad|الرياض
Burullus|البرلس
"""),
    ('beheira', 'Beheira', 'البحيرة', 16, """
Damanhour|دمنهور
Kafr El Dawar|كفر الدوار
Rashid (Rosetta)|رشيد
Edku|إدكو
Abu El Matamir|أبو المطامير
Abu Hummus|أبو حمص
Hosh Issa|حوش عيسى
Itay El Barud|إيتاي البارود
Kom Hamada|كوم حمادة
El Delengat|الدلنجات
Shubrakhit|شبراخيت
El Mahmudiyah|المحمودية
El Rahmaniya|الرحمانية
Badr|بدر
Wadi El Natrun|وادي النطرون
El Nubariya|النوبارية
"""),
    ('damietta', 'Damietta', 'دمياط', 17, """
Damietta|دمياط
New Damietta|دمياط الجديدة
Ras El Bar|رأس البر
Faraskur|فارسكور
Kafr Saad|كفر سعد
El Zarqa|الزرقا
Kafr El Battikh|كفر البطيخ
Ezbet El Borg|عزبة البرج
El Rawda|الروضة
"""),
    ('port-said', 'Port Said', 'بورسعيد', 18, """
El Sharq|حي الشرق
El Arab|حي العرب
El Manakh|حي المناخ
El Zohour|حي الزهور
El Dawahi|حي الضواحي
El Ganoub|حي الجنوب
El Gharb|حي الغرب
Port Fouad|بورفؤاد
"""),
    ('ismailia', 'Ismailia', 'الإسماعيلية', 19, """
Ismailia|الإسماعيلية
Fayed|فايد
El Qantara Sharq|القنطرة شرق
El Qantara Gharb|القنطرة غرب
El Tal El Kebir|التل الكبير
Abu Suwir|أبو صوير
El Qassasin|القصاصين
"""),
    ('suez', 'Suez', 'السويس', 20, """
El Suez|حي السويس
El Arbaeen|حي الأربعين
Ataka|حي عتاقة
El Ganayen|حي الجناين
Faisal|حي فيصل
"""),
    ('north-sinai', 'North Sinai', 'شمال سيناء', 21, """
El Arish|العريش
Sheikh Zuweid|الشيخ زويد
Rafah|رفح
Bir El Abd|بئر العبد
El Hasana|الحسنة
Nakhl|نخل
"""),
    ('south-sinai', 'South Sinai', 'جنوب سيناء', 22, """
Sharm El Sheikh|شرم الشيخ
El Tor|الطور
Dahab|دهب
Nuweiba|نويبع
Taba|طابا
Saint Catherine|سانت كاترين
Ras Sidr|رأس سدر
Abu Rudeis|أبو رديس
Abu Zenima|أبو زنيمة
"""),
    ('red-sea', 'Red Sea', 'البحر الأحمر', 23, """
Hurghada|الغردقة
El Gouna|الجونة
Safaga|سفاجا
El Quseir|القصير
Marsa Alam|مرسى علم
Ras Gharib|رأس غارب
Shalateen|الشلاتين
Halayeb|حلايب
"""),
    ('fayoum', 'Fayoum', 'الفيوم', 24, """
Fayoum|الفيوم
New Fayoum|الفيوم الجديدة
Ibsheway|إبشواي
Itsa|إطسا
Tamiya|طامية
Sinnuris|سنورس
Youssef El Seddik|يوسف الصديق
"""),
    ('beni-suef', 'Beni Suef', 'بني سويف', 25, """
Beni Suef|بني سويف
New Beni Suef|بني سويف الجديدة
El Wasta|الواسطى
Nasser|ناصر
Ihnasya|إهناسيا
Beba|ببا
El Fashn|الفشن
Somosta|سمسطا
"""),
    ('minya', 'Minya', 'المنيا', 26, """
Minya|المنيا
New Minya|المنيا الجديدة
Mallawi|ملوي
Samalut|سمالوط
Matai|مطاي
Beni Mazar|بني مزار
Maghagha|مغاغة
El Idwa|العدوة
Abu Qurqas|أبو قرقاص
Deir Mawas|دير مواس
"""),
    ('assiut', 'Assiut', 'أسيوط', 27, """
Assiut|أسيوط
New Assiut|أسيوط الجديدة
Dairut|ديروط
Manfalut|منفلوط
El Qusiya|القوصية
Abnub|أبنوب
Abu Tig|أبو تيج
El Ghanayem|الغنايم
Sahel Selim|ساحل سليم
El Badari|البداري
Sidfa|صدفا
El Fath|الفتح
"""),
    ('sohag', 'Sohag', 'سوهاج', 28, """
Sohag|سوهاج
New Sohag|سوهاج الجديدة
Akhmim|أخميم
El Balyana|البلينا
Girga|جرجا
Tahta|طهطا
Tima|طما
El Maragha|المراغة
El Monshah|المنشأة
Dar El Salam|دار السلام
Juhayna|جهينة
Saqulta|ساقلتة
El Usayrat|العسيرات
"""),
    ('qena', 'Qena', 'قنا', 29, """
Qena|قنا
Nag Hammadi|نجع حمادي
Qus|قوص
Deshna|دشنا
Abu Tesht|أبو تشت
Farshut|فرشوط
Qift|قفط
Naqada|نقادة
El Waqf|الوقف
"""),
    ('luxor', 'Luxor', 'الأقصر', 30, """
Luxor|الأقصر
Esna|إسنا
Armant|أرمنت
El Tod|الطود
El Qurna|القرنة
El Bayadiya|البياضية
El Zeiniya|الزينية
"""),
    ('aswan', 'Aswan', 'أسوان', 31, """
Aswan|أسوان
New Aswan|أسوان الجديدة
Kom Ombo|كوم أمبو
Edfu|إدفو
Daraw|دراو
Nasr El Nuba|نصر النوبة
Abu Simbel|أبو سمبل
"""),
    ('new-valley', 'New Valley', 'الوادي الجديد', 32, """
El Kharga|الخارجة
El Dakhla|الداخلة
El Farafra|الفرافرة
Baris|باريس
Balat|بلاط
"""),
    ('matrouh', 'Matrouh', 'مطروح', 33, """
Marsa Matrouh|مرسى مطروح
El Alamein|العلمين
New Alamein|العلمين الجديدة
El Hammam|الحمام
El Dabaa|الضبعة
Sidi Barrani|سيدي براني
El Salloum|السلوم
Siwa|سيوة
"""),
]

# specialty slug -> list of (slug, English, Arabic). Existing rows are skipped by ON CONFLICT.
SUBSPECIALTIES = {
    'obgyn': [
        ('fetal-medicine', 'Fetal medicine (maternal-fetal medicine)', 'طب الأجنة'),
        ('ivf', 'IVF and ICSI', 'أطفال الأنابيب والحقن المجهري'),
        ('gynecologic-oncology', 'Gynecologic oncology', 'أورام النساء'),
        ('urogynecology', 'Urogynecology (pelvic floor)', 'مسالك بولية للسيدات وقاع الحوض'),
        ('hysteroscopy', 'Hysteroscopy', 'مناظير الرحم'),
        ('menopause', 'Menopause', 'سن انقطاع الطمث'),
        ('family-planning', 'Family planning', 'تنظيم الأسرة'),
        ('pcos', 'PCOS and hormonal disorders', 'تكيس المبايض واضطرابات الهرمونات'),
        ('cosmetic-gynecology', 'Cosmetic gynecology', 'تجميل نسائي'),
        ('pregnancy-follow-up', 'Pregnancy follow-up', 'متابعة الحمل'),
    ],
    'dentistry': [
        ('prosthodontics', 'Prosthodontics (crowns and dentures)', 'تركيبات الأسنان'),
        ('periodontics', 'Periodontics (gums)', 'علاج اللثة'),
        ('oral-surgery', 'Oral and maxillofacial surgery', 'جراحة الفم والوجه والفكين'),
        ('restorative-dentistry', 'Restorative dentistry (fillings)', 'العلاج التحفظي والحشوات'),
        ('oral-medicine', 'Oral medicine and dental radiology', 'طب الفم وأشعة الأسنان'),
        ('special-needs-dentistry', 'Special-needs dentistry', 'أسنان ذوي الاحتياجات الخاصة'),
        ('tmj', 'Jaw joint (TMJ) disorders', 'اضطرابات مفصل الفك'),
    ],
    'cardiology': [
        ('hypertension', 'Hypertension', 'ارتفاع ضغط الدم'),
        ('structural-heart', 'Structural heart disease', 'أمراض صمامات القلب والعيوب الهيكلية'),
        ('cardiac-imaging', 'Cardiac CT and MRI', 'أشعة القلب المقطعية والرنين'),
        ('adult-congenital', 'Adult congenital heart disease', 'عيوب القلب الخلقية للكبار'),
        ('peripheral-vascular', 'Peripheral vascular disease', 'أمراض الأوعية الدموية الطرفية'),
        ('cardiac-rehab', 'Cardiac rehabilitation', 'تأهيل القلب'),
        ('preventive-cardiology', 'Preventive cardiology and cholesterol', 'الوقاية من أمراض القلب والكوليسترول'),
    ],
    'orthopedics': [
        ('hand', 'Hand surgery', 'جراحة اليد'),
        ('foot-ankle', 'Foot and ankle', 'القدم والكاحل'),
        ('hip', 'Hip', 'مفصل الفخذ'),
        ('joint-replacement', 'Joint replacement', 'تغيير المفاصل'),
        ('pediatric-orthopedics', 'Pediatric orthopedics', 'عظام الأطفال'),
        ('trauma', 'Fractures and trauma', 'الكسور والإصابات'),
        ('arthroscopy', 'Arthroscopy', 'مناظير المفاصل'),
        ('bone-tumors', 'Bone tumors', 'أورام العظام'),
        ('osteoporosis', 'Osteoporosis', 'هشاشة العظام'),
        ('limb-reconstruction', 'Limb lengthening and deformity correction', 'تقويم وإطالة العظام'),
    ],
    'pediatrics': [
        ('pediatric-gastroenterology', 'Pediatric gastroenterology and hepatology', 'جهاز هضمي وكبد أطفال'),
        ('pediatric-endocrinology', 'Pediatric endocrinology and diabetes', 'غدد صماء وسكر أطفال'),
        ('pediatric-neurology', 'Pediatric neurology', 'مخ وأعصاب أطفال'),
        ('pediatric-nephrology', 'Pediatric nephrology', 'كلى أطفال'),
        ('pediatric-hematology-oncology', 'Pediatric hematology and oncology', 'أمراض الدم والأورام للأطفال'),
        ('pediatric-pulmonology', 'Pediatric pulmonology', 'صدر أطفال'),
        ('pediatric-infectious', 'Pediatric infectious diseases', 'أمراض معدية أطفال'),
        ('pediatric-nutrition', 'Pediatric nutrition', 'تغذية الأطفال'),
        ('adolescent', 'Adolescent medicine', 'طب المراهقين'),
        ('vaccination', 'Vaccinations and well-child visits', 'التطعيمات ومتابعة النمو'),
    ],
    'dermatology': [
        ('laser', 'Laser treatments', 'الليزر'),
        ('pediatric-dermatology', 'Pediatric dermatology', 'جلدية أطفال'),
        ('psoriasis-vitiligo', 'Psoriasis and vitiligo', 'الصدفية والبهاق'),
        ('venereology', 'Sexually transmitted infections', 'الأمراض التناسلية'),
        ('dermatosurgery', 'Skin surgery', 'جراحات الجلد'),
        ('skin-allergy', 'Skin allergy and eczema', 'حساسية الجلد والإكزيما'),
        ('nails', 'Nail disorders', 'أمراض الأظافر'),
    ],
    'ent': [
        ('head-neck', 'Head and neck surgery', 'جراحة الرأس والرقبة'),
        ('voice', 'Voice and larynx', 'الحنجرة والأحبال الصوتية'),
        ('snoring-sleep-apnea', 'Snoring and sleep apnea', 'الشخير وانقطاع النفس أثناء النوم'),
        ('nasal-allergy', 'Nasal allergy', 'حساسية الأنف'),
        ('cochlear-implant', 'Cochlear implants', 'زراعة القوقعة'),
        ('rhinoplasty', 'Rhinoplasty', 'تجميل الأنف'),
        ('vertigo', 'Dizziness and balance', 'الدوخة والاتزان'),
    ],
    'neurology': [
        ('multiple-sclerosis', 'Multiple sclerosis', 'التصلب المتعدد'),
        ('movement-disorders', "Parkinson's and movement disorders", 'باركنسون واضطرابات الحركة'),
        ('neuromuscular', 'Nerve and muscle diseases', 'أمراض الأعصاب الطرفية والعضلات'),
        ('dementia', "Memory and Alzheimer's", 'الذاكرة والزهايمر'),
        ('sleep-disorders', 'Sleep disorders', 'اضطرابات النوم'),
        ('neurophysiology', 'EEG and nerve conduction studies', 'رسم المخ والأعصاب'),
        ('spine-pain', 'Back pain and sciatica', 'آلام الظهر وعرق النسا'),
    ],
    'ophthalmology': [
        ('cataract', 'Cataract', 'المياه البيضاء'),
        ('glaucoma', 'Glaucoma', 'المياه الزرقاء'),
        ('cornea', 'Cornea', 'القرنية'),
        ('oculoplastics', 'Eyelid and oculoplastic surgery', 'جراحة وتجميل الجفون'),
        ('strabismus', 'Squint (strabismus)', 'الحول'),
        ('uveitis', 'Uveitis', 'التهاب القزحية'),
        ('neuro-ophthalmology', 'Neuro-ophthalmology', 'أعصاب العيون'),
        ('contact-lenses', 'Contact lenses and low vision', 'العدسات اللاصقة وضعف الإبصار'),
    ],
    'internal-medicine': [
        ('nephrology', 'Nephrology (kidneys)', 'الكلى'),
        ('endocrinology', 'Endocrinology (thyroid and hormones)', 'الغدد الصماء'),
        ('rheumatology', 'Rheumatology', 'الروماتيزم والمناعة'),
        ('hematology', 'Hematology (blood)', 'أمراض الدم'),
        ('oncology', 'Medical oncology', 'الأورام'),
        ('pulmonology', 'Chest and pulmonology', 'الصدر والجهاز التنفسي'),
        ('infectious-diseases', 'Infectious and tropical diseases', 'الأمراض المعدية والمتوطنة'),
        ('geriatrics', 'Geriatrics (older adults)', 'طب المسنين'),
        ('hypertension', 'Hypertension', 'ارتفاع ضغط الدم'),
        ('obesity-nutrition', 'Obesity and clinical nutrition', 'السمنة والتغذية العلاجية'),
        ('endoscopy', 'Endoscopy', 'مناظير الجهاز الهضمي'),
        ('allergy-immunology', 'Allergy and immunology', 'الحساسية والمناعة'),
    ],
    'psychiatry': [
        ('addiction', 'Addiction treatment', 'علاج الإدمان'),
        ('geriatric-psychiatry', 'Older-adult psychiatry', 'الطب النفسي لكبار السن'),
        ('psychotherapy', 'Psychotherapy', 'العلاج النفسي'),
        ('eating-disorders', 'Eating disorders', 'اضطرابات الأكل'),
        ('family-therapy', 'Couples and family therapy', 'العلاج الأسري والزوجي'),
        ('adhd-autism', 'ADHD and autism', 'فرط الحركة وتشتت الانتباه والتوحد'),
        ('anxiety-depression', 'Anxiety and depression', 'القلق والاكتئاب'),
    ],
    'urology': [
        ('prostate', 'Prostate', 'البروستاتا'),
        ('urologic-oncology', 'Urologic oncology', 'أورام المسالك البولية'),
        ('pediatric-urology', 'Pediatric urology', 'مسالك بولية أطفال'),
        ('male-infertility', 'Male infertility', 'عقم الرجال'),
        ('kidney-transplant', 'Kidney transplant', 'زراعة الكلى'),
        ('incontinence', 'Urinary incontinence', 'سلس البول'),
        ('laparoscopic-urology', 'Laparoscopic and endoscopic urology', 'مناظير المسالك البولية'),
    ],
}

EXISTING_ALEX = ['smouha', 'roushdy', 'louran', 'sporting', 'stanley', 'gleem', 'sidi-gaber', 'cleopatra', 'ibrahimia', 'shatby',
                 'azarita', 'raml-station', 'mansheya', 'moharram-bey', 'kafr-abdo', 'san-stefano', 'sidi-bishr', 'miami', 'asafra',
                 'mandara', 'montaza', 'maamoura', 'agami', 'victoria']
