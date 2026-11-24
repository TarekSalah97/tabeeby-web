-- Secretary / assistant accounts. Each belongs to one doctor, signs in with their own mobile and
-- password, and works in that doctor's dashboard with limited rights:
--   'schedule' = the day, bookings, walk-ins, arrivals and payments;
--   'files'    = the same plus creating and editing patient files (personal details and background
--                history). Visit notes, prescriptions, orders, photos, messages, income and
--                settings stay with the doctor.
alter table users drop constraint users_role_check;
alter table users add constraint users_role_check check (role in ('patient', 'doctor', 'admin', 'facility', 'assistant'));

create table doctor_assistants (
  user_id            uuid primary key references users(id) on delete cascade,
  doctor_id          uuid not null references doctors(user_id) on delete cascade,
  access             text not null default 'schedule' check (access in ('schedule', 'files')),
  -- One-time link the doctor sends; only its hash is stored.
  invite_hash        bytea unique,
  invite_expires_at  timestamptz,
  created_at         timestamptz not null default now(),
  check ((invite_hash is null) = (invite_expires_at is null))
);
create index doctor_assistants_doctor_idx on doctor_assistants(doctor_id);
