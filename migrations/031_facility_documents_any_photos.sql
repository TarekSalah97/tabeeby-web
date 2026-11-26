-- Labs, pharmacies and scan centres can upload any phone photo (also iPhone HEIC and WebP), several
-- per document and an "other" kind, at sign-up or later from their dashboard. Nothing is required to
-- sign up; the admin reviews and can ask for more before approving.

alter table facility_documents drop constraint facility_documents_kind_check;
alter table facility_documents add constraint facility_documents_kind_check
  check (kind in ('licence', 'manager_syndicate_card', 'manager_national_id', 'radiation_licence', 'commercial_register', 'tax_card', 'other'));

alter table facility_documents drop constraint facility_documents_mime_type_check;
alter table facility_documents add constraint facility_documents_mime_type_check
  check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif'));

-- The admin's request for more documents, and when the facility last added some.
alter table facilities add column docs_request_note text check (char_length(docs_request_note) <= 500);
alter table facilities add column docs_requested_at timestamptz;
alter table facilities add column docs_updated_at timestamptz;

-- Files chosen on a sign-up form that had another mistake: kept so nobody has to choose them again.
-- The form carries "<id>:<token>"; only the token's hash is stored. Removed after a day if unused.
create table pending_uploads (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null,
  kind         text not null check (kind in ('licence', 'manager_syndicate_card', 'manager_national_id', 'radiation_licence', 'commercial_register', 'tax_card', 'other')),
  storage_key  text not null unique,
  mime_type    text not null,
  size_bytes   integer not null check (size_bytes > 0),
  sha256       text not null,
  file_name    text not null default '' check (char_length(file_name) <= 120),
  created_at   timestamptz not null default now()
);
create index pending_uploads_created_idx on pending_uploads(created_at);

-- Some licences have short numbers (one or two digits); allow any length from 1 to 40.
alter table facilities drop constraint facilities_licence_number_check;
alter table facilities add constraint facilities_licence_number_check check (char_length(licence_number) between 1 and 40);
