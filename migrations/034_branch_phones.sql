-- Branches can list several phone numbers (the first stays in phone_e164, the rest here).
alter table facility_branches add column extra_phones text[] not null default '{}'
  check (cardinality(extra_phones) <= 4 and array_to_string(extra_phones, ',') ~ '^(\+20[0-9]{8,10}(,\+20[0-9]{8,10})*)?$');
