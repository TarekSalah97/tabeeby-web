-- Private files stored in the database, for hosts without a persistent disk.
create table stored_files (
  key         text primary key check (key ~ '^[0-9a-f]{32}\.(pdf|jpg|png)$'),
  data        bytea not null,
  created_at  timestamptz not null default now()
);

-- Messages are marked 'skipped' when the site runs without an SMS provider.
alter table notification_outbox drop constraint notification_outbox_status_check;
alter table notification_outbox add constraint notification_outbox_status_check check (status in ('pending', 'sent', 'failed', 'skipped'));
