-- Load-test data: about a busy first year (500 doctors, 20,000 patients, ~380,000 visits,
-- ~78,000 patient files and visit notes, ~63,000 reviews). LOCAL load-test database ONLY,
-- after migrations and the demo seed (it copies demo rows as templates). Never run on the live database.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/load/bulk.sql
do $$ begin
  if exists (select 1 from users where full_name = 'Load Doctor 1') then raise exception 'load data already added'; end if;
  if not exists (select 1 from users where phone_e164 = '+201000000101') then raise exception 'run the demo seed first'; end if;
end $$;
-- Template rows taken from the demo (Dr. Ahmed and his main clinic; patient Yasmin).
create temp table tpl as
select d.user_id as doc_user, c.id as clinic_id, pu.id as pat_user
from doctors d join users du on du.id = d.user_id and du.phone_e164 = '+201000000101'
join lateral (select id from clinics where doctor_id = d.user_id order by created_at limit 1) c on true
join users pu on pu.phone_e164 = '+201000000201';

-- 500 doctors
create temp table newdocs as
select n, gen_random_uuid() as uid, gen_random_uuid() as cid from generate_series(1, 500) n;
insert into users select (jsonb_populate_record(null::users, to_jsonb(u) || jsonb_build_object(
  'id', nd.uid, 'full_name', 'Load Doctor ' || nd.n, 'phone_e164', '+2011' || lpad(nd.n::text, 8, '0'), 'email', null))).*
from newdocs nd, users u, tpl where u.id = tpl.doc_user;
insert into doctors select (jsonb_populate_record(null::doctors, to_jsonb(d) || jsonb_build_object(
  'user_id', nd.uid, 'slug', 'load-doctor-' || nd.n,
  'specialty_id', (select id from specialties order by id offset (nd.n % (select count(*) from specialties)) limit 1),
  'kind', case when nd.n % 7 = 0 then 'dental' else 'medical' end,
  'gender', case when nd.n % 2 = 0 then 'female' else 'male' end))).*
from newdocs nd, doctors d, tpl where d.user_id = tpl.doc_user;
insert into clinics select (jsonb_populate_record(null::clinics, to_jsonb(c) || jsonb_build_object(
  'id', nd.cid, 'doctor_id', nd.uid, 'name', 'Load Clinic ' || nd.n,
  'district_id', (select id from districts order by id offset (nd.n % (select count(*) from districts)) limit 1),
  'fee_egp', 200 + (nd.n % 10) * 50))).*
from newdocs nd, clinics c, tpl where c.id = tpl.clinic_id;
insert into schedule_rules select (jsonb_populate_record(null::schedule_rules, to_jsonb(r) || jsonb_build_object(
  'id', gen_random_uuid(), 'clinic_id', nd.cid))).*
from newdocs nd, schedule_rules r, tpl where r.clinic_id = tpl.clinic_id;

-- 20,000 patients
create temp table newpats as select n, gen_random_uuid() as uid from generate_series(1, 20000) n;
insert into users select (jsonb_populate_record(null::users, to_jsonb(u) || jsonb_build_object(
  'id', np.uid, 'full_name', 'Load Patient ' || np.n, 'phone_e164', '+2012' || lpad(np.n::text, 8, '0'), 'email', null))).*
from newpats np, users u, tpl where u.id = tpl.pat_user;
create temp table patidx as select row_number() over () as k, uid from newpats;

-- ~200,000 visits: each doctor, every other day for a year back and two weeks ahead, 4 visits a day at 30-minute slots.
insert into appointments (doctor_id, clinic_id, patient_id, booked_by, starts_at, ends_at, visit_type, fee_egp, status, completed_at)
select nd.uid, nd.cid, p.uid, 'patient', t, t + interval '30 minutes',
  case when s % 3 = 0 then 'follow_up' else 'new' end, 300,
  case when t > now() then 'confirmed' when (nd.n + day + s) % 17 = 0 then 'no_show' when (nd.n + day + s) % 11 = 0 then 'cancelled' else 'completed' end,
  case when t < now() and (nd.n + day + s) % 17 <> 0 and (nd.n + day + s) % 11 <> 0 then t + interval '25 minutes' end
from newdocs nd
cross join generate_series(-365, 14, 2) day
cross join generate_series(0, 3) s
cross join lateral (select (date_trunc('day', now() at time zone 'Africa/Cairo') + make_interval(days => day, hours => 10, mins => 30 * s)) at time zone 'Africa/Cairo' as t) tt
join patidx p on p.k = 1 + ((nd.n * 7919 + day * 104729 + s * 31) % 20000 + 20000) % 20000;

-- Patient files (~50,000) and visit notes (~100,000)
insert into patient_records (doctor_id, patient_user_id, full_name, phone_e164, consent_at)
select distinct on (a.doctor_id, a.patient_id) a.doctor_id, a.patient_id, u.full_name, u.phone_e164, now()
from appointments a join users u on u.id = a.patient_id join newdocs nd on nd.uid = a.doctor_id
where a.status = 'completed' and (hashtext(a.id::text) % 4) = 0
on conflict do nothing;
insert into encounters (record_id, doctor_id, appointment_id, chief_complaint, diagnosis)
select r.id, a.doctor_id, a.id, 'Headache and fatigue', 'Tension headache'
from appointments a join patient_records r on r.doctor_id = a.doctor_id and r.patient_user_id = a.patient_id
join users du on du.id = a.doctor_id and du.full_name like 'Load Doctor %'
where a.status = 'completed'
on conflict do nothing;
insert into reviews (appointment_id, doctor_id, patient_id, rating)
select a.id, a.doctor_id, a.patient_id, 3 + abs(hashtext(a.id::text)) % 3
from appointments a join users du on du.id = a.doctor_id and du.full_name like 'Load Doctor %'
where a.status = 'completed' and abs(hashtext(a.id::text)) % 5 = 0
on conflict do nothing;
analyze;
select (select count(*) from users) users, (select count(*) from doctors) doctors, (select count(*) from appointments) appts,
       (select count(*) from patient_records) records, (select count(*) from encounters) encounters, (select count(*) from reviews) reviews,
       pg_size_pretty(pg_database_size('loadtest')) size;
