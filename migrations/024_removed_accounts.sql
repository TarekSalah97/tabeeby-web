-- Admins can remove an account (e.g. test accounts on the live site). The account is closed for
-- good and its personal details are wiped; visit and payment history stays (anonymous) because
-- medical and money records are never deleted. Its mobile number and email can be used again.
alter table users drop constraint users_status_check;
alter table users add constraint users_status_check check (status in ('active', 'suspended', 'removed'));

alter table users drop constraint users_phone_e164_check;
alter table users add constraint users_phone_e164_check
  check (phone_e164 ~ '^\+201[0125][0-9]{8}$' or (status = 'removed' and phone_e164 like 'removed:%'));
