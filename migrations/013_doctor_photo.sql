-- A profile photo per doctor (cleaned of hidden metadata before it is stored).
alter table doctors
  add column photo_key text,
  add column photo_mime text check (photo_mime in ('image/jpeg', 'image/png')),
  add column photo_updated_at timestamptz,
  add constraint doctors_photo_complete check ((photo_key is null) = (photo_mime is null));
