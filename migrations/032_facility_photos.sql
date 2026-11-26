-- Public photos for pharmacies, labs and scan centres: one logo and a few photos of the place.
-- Cleaned of hidden metadata (GPS, device) before storing. The admin can hide a photo.
create table facility_photos (
  id               uuid primary key default gen_random_uuid(),
  facility_id      uuid not null references facilities(user_id) on delete cascade,
  kind             text not null check (kind in ('logo', 'photo')),
  storage_key      text not null unique,
  mime_type        text not null check (mime_type in ('image/jpeg', 'image/png')),
  size_bytes       integer not null check (size_bytes > 0),
  hidden_at        timestamptz,
  hidden_by        uuid references users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index facility_photos_facility_idx on facility_photos(facility_id, created_at);
-- At most one logo per place.
create unique index facility_photos_one_logo on facility_photos(facility_id) where kind = 'logo';

-- An optional Google Maps link per branch, so "Directions" opens the exact pin.
alter table facility_branches add column maps_url text check (maps_url is null or (char_length(maps_url) <= 500 and maps_url like 'https://%'));
