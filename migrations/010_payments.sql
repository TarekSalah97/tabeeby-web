-- Payments for visits. Today they are recorded by the clinic (paid at the clinic);
-- the provider column lets an online gateway (Paymob / Fawry) add rows later.
-- Payments are never deleted: a refund marks the row and is audited.

create table payments (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid not null references appointments(id),
  doctor_id       uuid not null references doctors(user_id),
  amount_egp      integer not null check (amount_egp between 0 and 100000),
  method          text not null check (method in ('cash', 'card', 'instapay', 'wallet', 'insurance', 'other')),
  provider        text not null default 'clinic' check (provider in ('clinic', 'paymob', 'fawry')),
  provider_ref    text check (char_length(provider_ref) <= 120),
  status          text not null default 'paid' check (status in ('paid', 'refunded')),
  note            text check (char_length(note) <= 200),
  recorded_by     uuid references users(id),
  paid_at         timestamptz not null default now(),
  refunded_at     timestamptz,
  refund_reason   text check (char_length(refund_reason) <= 300),
  created_at      timestamptz not null default now(),
  check ((status = 'refunded') = (refunded_at is not null))
);
-- At most one live payment per visit (a refunded one can be followed by a new one).
create unique index payments_one_paid_idx on payments(appointment_id) where status = 'paid';
create index payments_doctor_time_idx on payments(doctor_id, paid_at desc);

create trigger payments_no_delete before delete on payments for each row execute function forbid_change();
