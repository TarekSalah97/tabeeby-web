-- Tests or scans a lab / scan centre offers beyond the built-in list, with their own name and price.
-- Shown on the place's public price list. (Doctors still order from the built-in list.)
create table facility_extra_tests (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references facilities(user_id) on delete cascade,
  name         text not null check (char_length(name) between 2 and 120),
  price_egp    integer not null check (price_egp between 0 and 100000),
  note         text check (char_length(note) <= 200),
  created_at   timestamptz not null default now()
);
create unique index facility_extra_tests_name_idx on facility_extra_tests(facility_id, lower(name));
