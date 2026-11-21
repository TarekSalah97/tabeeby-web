-- Extra visit types a doctor offers at a clinic besides the consultation and the follow-up
-- (for example "Laser session", "Echo", "Scaling and polishing"), each with the doctor's own price.
create table clinic_services (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id),
  doctor_id   uuid not null references doctors(user_id),
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  price_egp   integer not null check (price_egp between 0 and 100000),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index clinic_services_name_idx on clinic_services(clinic_id, lower(btrim(name)));
create index clinic_services_clinic_idx on clinic_services(clinic_id) where is_active;

-- A booking can be for one of these services. The name is copied so the visit keeps it even if the
-- doctor renames or removes the service later.
alter table appointments add column service_id uuid references clinic_services(id);
alter table appointments add column service_name text;
alter table appointments drop constraint appointments_visit_type_check;
alter table appointments add constraint appointments_visit_type_check check (visit_type in ('new', 'follow_up', 'service'));
alter table appointments add constraint appointments_service_matches_type
  check ((visit_type = 'service') = (service_id is not null and service_name is not null));
