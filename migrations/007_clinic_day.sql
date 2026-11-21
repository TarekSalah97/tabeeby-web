-- Clinic day: follow-up prices, bookings the clinic makes itself (phone / walk-in), no-show protection.

-- Follow-up ("استشارة") price per clinic. Null = same price as a new visit.
-- A booking counts as a follow-up when the patient finished a visit with the same doctor
-- within follow_up_days; the server decides, never the client.
alter table clinics
  add column follow_up_fee_egp integer check (follow_up_fee_egp between 0 and 100000),
  add column follow_up_days smallint not null default 14 check (follow_up_days between 1 and 90);

-- Bookings the doctor makes for someone without linking an account: name + mobile only.
-- They are never shown to any account, so a mistyped number cannot leak a visit to a stranger.
alter table appointments
  alter column patient_id drop not null,
  add column walk_in_name text check (char_length(walk_in_name) between 2 and 120),
  add column walk_in_phone text check (walk_in_phone ~ '^\+20[0-9]{8,10}$'),
  add column booked_by text not null default 'patient' check (booked_by in ('patient', 'doctor')),
  add constraint appointments_patient_or_walk_in check (
    (patient_id is not null and walk_in_name is null and walk_in_phone is null)
    or (patient_id is null and walk_in_name is not null and walk_in_phone is not null and booked_by = 'doctor')
  );
create index appointments_walk_in_phone_idx on appointments(doctor_id, walk_in_phone) where walk_in_phone is not null;
create index appointments_no_show_idx on appointments(patient_id, starts_at) where status = 'no_show';

-- An admin can give a patient a fresh start: no-shows before this moment stop counting.
alter table users add column no_show_cleared_at timestamptz;
