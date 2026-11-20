-- Boekenwurm: the owner is told when a reader's Google page reading reaches 200 pages in a month.
--
-- Page reading has a hard limit of 20 pages a day per account (claim_page_read, migration 0004). On top of that,
-- 200 pages in a calendar month is a soft limit: nothing is refused, but the owner gets one alert (by email and on
-- her phone) so she can see heavy use early. The read-page function asks after each page it read; this records the
-- alert once per reader per month, so a page given back and read again (0005) never alerts twice.
--
-- Only the server (service role) calls it. Readers can't see or change the alerts. Deleting an account deletes them.

create table usage_alerts (
  user_id  uuid not null references auth.users (id) on delete cascade,
  month    date not null check (month = date_trunc('month', month)::date),
  kind     text not null check (kind in ('page_reads_month')),
  pages    integer not null,
  sent_at  timestamptz not null default now(),
  primary key (user_id, month, kind)
);
alter table usage_alerts enable row level security;
alter table usage_alerts force row level security;
revoke all on usage_alerts from public, anon, authenticated;

comment on table usage_alerts is
  'One row per reader per month once they reach 200 Google page readings (soft limit). Who and when: select u.email, a.month, a.pages, a.sent_at from usage_alerts a join auth.users u on u.id = a.user_id order by a.sent_at desc;';

-- The reader's pages read this month (the month of p_day), and whether this call is the one that reached the
-- threshold: true once per reader per month, false before the threshold and every time after.
create function page_reads_month_alert(p_user uuid, p_day date, p_threshold integer default 200)
returns table (pages integer, alert boolean)
language plpgsql security definer set search_path = public as $$
declare
  m date := date_trunc('month', p_day)::date;
  n integer;
  added integer := 0;
begin
  select coalesce(sum(u.pages), 0)::integer into n
    from page_read_usage u where u.user_id = p_user and u.day >= m and u.day < (m + interval '1 month')::date;
  if n >= p_threshold then
    insert into usage_alerts (user_id, month, kind, pages) values (p_user, m, 'page_reads_month', n) on conflict do nothing;
    get diagnostics added = row_count;
  end if;
  return query select n, added > 0;
end $$;

revoke all on function page_reads_month_alert(uuid, date, integer) from public, anon, authenticated;
grant execute on function page_reads_month_alert(uuid, date, integer) to service_role;
