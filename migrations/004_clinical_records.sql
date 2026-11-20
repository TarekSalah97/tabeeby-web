-- Clinical records: a doctor's patient files, visits (encounters), prescriptions and lab orders.
-- Health data. Every table is owned by one doctor (doctor_id) and every query must be scoped by it.
-- Stored once and shown to the doctor (everything) and to the patient (issued prescriptions and
-- lab orders only, and only for files linked to their account).

-- Per-doctor switch, turned on by an admin. Off by default.
alter table doctors add column records_enabled boolean not null default false;

-- A doctor's file on one patient. Either linked to a Tabeeby patient account (patient_user_id)
-- or a walk-in the doctor added by hand (patient_user_id null).
create table patient_records (
  id                   uuid primary key default gen_random_uuid(),
  doctor_id            uuid not null references doctors(user_id),
  patient_user_id      uuid references users(id),
  full_name            text not null check (char_length(full_name) between 2 and 120),
  phone_e164           text check (phone_e164 ~ '^\+201[0125][0-9]{8}$'),
  date_of_birth        date check (date_of_birth >= date '1900-01-01'),
  sex                  text check (sex in ('male', 'female')),
  occupation           text check (char_length(occupation) <= 120),
  marital_status       text check (marital_status in ('single', 'married', 'divorced', 'widowed')),
  habits               text[] not null default '{}'
                       check (habits <@ array['smoking', 'ex_smoker', 'shisha', 'alcohol', 'caffeine', 'exercise']::text[]),
  habits_note          text check (char_length(habits_note) <= 500),
  allergies            text check (char_length(allergies) <= 2000),
  chronic_conditions   text check (char_length(chronic_conditions) <= 2000),
  past_history         text check (char_length(past_history) <= 2000),
  current_medications  text check (char_length(current_medications) <= 2000),
  family_history       text check (char_length(family_history) <= 2000),
  -- When the doctor confirmed the patient agreed to the file being kept.
  consent_at           timestamptz not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, doctor_id)
);
create unique index patient_records_account_idx on patient_records(doctor_id, patient_user_id) where patient_user_id is not null;
create index patient_records_doctor_idx on patient_records(doctor_id, updated_at desc);
create index patient_records_patient_idx on patient_records(patient_user_id) where patient_user_id is not null;

-- One visit. Notes follow the usual SOAP layout: history (subjective), examination (objective),
-- diagnosis (assessment), plan.
create table encounters (
  id                uuid primary key default gen_random_uuid(),
  record_id         uuid not null,
  doctor_id         uuid not null,
  appointment_id    uuid unique references appointments(id),
  clinic_id         uuid references clinics(id),
  visit_at          timestamptz not null default now(),
  chief_complaint   text not null check (char_length(chief_complaint) between 1 and 500),
  history           text check (char_length(history) <= 4000),
  examination       text check (char_length(examination) <= 4000),
  diagnosis         text check (char_length(diagnosis) <= 1000),
  plan              text check (char_length(plan) <= 4000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- A visit always belongs to a file of the same doctor.
  foreign key (record_id, doctor_id) references patient_records(id, doctor_id),
  unique (id, doctor_id)
);
create index encounters_record_idx on encounters(record_id, visit_at desc);

-- Prescriptions are never edited: a mistake is fixed by cancelling (voiding) and issuing a new one.
create table prescriptions (
  id            uuid primary key default gen_random_uuid(),
  encounter_id  uuid not null,
  doctor_id     uuid not null,
  notes         text check (char_length(notes) <= 500),
  status        text not null default 'active' check (status in ('active', 'voided')),
  void_reason   text check (char_length(void_reason) <= 300),
  voided_at     timestamptz,
  issued_at     timestamptz not null default now(),
  foreign key (encounter_id, doctor_id) references encounters(id, doctor_id),
  check ((status = 'voided') = (voided_at is not null))
);
create index prescriptions_encounter_idx on prescriptions(encounter_id);

create table prescription_items (
  prescription_id  uuid not null references prescriptions(id),
  position         smallint not null check (position between 1 and 20),
  medicine         text not null check (char_length(medicine) between 1 and 160),
  form             text not null check (form in ('tablet', 'capsule', 'syrup', 'suspension', 'drops', 'injection', 'cream', 'ointment',
                                                 'gel', 'spray', 'inhaler', 'suppository', 'sachet', 'effervescent', 'lozenge', 'patch', 'mouthwash', 'other')),
  dose             text not null check (char_length(dose) between 1 and 60),
  frequency        text not null check (frequency in ('once_daily', 'twice_daily', 'three_daily', 'four_daily', 'every_4h', 'every_6h',
                                                      'every_8h', 'every_12h', 'weekly', 'as_needed', 'single_dose', 'see_instructions')),
  timing           text check (timing in ('after_meals', 'before_meals', 'with_meals', 'empty_stomach', 'morning', 'bedtime')),
  duration         text check (char_length(duration) <= 60),
  instructions     text check (char_length(instructions) <= 200),
  primary key (prescription_id, position)
);

create table lab_orders (
  id            uuid primary key default gen_random_uuid(),
  encounter_id  uuid not null,
  doctor_id     uuid not null,
  notes         text check (char_length(notes) <= 500),
  status        text not null default 'active' check (status in ('active', 'voided')),
  void_reason   text check (char_length(void_reason) <= 300),
  voided_at     timestamptz,
  issued_at     timestamptz not null default now(),
  foreign key (encounter_id, doctor_id) references encounters(id, doctor_id),
  check ((status = 'voided') = (voided_at is not null))
);
create index lab_orders_encounter_idx on lab_orders(encounter_id);

-- A test from the built-in list (test_code) or one the doctor typed (test_name).
create table lab_order_items (
  lab_order_id  uuid not null references lab_orders(id),
  position      smallint not null check (position between 1 and 60),
  test_code     text check (test_code ~ '^[a-z0-9_]{2,40}$'),
  test_name     text check (char_length(test_name) between 1 and 120),
  primary key (lab_order_id, position),
  check ((test_code is null) <> (test_name is null))
);

-- Issued prescription and lab-order lines can never change. Only the void columns of the headers may.
create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'issued % rows cannot be changed', tg_table_name using errcode = 'P0001';
end $$;
create trigger prescription_items_frozen before update or delete on prescription_items for each row execute function forbid_change();
create trigger lab_order_items_frozen before update or delete on lab_order_items for each row execute function forbid_change();

create function only_void_change() returns trigger language plpgsql as $$
begin
  if old.status = 'voided'
     or new.id <> old.id or new.encounter_id <> old.encounter_id or new.doctor_id <> old.doctor_id
     or new.notes is distinct from old.notes or new.issued_at <> old.issued_at then
    raise exception 'issued % rows can only be voided', tg_table_name using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger prescriptions_void_only before update on prescriptions for each row execute function only_void_change();
create trigger lab_orders_void_only before update on lab_orders for each row execute function only_void_change();
create trigger prescriptions_no_delete before delete on prescriptions for each row execute function forbid_change();
create trigger lab_orders_no_delete before delete on lab_orders for each row execute function forbid_change();

-- Previous versions of edited files and visit notes, so a change never erases what was written.
create table record_revisions (
  id           bigserial primary key,
  entity_type  text not null check (entity_type in ('patient_record', 'encounter')),
  entity_id    uuid not null,
  doctor_id    uuid not null references doctors(user_id),
  data         jsonb not null,
  changed_at   timestamptz not null default now()
);
create index record_revisions_entity_idx on record_revisions(entity_type, entity_id, changed_at desc);

-- Each doctor's own medicine list, learned from the prescriptions they write; used for suggestions.
create table doctor_medicines (
  doctor_id     uuid not null references doctors(user_id),
  name          text not null check (char_length(name) between 1 and 160),
  name_key      text generated always as (lower(name)) stored,
  form          text not null,
  use_count     integer not null default 1,
  last_used_at  timestamptz not null default now(),
  primary key (doctor_id, name_key, form)
);
