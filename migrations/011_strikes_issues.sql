-- Reliability: strikes when a doctor cancels on patients, a whole-day cancel, and patient-reported visit problems.
-- Modelled on the old app's doctor_strike and booking_issue.

create table doctor_strikes (
  id              uuid primary key default gen_random_uuid(),
  doctor_id       uuid not null references doctors(user_id) on delete cascade,
  source          text not null check (source in ('doctor_cancel', 'day_cancel', 'admin')),
  appointment_id  uuid references appointments(id),
  day             date,
  reason          text check (char_length(reason) <= 300),
  status          text not null default 'active' check (status in ('active', 'waived')),
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz,
  reviewed_by     uuid references users(id),
  review_note     text check (char_length(review_note) <= 300),
  check ((source = 'day_cancel') = (day is not null))
);
create index doctor_strikes_doctor_idx on doctor_strikes(doctor_id, created_at desc);
-- Cancelling a whole day is one strike, however many visits it cancels.
create unique index doctor_strikes_one_per_day_idx on doctor_strikes(doctor_id, day) where source = 'day_cancel';

create table visit_issues (
  id               uuid primary key default gen_random_uuid(),
  appointment_id   uuid not null references appointments(id),
  patient_id       uuid not null references users(id) on delete cascade,
  doctor_id        uuid not null references doctors(user_id) on delete cascade,
  category         text not null check (category in ('doctor_absent', 'long_wait', 'overcharged', 'wrong_no_show', 'behaviour', 'other')),
  description      text not null check (char_length(description) between 10 and 1000),
  status           text not null default 'open' check (status in ('open', 'resolved')),
  resolution_note  text check (char_length(resolution_note) <= 500),
  resolved_by      uuid references users(id),
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  check ((status = 'resolved') = (resolved_at is not null))
);
create unique index visit_issues_one_open_idx on visit_issues(appointment_id) where status = 'open';
create index visit_issues_status_idx on visit_issues(status, created_at);

-- An admin can decide a no-show was recorded by mistake; it then stops counting against the patient.
alter table appointments add column no_show_waived boolean not null default false;
