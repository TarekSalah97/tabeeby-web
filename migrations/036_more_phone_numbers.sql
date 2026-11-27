-- Contact numbers: up to 10 per field (the first stays in phone_e164, the rest in extra_phones).
-- Sign-in numbers (users.phone_e164) stay one per account.
alter table facility_branches drop constraint facility_branches_extra_phones_check;
alter table facility_branches add constraint facility_branches_extra_phones_check
  check (cardinality(extra_phones) <= 9 and array_to_string(extra_phones, ',') ~ '^(\+20[0-9]{8,10}(,\+20[0-9]{8,10})*)?$');

alter table clinics add column extra_phones text[] not null default '{}'
  check (cardinality(extra_phones) <= 9 and array_to_string(extra_phones, ',') ~ '^(\+20[0-9]{8,10}(,\+20[0-9]{8,10})*)?$');
alter table facilities add column extra_phones text[] not null default '{}'
  check (cardinality(extra_phones) <= 9 and array_to_string(extra_phones, ',') ~ '^(\+20[0-9]{8,10}(,\+20[0-9]{8,10})*)?$');
-- In a doctor's patient file the main number is the patient's mobile (it links the file to their
-- account); extra numbers can be a relative's mobile or a landline.
alter table patient_records add column extra_phones text[] not null default '{}'
  check (cardinality(extra_phones) <= 9 and array_to_string(extra_phones, ',') ~ '^(\+20[0-9]{8,10}(,\+20[0-9]{8,10})*)?$');
