-- PRELAUNCH-REMOVE: connected apps are for the owner's own use and are removed before any public release
-- (docs/PRELAUNCH.md). Boekenwurm: count the pages the app actually records (2026-11-27).
--
-- The reader records each paragraph read as "p<n>", its place in the book (ord n), not the paragraph row's uuid.
-- connection_summary() only looked for uuids, so every session counted 0 pages for connected apps. It now matches
-- both. Nothing else changes: same numbers, today (or yesterday) only.

create or replace function connection_summary(p_token text, p_day date, p_tz text, p_start_hour integer default 0)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  st jsonb;
  c record;
  local_today date;
  p_from timestamptz;
  p_to timestamptz;
  r jsonb;
begin
  if not exists (select 1 from pg_timezone_names where name = p_tz) then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;
  if p_start_hour not between 0 and 6 then
    raise exception 'A day starts between 00:00 and 06:00' using errcode = '22023';
  end if;
  local_today := (now() at time zone p_tz)::date;
  if p_day not in (local_today, local_today - 1) then
    raise exception 'Only today''s numbers can be shared' using errcode = '22023';
  end if;
  p_from := (p_day + make_interval(hours => p_start_hour)) at time zone p_tz;
  p_to := p_from + interval '1 day';
  if p_from > now() then
    raise exception 'That day hasn''t started yet' using errcode = '22023';
  end if;
  st := app_connection_state(p_token);
  if st ->> 'state' = 'pending' then
    return jsonb_build_object('error', 'pending',
      'message', 'Waiting for approval: allow this app in Boekenwurm (Account → Settings → Connected apps).');
  elsif st ->> 'state' <> 'ok' then
    return jsonb_build_object('error', 'gone', 'message', 'This app is no longer connected to Boekenwurm. Pair it again.');
  end if;
  select (st ->> 'user_id')::uuid as user_id into c;
  with s as (
    select rs.*, (rs.text_level is not null and rs.reader_rank is not null
                  and level_index(rs.text_level) >= level_index(rs.reader_rank)) as at_level
    from reading_sessions rs
    where rs.user_id = c.user_id and rs.started_at >= p_from and rs.started_at < p_to
  ), read as (
    -- The app names a paragraph by its place in the book ("p12" = ord 12); older sessions used the row's uuid.
    select distinct s.at_level, s.book_id, x ->> 'paragraphId' as pid
    from s, jsonb_array_elements(s.results) x
    where x ? 'paragraphId'
  ), paras as (
    select read.at_level, p.book_id, p.page_number, p.countable
    from read join paragraphs p on p.user_id = c.user_id and (
      p.id = case when read.pid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then read.pid::uuid end
      or (p.book_id = read.book_id
          and p.ord = case when read.pid ~ '^p[0-9]{1,6}$' then substr(read.pid, 2)::integer end))
  ), pages as (
    select at_level,
           count(distinct (book_id, page_number)) filter (where page_number is not null)
           + floor(coalesce(sum(countable) filter (where page_number is null), 0) / 250.0)::int as n
    from paras group by at_level
  )
  select jsonb_build_object(
    'version', 2,
    'day', p_day,
    'pages', coalesce((select sum(n) from pages), 0),
    'pages_at_level', coalesce((select n from pages where at_level), 0),
    'active_minutes', round(coalesce((select sum(active_seconds) from s), 0) / 60.0, 1),
    'active_minutes_at_level', round(coalesce((select sum(active_seconds) from s where at_level), 0) / 60.0, 1),
    'cards_reviewed', (select count(*) from cards where user_id = c.user_id and last_review >= p_from and last_review < p_to),
    'diary_done', coalesce((select (progress -> 'play' -> 'diaryDays') ? p_day::text from profiles where user_id = c.user_id), false)
  ) into r;
  return r;
end $$;
revoke all on function connection_summary(text, date, text, integer) from public;
grant execute on function connection_summary(text, date, text, integer) to anon, authenticated;
