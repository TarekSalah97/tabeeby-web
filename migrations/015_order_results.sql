-- A patient sends a doctor's lab or imaging order to a lab / scan centre on Tabeeby, and the
-- centre sends the results back into the patient's health record.
-- One lab order can hold blood tests and scans; each part ("section") goes to its own centre.

create table order_requests (
  id             uuid primary key default gen_random_uuid(),
  lab_order_id   uuid not null references lab_orders(id),
  section        text not null check (section in ('lab', 'imaging')),
  patient_id     uuid not null references users(id),
  facility_id    uuid not null references facilities(user_id),
  status         text not null default 'sent' check (status in ('sent', 'received', 'ready', 'cancelled')),
  -- Short note from the centre to the patient with the results (not a report).
  facility_note  text check (char_length(facility_note) <= 1000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  received_at    timestamptz,
  ready_at       timestamptz,
  cancelled_at   timestamptz
);
-- Only one open request per order part; the patient can cancel and choose another centre.
create unique index order_requests_one_open_idx on order_requests(lab_order_id, section) where status <> 'cancelled';
create index order_requests_facility_idx on order_requests(facility_id, created_at desc);
create index order_requests_patient_idx on order_requests(patient_id, created_at desc);

-- Result files (PDF, JPEG, PNG) uploaded by the centre. Health data: served only to the patient,
-- the centre and the ordering doctor.
create table order_results (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references order_requests(id),
  storage_key  text not null unique,
  mime         text not null check (mime in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes   integer not null check (size_bytes > 0),
  uploaded_by  uuid not null references users(id),
  created_at   timestamptz not null default now()
);
create index order_results_request_idx on order_results(request_id, created_at);
