-- "Forgot password": a 6-digit code sent by SMS or email, or a one-time link the admin creates
-- and sends (for when no SMS/email service is connected). Only a hash is stored.
create table password_resets (
  id           uuid primary key default gen_random_uuid(),
  -- Null when the number/email matched no account (the page looks the same either way).
  user_id      uuid references users(id) on delete cascade,
  channel      text not null check (channel in ('sms', 'email', 'admin_link')),
  secret_hash  bytea not null,
  attempts     smallint not null default 0,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index password_resets_user_idx on password_resets(user_id, created_at desc);
create index password_resets_created_idx on password_resets(created_at);
