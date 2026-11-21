-- Messaging between a patient and a doctor they have seen or booked.
-- Messages are health data: only the two participants can read them (not admins).

alter table doctors
  add column messaging_enabled boolean not null default false,
  -- Days and hours (clinic-local) when patients may send messages. 0 = Sunday.
  add column messaging_days smallint[] not null default '{0,1,2,3,4}',
  add column messaging_start time not null default '10:00',
  add column messaging_end time not null default '20:00',
  add constraint doctors_messaging_hours check (messaging_end > messaging_start),
  add constraint doctors_messaging_days check (messaging_days <@ '{0,1,2,3,4,5,6}'::smallint[]);

create table conversations (
  id                    uuid primary key default gen_random_uuid(),
  doctor_id             uuid not null references doctors(user_id) on delete cascade,
  patient_id            uuid not null references users(id) on delete cascade,
  created_at            timestamptz not null default now(),
  last_message_at       timestamptz not null default now(),
  last_sender           text check (last_sender in ('patient', 'doctor')),
  doctor_read_at        timestamptz,
  patient_read_at       timestamptz,
  -- The doctor stopped this patient from sending new messages.
  blocked_at            timestamptz,
  unique (doctor_id, patient_id)
);
create index conversations_doctor_idx on conversations(doctor_id, last_message_at desc);
create index conversations_patient_idx on conversations(patient_id, last_message_at desc);

create table messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  sender           text not null check (sender in ('patient', 'doctor')),
  body             text not null check (char_length(body) between 1 and 1000),
  created_at       timestamptz not null default now()
);
create index messages_conversation_idx on messages(conversation_id, created_at);
