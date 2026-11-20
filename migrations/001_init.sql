-- Tabeeby v1 schema.
-- Conventions: UUID primary keys for anything exposed in URLs, timestamptz in UTC,
-- every table that holds personal data is listed in docs/DATA_INVENTORY.md.

create extension if not exists btree_gist;
create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table governorates (
  id          smallserial primary key,
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name_en     text not null,
  name_ar     text not null,
  is_active   boolean not null default false
);

create table districts (
  id              serial primary key,
  governorate_id  smallint not null references governorates(id),
  slug            text not null check (slug ~ '^[a-z0-9-]+$'),
  name_en         text not null,
  name_ar         text not null,
  unique (governorate_id, slug)
);

create table specialties (
  id        smallserial primary key,
  slug      text not null unique check (slug ~ '^[a-z0-9-]+$'),
  kind      text not null check (kind in ('medical', 'dental')),
  name_en   text not null,
  name_ar   text not null,
  sort      smallint not null default 100
);

create table subspecialties (
  id            serial primary key,
  specialty_id  smallint not null references specialties(id),
  slug          text not null check (slug ~ '^[a-z0-9-]+$'),
  name_en       text not null,
  name_ar       text not null,
  unique (specialty_id, slug)
);

-- Plain-language search terms ("migraine", "صداع") mapped to where they are treated.
create table condition_keywords (
  id                serial primary key,
  term_en           text not null,
  term_ar           text not null,
  specialty_id      smallint not null references specialties(id),
  subspecialty_id   integer references subspecialties(id)
);

create table insurers (
  id        smallserial primary key,
  slug      text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name_en   text not null,
  name_ar   text not null
);

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
create table users (
  id                 uuid primary key default gen_random_uuid(),
  role               text not null check (role in ('patient', 'doctor', 'admin')),
  full_name          text not null check (char_length(full_name) between 2 and 120),
  phone_e164         text not null unique check (phone_e164 ~ '^\+201[0125][0-9]{8}$'),
  email              citext unique,
  password_hash      text not null,
  phone_verified_at  timestamptz,
  status             text not null default 'active' check (status in ('active', 'suspended')),
  preferred_locale   text not null default 'ar' check (preferred_locale in ('ar', 'en')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  token_hash    bytea not null unique,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index sessions_user_idx on sessions(user_id);
create index sessions_expires_idx on sessions(expires_at);

create table otp_codes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  purpose      text not null check (purpose in ('verify_phone')),
  code_hash    bytea not null,
  attempts     smallint not null default 0,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index otp_codes_user_idx on otp_codes(user_id, purpose, created_at desc);

-- Fixed-window counters shared by all app instances.
create table rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (key, window_start)
);

-- ---------------------------------------------------------------------------
-- Doctors
-- ---------------------------------------------------------------------------
create table doctors (
  user_id              uuid primary key references users(id) on delete cascade,
  slug                 text not null unique check (slug ~ '^[a-z0-9-]+$'),
  kind                 text not null check (kind in ('medical', 'dental')),
  title_en             text not null default '',
  title_ar             text not null default '',
  bio                  text not null default '' check (char_length(bio) <= 2000),
  specialty_id         smallint not null references specialties(id),
  graduation_year      smallint not null check (graduation_year between 1950 and 2100),
  gender               text check (gender in ('female', 'male')),
  languages            text[] not null default '{ar}',
  verification_status  text not null default 'pending'
                       check (verification_status in ('pending', 'approved', 'rejected', 'suspended')),
  verification_note    text,
  verified_at          timestamptz,
  verified_by          uuid references users(id),
  plan                 text not null default 'basic' check (plan in ('basic', 'professional', 'clinic')),
  trial_ends_at        timestamptz not null default (now() + interval '3 months'),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index doctors_search_idx on doctors(verification_status, specialty_id);

create table doctor_subspecialties (
  doctor_id        uuid not null references doctors(user_id) on delete cascade,
  subspecialty_id  integer not null references subspecialties(id),
  primary key (doctor_id, subspecialty_id)
);

create table doctor_insurers (
  doctor_id   uuid not null references doctors(user_id) on delete cascade,
  insurer_id  smallint not null references insurers(id),
  primary key (doctor_id, insurer_id)
);

-- Months are stored as the first day of the month. end_month null = present.
create table doctor_positions (
  id           uuid primary key default gen_random_uuid(),
  doctor_id    uuid not null references doctors(user_id) on delete cascade,
  title        text not null check (char_length(title) between 2 and 120),
  workplace    text not null check (char_length(workplace) between 2 and 160),
  start_month  date not null check (extract(day from start_month) = 1),
  end_month    date check (end_month is null or (extract(day from end_month) = 1 and end_month >= start_month)),
  created_at   timestamptz not null default now()
);
create index doctor_positions_doctor_idx on doctor_positions(doctor_id);

create table verification_documents (
  id           uuid primary key default gen_random_uuid(),
  doctor_id    uuid not null references doctors(user_id) on delete cascade,
  kind         text not null check (kind in ('syndicate_card')),
  storage_key  text not null unique,
  mime_type    text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes   integer not null check (size_bytes > 0),
  sha256       text not null,
  uploaded_at  timestamptz not null default now()
);
create index verification_documents_doctor_idx on verification_documents(doctor_id);

create table clinics (
  id           uuid primary key default gen_random_uuid(),
  doctor_id    uuid not null references doctors(user_id) on delete cascade,
  name         text not null check (char_length(name) between 2 and 120),
  district_id  integer not null references districts(id),
  address      text not null check (char_length(address) between 5 and 300),
  phone_e164   text check (phone_e164 ~ '^\+20[0-9]{8,10}$'),
  fee_egp      integer not null check (fee_egp between 0 and 100000),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index clinics_doctor_idx on clinics(doctor_id);
create index clinics_district_idx on clinics(district_id) where is_active;

-- Weekly working hours, in clinic-local (Africa/Cairo) wall time.
create table schedule_rules (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  weekday       smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time    time not null,
  end_time      time not null,
  slot_minutes  smallint not null check (slot_minutes in (10, 15, 20, 30, 45, 60)),
  check (end_time > start_time)
);
create index schedule_rules_clinic_idx on schedule_rules(clinic_id);

create table schedule_blocks (
  id          uuid primary key default gen_random_uuid(),
  doctor_id   uuid not null references doctors(user_id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  note        text check (char_length(note) <= 200),
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index schedule_blocks_doctor_idx on schedule_blocks(doctor_id, starts_at);

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
create table appointments (
  id                  uuid primary key default gen_random_uuid(),
  doctor_id           uuid not null references doctors(user_id),
  clinic_id           uuid not null references clinics(id),
  patient_id          uuid not null references users(id),
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  visit_type          text not null check (visit_type in ('new', 'follow_up')),
  status              text not null default 'confirmed'
                      check (status in ('confirmed', 'arrived', 'in_consultation', 'completed', 'cancelled', 'no_show')),
  -- Health data: optional, short, shown only to the treating doctor.
  reason              text check (char_length(reason) <= 200),
  fee_egp             integer not null,
  cancelled_by        text check (cancelled_by in ('patient', 'doctor', 'admin')),
  cancelled_at        timestamptz,
  reminder_24h_at     timestamptz,
  reminder_2h_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (ends_at > starts_at),
  -- A doctor can never have two live appointments that overlap, even across clinics
  -- and even under concurrent requests. Enforced by the database, not app code.
  constraint appointments_no_overlap exclude using gist (
    doctor_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'cancelled')
);
create index appointments_doctor_time_idx on appointments(doctor_id, starts_at);
create index appointments_patient_idx on appointments(patient_id, starts_at desc);
create index appointments_reminders_idx on appointments(starts_at) where status = 'confirmed';

-- ---------------------------------------------------------------------------
-- Notifications (transactional outbox) and audit
-- ---------------------------------------------------------------------------
create table notification_outbox (
  id               bigserial primary key,
  channel          text not null default 'sms' check (channel in ('sms')),
  to_phone         text not null,
  body             text not null,
  status           text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts         smallint not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_error       text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index notification_outbox_pending_idx on notification_outbox(next_attempt_at) where status = 'pending';

create table audit_log (
  id             bigserial primary key,
  actor_user_id  uuid references users(id),
  action         text not null,
  entity_type    text not null,
  entity_id      text,
  metadata       jsonb not null default '{}',
  ip             text,
  created_at     timestamptz not null default now()
);
create index audit_log_entity_idx on audit_log(entity_type, entity_id, created_at desc);
create index audit_log_actor_idx on audit_log(actor_user_id, created_at desc);
