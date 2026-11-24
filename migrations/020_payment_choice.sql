-- How the patient plans to pay, chosen when booking. Money is still collected by the clinic
-- (cash or the clinic's card machine) or sent by the patient with InstaPay to the doctor's
-- own InstaPay address; nothing is charged through Tabeeby yet.
alter table doctors add column instapay_address text
  check (instapay_address is null or length(instapay_address) between 3 and 100);

alter table appointments add column pay_choice text not null default 'cash'
  check (pay_choice in ('cash', 'card_clinic', 'instapay'));
-- The InstaPay transfer reference the patient typed, for the clinic to check.
alter table appointments add column pay_ref text
  check (pay_ref is null or length(pay_ref) between 3 and 40);
