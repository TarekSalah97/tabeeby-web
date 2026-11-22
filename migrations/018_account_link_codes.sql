-- A patient with a Tabeeby account who walks in (without booking online) shows the doctor a short
-- code from their health record; the doctor types it into the patient's file to link the file to
-- the account, so prescriptions, lab and imaging requests reach the patient's health record.
-- Only a hash of the code is stored; codes last 10 minutes and are used once.
create table account_link_codes (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references users(id),
  code_hash    bytea not null,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  consumed_by  uuid references users(id),
  record_id    uuid references patient_records(id),
  created_at   timestamptz not null default now()
);
create unique index account_link_codes_hash_idx on account_link_codes(code_hash) where consumed_at is null;
create index account_link_codes_patient_idx on account_link_codes(patient_id, created_at desc);
