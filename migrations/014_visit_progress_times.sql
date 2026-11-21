-- When each step of a visit actually happened, so the patient's waiting-time estimate
-- can use how fast the doctor is really going today (not just the booked slot length).
alter table appointments
  add column arrived_at          timestamptz,
  add column consult_started_at  timestamptz,
  add column completed_at        timestamptz;

-- The live queue reads one doctor's visits for one day.
create index if not exists appointments_doctor_day_live_idx
  on appointments(doctor_id, clinic_id, starts_at)
  where status in ('confirmed', 'arrived', 'in_consultation', 'completed');
