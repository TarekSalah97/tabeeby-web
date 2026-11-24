-- Photos the doctor takes or uploads on a visit (e.g. a wound, a rash, an X-ray film), kept with
-- the visit in the doctor's own patient file. Only that doctor can see them. Removing a photo
-- hides it (kept for the medical record), it is never deleted.
create table encounter_photos (
  id            uuid primary key default gen_random_uuid(),
  encounter_id  uuid not null,
  doctor_id     uuid not null,
  storage_key   text not null unique,
  mime_type     text not null check (mime_type in ('image/jpeg', 'image/png')),
  size_bytes    integer not null check (size_bytes > 0),
  sha256        text not null,
  removed_at    timestamptz,
  created_at    timestamptz not null default now(),
  foreign key (encounter_id, doctor_id) references encounters(id, doctor_id)
);
create index encounter_photos_encounter_idx on encounter_photos(encounter_id) where removed_at is null;
