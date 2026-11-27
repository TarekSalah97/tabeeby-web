-- A doctor may save a visit without a chief complaint, and a medicine with just its name
-- (form, dose and frequency optional). The app still refuses a completely empty visit.
alter table encounters alter column chief_complaint drop not null;
alter table prescription_items alter column form drop not null;
alter table prescription_items alter column dose drop not null;
alter table prescription_items alter column frequency drop not null;
