-- Boekenwurm: the weekly diary reminder as a phone notification (Web Push).
--
-- A reader who turns the reminder on gives this device's push address (the browser makes it); it is kept here with
-- the reader's time zone, nothing else. Readers see and change only their own rows; the diary-reminder function
-- (service role) reads them once a week. Deleting the account deletes them (on delete cascade). Diary entries are
-- never stored on the server.

create table push_subscriptions (
  endpoint   text primary key check (endpoint ~ '^https://' and length(endpoint) < 1000),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  p256dh     text not null check (length(p256dh) < 200),
  auth       text not null check (length(auth) < 100),
  time_zone  text not null default 'Europe/Amsterdam' check (length(time_zone) < 64),
  created_at timestamptz not null default now(),
  last_sent  timestamptz
);
create index push_subscriptions_user on push_subscriptions (user_id);
alter table push_subscriptions enable row level security;
alter table push_subscriptions force row level security;
create policy own_push_select on push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy own_push_insert on push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy own_push_update on push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_push_delete on push_subscriptions for delete to authenticated using (user_id = auth.uid());
revoke all on push_subscriptions from anon;
grant select, insert, update, delete on push_subscriptions to authenticated;
