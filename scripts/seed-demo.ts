/**
 * Demo data for local development and staging walkthroughs ONLY.
 * Refuses to run in production unless DEMO_MODE=true. All names, numbers and insurers are fictional.
 *
 *   npm run seed:demo
 */
import { loadConfig } from '../src/config.js';
import { createDb, type Queryable } from '../src/db/db.js';
import { hashPassword } from '../src/auth/password.js';
import { clearReferenceCache } from '../src/services/reference.js';
import { DEMO_PASSWORD } from '../src/demo.js';

const cfg = loadConfig();
if (cfg.NODE_ENV === 'production' && !cfg.DEMO_MODE) {
  console.error('Refusing to seed demo data in production (set DEMO_MODE=true only for a public demo).');
  process.exit(1);
}

interface DemoDoctor {
  name: string;
  phone: string;
  specialty: string;
  subs: string[];
  titleEn: string;
  titleAr: string;
  district: string;
  clinic: string;
  fee: number;
  days: number[];
  from: string;
  to: string;
  positions: [string, string, string, string | null][];
}

const doctors: DemoDoctor[] = [
  { name: 'Ahmed Hassan', phone: '+201000000101', specialty: 'cardiology', subs: ['heart-failure', 'echocardiography'], titleEn: 'Consultant Cardiologist · MD', titleAr: 'استشاري أمراض القلب · دكتوراه', district: 'smouha', clinic: 'Smouha Heart Clinic', fee: 500, days: [0, 2, 4], from: '17:00', to: '21:00', positions: [['Resident, Cardiology', 'University Hospital', '2014-09-01', '2018-08-01'], ['Consultant Cardiologist', 'Demo Hospital', '2018-09-01', null]] },
  { name: 'Sara Mostafa', phone: '+201000000102', specialty: 'cardiology', subs: ['interventional'], titleEn: 'Lecturer of Cardiology', titleAr: 'مدرس أمراض القلب', district: 'roushdy', clinic: 'Roushdy Medical Center', fee: 450, days: [1, 3], from: '16:00', to: '20:00', positions: [['Specialist, Cardiology', 'Demo Hospital', '2016-01-01', null]] },
  { name: 'Omar Khalil', phone: '+201000000103', specialty: 'orthopedics', subs: ['knee', 'sports-injuries'], titleEn: 'Orthopedic Surgeon', titleAr: 'جراح عظام', district: 'sporting', clinic: 'Sporting Ortho', fee: 400, days: [0, 1, 2, 3, 4, 6], from: '18:00', to: '22:00', positions: [['Orthopedic Surgeon', 'Demo Sports Clinic', '2019-03-01', null]] },
  { name: 'Nour El-Sayed', phone: '+201000000104', specialty: 'dentistry', subs: ['endodontics', 'cosmetic-dentistry'], titleEn: 'Dentist · Endodontics', titleAr: 'طبيبة أسنان · علاج جذور', district: 'louran', clinic: 'Louran Dental', fee: 300, days: [0, 1, 2, 3, 4, 6], from: '12:00', to: '20:00', positions: [['Dentist', 'Demo Dental Center', '2020-07-01', null]] },
  { name: 'Mona Adel', phone: '+201000000105', specialty: 'pediatrics', subs: ['allergy-asthma'], titleEn: 'Pediatrician', titleAr: 'طبيبة أطفال', district: 'stanley', clinic: 'Stanley Kids Clinic', fee: 350, days: [0, 1, 2, 3, 4, 5, 6], from: '10:00', to: '14:00', positions: [['Pediatrician', 'Demo Children’s Hospital', '2015-10-01', null]] },
  { name: 'Karim Youssef', phone: '+201000000106', specialty: 'neurology', subs: ['headache'], titleEn: 'Neurologist', titleAr: 'استشاري المخ والأعصاب', district: 'gleem', clinic: 'Gleem Neuro', fee: 600, days: [1, 3, 5], from: '15:00', to: '19:00', positions: [['Neurologist', 'Demo Hospital', '2012-02-01', '2019-02-01'], ['Consultant Neurologist', 'Demo Neuro Center', '2018-06-01', null]] },
];

async function id(db: Queryable, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await db.query<{ id: number }>(sql, params);
  if (!rows[0]) throw new Error(`reference not found: ${JSON.stringify(params)}`);
  return rows[0].id;
}

const db = createDb(cfg);
try {
  const hash = await hashPassword(DEMO_PASSWORD);
  await db.transaction(async (tx) => {
    await tx.query(`insert into insurers (slug, name_en, name_ar) values
      ('demo-insurer-a', 'Demo Insurer A', 'تأمين تجريبي أ'), ('demo-insurer-b', 'Demo Insurer B', 'تأمين تجريبي ب')
      on conflict (slug) do nothing`);
    const insurerA = await id(tx, 'select id from insurers where slug = $1', ['demo-insurer-a']);

    for (const d of doctors) {
      const specialtyId = await id(tx, 'select id from specialties where slug = $1', [d.specialty]);
      const kind = d.specialty === 'dentistry' ? 'dental' : 'medical';
      const { rows } = await tx.query<{ id: string }>(
        `insert into users (role, full_name, phone_e164, email, password_hash, phone_verified_at)
         values ('doctor', $1, $2, $3, $4, now())
         on conflict (phone_e164) do update set full_name = excluded.full_name returning id`,
        [`Dr. ${d.name}`, d.phone, `${d.name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, hash],
      );
      const userId = rows[0]!.id;
      const slug = `dr-${d.name.toLowerCase().replace(/[^a-z]+/g, '-')}`;
      await tx.query(
        `insert into doctors (user_id, slug, kind, title_en, title_ar, bio, specialty_id, graduation_year, languages, verification_status, verified_at)
         values ($1, $2, $3, $4, $5, $6, $7, 2008, '{ar,en}', 'approved', now())
         on conflict (user_id) do nothing`,
        [userId, slug, kind, d.titleEn, d.titleAr, 'Demo profile for testing. Not a real doctor.', specialtyId],
      );
      await tx.query('delete from doctor_subspecialties where doctor_id = $1', [userId]);
      for (const s of d.subs) {
        await tx.query(
          `insert into doctor_subspecialties (doctor_id, subspecialty_id) select $1, id from subspecialties where slug = $2 and specialty_id = $3 on conflict do nothing`,
          [userId, s, specialtyId],
        );
      }
      await tx.query('insert into doctor_insurers (doctor_id, insurer_id) values ($1, $2) on conflict do nothing', [userId, insurerA]);
      const existing = await tx.query('select 1 from clinics where doctor_id = $1', [userId]);
      if (!existing.rows.length) {
        const districtId = await id(tx, 'select id from districts where slug = $1', [d.district]);
        const clinic = await tx.query<{ id: string }>(
          `insert into clinics (doctor_id, name, district_id, address, fee_egp) values ($1, $2, $3, $4, $5) returning id`,
          [userId, d.clinic, districtId, `Demo street ${Math.floor(Math.random() * 90) + 10}`, d.fee],
        );
        for (const day of d.days) {
          await tx.query(`insert into schedule_rules (clinic_id, weekday, start_time, end_time, slot_minutes) values ($1, $2, $3, $4, 30)`, [
            clinic.rows[0]!.id,
            day,
            d.from,
            d.to,
          ]);
        }
        for (const [title, workplace, start, end] of d.positions) {
          await tx.query('insert into doctor_positions (doctor_id, title, workplace, start_month, end_month) values ($1, $2, $3, $4, $5)', [userId, title, workplace, start, end]);
        }
      }
    }

    await tx.query(
      `insert into users (role, full_name, phone_e164, password_hash, phone_verified_at) values ('patient', 'Demo Patient', '+201000000201', $1, now())
       on conflict (phone_e164) do nothing`,
      [hash],
    );
  });
  clearReferenceCache();
  console.log(`Demo data ready. Patient 01000000201 / doctors 01000000101..106, password: ${DEMO_PASSWORD}`);
} finally {
  await db.end();
}
