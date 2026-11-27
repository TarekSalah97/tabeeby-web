-- A doctor can add someone who already has a Tabeeby account (for example the secretary's own
-- patient account, or another doctor's secretary) to the team, as that same account.
-- One person may be on several doctors' teams.
alter table doctor_assistants drop constraint doctor_assistants_pkey;
alter table doctor_assistants add primary key (user_id, doctor_id);
-- When the person accepted the invite (until then the membership gives no access).
alter table doctor_assistants add column joined_at timestamptz;
update doctor_assistants a set joined_at = a.created_at
  from users u where u.id = a.user_id and u.has_password and a.invite_hash is null;
create index doctor_assistants_user_idx on doctor_assistants(user_id);

-- Which clinic this signed-in session is working in (null: the account's own role).
alter table sessions add column staff_doctor_id uuid references doctors(user_id) on delete set null;
