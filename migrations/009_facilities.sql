-- Pharmacies, laboratories and scan (radiology) centres: their own accounts and public profiles,
-- verified by an admin like doctors. Modelled on the old app's healthcare_provider / provider_branch.

alter table users drop constraint users_role_check;
alter table users add constraint users_role_check check (role in ('patient', 'doctor', 'admin', 'facility'));

create table facilities (
  user_id              uuid primary key references users(id) on delete cascade,
  kind                 text not null check (kind in ('pharmacy', 'lab', 'radiology')),
  slug                 text not null unique check (slug ~ '^[a-z0-9-]{3,80}$'),
  name                 text not null check (char_length(name) between 2 and 120),
  description          text not null default '' check (char_length(description) <= 1000),
  licence_number       text not null check (char_length(licence_number) between 3 and 40),
  -- Public contact numbers (the account mobile stays private).
  phone_e164           text check (phone_e164 ~ '^\+20[0-9]{8,10}$'),
  whatsapp_e164        text check (whatsapp_e164 ~ '^\+20[0-9]{8,10}$'),
  -- Pharmacy: delivers to the home. Lab / scan centre: comes to the home for samples.
  home_service         boolean not null default false,
  verification_status  text not null default 'pending' check (verification_status in ('pending', 'approved', 'rejected', 'suspended')),
  verification_note    text check (char_length(verification_note) <= 500),
  verified_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index facilities_listing_idx on facilities(kind) where verification_status = 'approved';

create table facility_documents (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references facilities(user_id) on delete cascade,
  kind         text not null check (kind in ('licence')),
  storage_key  text not null unique,
  mime_type    text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes   integer not null check (size_bytes > 0),
  sha256       text not null,
  uploaded_at  timestamptz not null default now()
);
create index facility_documents_facility_idx on facility_documents(facility_id);

-- A branch with its weekly opening hours (clinic-local time). closes <= opens means it closes after midnight.
create table facility_branches (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references facilities(user_id) on delete cascade,
  name         text not null check (char_length(name) between 2 and 120),
  district_id  integer not null references districts(id),
  address      text not null check (char_length(address) between 5 and 300),
  phone_e164   text check (phone_e164 ~ '^\+20[0-9]{8,10}$'),
  open_24h     boolean not null default false,
  open_days    smallint[] not null default '{0,1,2,3,4,5,6}' check (open_days <@ '{0,1,2,3,4,5,6}'::smallint[] and cardinality(open_days) > 0),
  opens        time not null default '09:00',
  closes       time not null default '23:00',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (open_24h or opens <> closes)
);
create index facility_branches_facility_idx on facility_branches(facility_id);
create index facility_branches_district_idx on facility_branches(district_id) where is_active;

-- Tests a lab or scan centre offers from the built-in list (src/domain/clinical.ts), with its price.
create table facility_tests (
  facility_id  uuid not null references facilities(user_id) on delete cascade,
  test_code    text not null check (test_code ~ '^[a-z0-9_]{2,40}$'),
  price_egp    integer not null check (price_egp between 0 and 100000),
  primary key (facility_id, test_code)
);
create index facility_tests_code_idx on facility_tests(test_code);
