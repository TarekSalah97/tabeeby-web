-- Better contact between patients and pharmacies, labs and scan centres.

-- Lab / scan requests: the patient can add a short note and ask for a home visit (when the centre
-- offers one); the centre can send instructions back when it picks the request up
-- (e.g. "come fasting at 9am").
alter table order_requests add column patient_note text check (char_length(patient_note) <= 300);
alter table order_requests add column home_visit boolean not null default false;
alter table order_requests add column facility_instructions text check (char_length(facility_instructions) <= 500);

-- A patient sends one of their prescriptions to a pharmacy on Tabeeby (pickup or delivery);
-- the pharmacy answers with availability, the total price and a note.
create table pharmacy_requests (
  id               uuid primary key default gen_random_uuid(),
  prescription_id  uuid not null references prescriptions(id),
  patient_id       uuid not null references users(id),
  facility_id      uuid not null references facilities(user_id),
  delivery         boolean not null default false,
  patient_note     text check (char_length(patient_note) <= 300),
  status           text not null default 'sent'
                   check (status in ('sent', 'ready', 'out_for_delivery', 'partly_available', 'unavailable', 'completed', 'cancelled')),
  pharmacy_note    text check (char_length(pharmacy_note) <= 500),
  total_egp        integer check (total_egp between 0 and 1000000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  replied_at       timestamptz,
  cancelled_at     timestamptz
);
-- One open request per prescription; after "not available", "done" or a cancel it can be sent again.
create unique index pharmacy_requests_one_open_idx on pharmacy_requests(prescription_id)
  where status in ('sent', 'ready', 'out_for_delivery', 'partly_available');
create index pharmacy_requests_facility_idx on pharmacy_requests(facility_id, created_at desc);
create index pharmacy_requests_patient_idx on pharmacy_requests(patient_id, created_at desc);
