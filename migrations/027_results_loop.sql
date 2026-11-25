-- Closing the loop on lab and scan requests:
--  * the centre can say the sample was taken / the scan was done (status tracker for the patient);
--  * the ordering doctor marks released results as reviewed, with an optional comment for the patient
--    and an optional "please book a follow-up";
--  * for a contrast CT/MRI the patient may share one of their own released kidney-test requests
--    with the scan centre (the centre can then open those result files, nothing else);
--  * doctors keep their own quick lab sets.

alter table order_requests add column sample_taken_at timestamptz;
alter table order_requests add column reviewed_at timestamptz;
alter table order_requests add column doctor_comment text check (char_length(doctor_comment) <= 500);
alter table order_requests add column follow_up boolean not null default false;
alter table order_requests add column shared_kidney_request_id uuid references order_requests(id);
alter table order_requests add constraint order_requests_review_after_ready check (reviewed_at is null or ready_at is not null);
alter table order_requests add constraint order_requests_no_self_share check (shared_kidney_request_id is null or shared_kidney_request_id <> id);

-- The doctor's "results to review" list.
create index lab_orders_doctor_idx on lab_orders(doctor_id, issued_at desc);
create index order_requests_unreviewed_idx on order_requests(lab_order_id) where status = 'ready' and reviewed_at is null;

create table doctor_lab_sets (
  id          uuid primary key default gen_random_uuid(),
  doctor_id   uuid not null references doctors(user_id),
  name        text not null check (char_length(name) between 1 and 60),
  codes       text[] not null default '{}' check (cardinality(codes) <= 60),
  other_names text[] not null default '{}' check (cardinality(other_names) <= 20),
  created_at  timestamptz not null default now(),
  check (cardinality(codes) + cardinality(other_names) >= 1)
);
create unique index doctor_lab_sets_name_idx on doctor_lab_sets(doctor_id, lower(name));
