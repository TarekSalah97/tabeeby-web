-- Email as a second channel: codes for booking without an account and for signing in, plus confirmations.

-- Patients who booked with an emailed code have a verified email and no password until they choose one.
alter table users add column email_verified_at timestamptz;
alter table users add column has_password boolean not null default true;

-- The outbox now carries emails as well as SMS.
alter table notification_outbox add column to_email citext;
alter table notification_outbox add column subject text check (char_length(subject) <= 200);
alter table notification_outbox alter column to_phone drop not null;
alter table notification_outbox drop constraint notification_outbox_channel_check;
alter table notification_outbox add constraint notification_outbox_channel_check check (channel in ('sms', 'email'));
alter table notification_outbox add constraint notification_outbox_target_check
  check ((channel = 'sms' and to_phone is not null) or (channel = 'email' and to_email is not null));

-- One-time 6-digit codes sent by email. Only a hash of the code is stored.
-- payload holds what the code unlocks: the booking a guest asked for, or the account signing in.
create table email_codes (
  id           uuid primary key default gen_random_uuid(),
  email        citext not null,
  purpose      text not null check (purpose in ('guest_booking', 'login')),
  code_hash    bytea not null,
  payload      jsonb not null default '{}',
  attempts     smallint not null default 0,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index email_codes_email_idx on email_codes(email, purpose, created_at desc);
