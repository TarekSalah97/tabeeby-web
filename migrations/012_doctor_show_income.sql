-- Doctors can hide the Income section (and the payment buttons on their day) if they do not use it.
alter table doctors add column show_income boolean not null default true;
