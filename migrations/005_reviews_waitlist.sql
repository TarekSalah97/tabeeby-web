-- Verified reviews and the waitlist for fully booked days.

-- One review per completed appointment, written only by that appointment's patient.
-- Admins can hide a review (it is kept, never deleted, so a hidden review can be restored).
create table reviews (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid not null unique references appointments(id) on delete cascade,
  doctor_id       uuid not null references doctors(user_id) on delete cascade,
  patient_id      uuid not null references users(id) on delete cascade,
  rating          smallint not null check (rating between 1 and 5),
  comment         text check (char_length(comment) <= 500),
  status          text not null default 'visible' check (status in ('visible', 'hidden')),
  hidden_reason   text check (char_length(hidden_reason) <= 200),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index reviews_doctor_visible_idx on reviews(doctor_id, created_at desc) where status = 'visible';
create index reviews_recent_idx on reviews(created_at desc);

-- A patient waiting for a place at one clinic on one (fully booked) day.
-- When a booking that day is cancelled, everyone waiting is told; the first to book gets the place
-- (the appointments_no_overlap constraint still guarantees no double booking).
create table waitlist_entries (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references users(id) on delete cascade,
  doctor_id     uuid not null references doctors(user_id) on delete cascade,
  clinic_id     uuid not null references clinics(id) on delete cascade,
  wanted_date   date not null,
  status        text not null default 'waiting' check (status in ('waiting', 'notified', 'booked', 'left', 'expired')),
  notified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index waitlist_one_active_idx on waitlist_entries(patient_id, clinic_id, wanted_date) where status in ('waiting', 'notified');
create index waitlist_clinic_date_idx on waitlist_entries(clinic_id, wanted_date, created_at) where status in ('waiting', 'notified');
create index waitlist_patient_idx on waitlist_entries(patient_id, wanted_date);
