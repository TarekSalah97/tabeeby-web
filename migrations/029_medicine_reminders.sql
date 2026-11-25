-- Medicine reminders: a patient turns on reminders for medicines on their own prescriptions.
-- The doctor's frequency suggests the times; the patient may change them.

create table medicine_reminders (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references users(id),
  prescription_id  uuid not null,
  position         smallint not null,
  times            text[] not null check (cardinality(times) between 1 and 8),
  weekday          smallint check (weekday between 0 and 6),
  start_date       date not null,
  end_date         date,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (prescription_id, position) references prescription_items(prescription_id, position),
  unique (patient_id, prescription_id, position),
  check (end_date is null or (end_date >= start_date and end_date <= start_date + 366))
);
create index medicine_reminders_active_idx on medicine_reminders(patient_id) where is_active;

-- One row per dose that was notified and/or ticked as taken (also stops double notifications).
create table medicine_doses (
  reminder_id  uuid not null references medicine_reminders(id) on delete cascade,
  due_at       timestamptz not null,
  notified_at  timestamptz,
  taken_at     timestamptz,
  primary key (reminder_id, due_at)
);

-- Browsers (phones) where the user turned notifications on.
create table push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id),
  endpoint         text not null unique check (char_length(endpoint) <= 1000),
  p256dh           text not null check (char_length(p256dh) <= 200),
  auth             text not null check (char_length(auth) <= 100),
  created_at       timestamptz not null default now(),
  last_success_at  timestamptz,
  failure_count    integer not null default 0
);
create index push_subscriptions_user_idx on push_subscriptions(user_id);

-- Site-wide generated keys (the Web Push signing key).
create table app_secrets (
  name        text primary key,
  value       text not null,
  created_at  timestamptz not null default now()
);

-- Medicine names stay off the lock screen unless the patient chooses otherwise.
alter table users add column reminder_show_names boolean not null default false;
