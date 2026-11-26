-- PRELAUNCH-REMOVE: connected apps are for the owner's own use and are removed before any public release
-- (docs/PRELAUNCH.md). Boekenwurm: connected apps, tightened after a privacy and security review (2026-11-26).
--
--   1. The reader approves every new connection in Boekenwurm after the app claims its code; until then the app's
--      token opens nothing. A connection not approved within 10 minutes is dropped.
--   2. Guessing codes is limited: 10 failed tries per network address in 10 minutes, 300 in all per minute. Only a
--      hash of the address is kept, for at most an hour.
--   3. A connection unused for 90 days expires and is deleted.
--   4. The summary covers one whole day, today or yesterday only (yesterday for apps whose day ends after midnight),
--      in the reader's time zone, and only what an app needs: pages, active minutes, cards, diary yes/no.
--   5. Active reading time, text level and rank are kept only for readers with an approved connection: the
--      database drops them for everyone else, whatever a device sends.
--   6. No calendar: Boekenwurm doesn't store or serve anything for apps.
--   7. forget_app_connections() removes everything about a reader's connections (erase from my account).
-- Safe to run after 0013 (or right after it, in one go).

-- ---------------------------------------------------------------- 6. no calendar

drop function if exists put_app_calendar(text, text, boolean);
drop function if exists app_calendar_ics(text);
drop table if exists app_calendars;

-- ---------------------------------------------------------------- 1 and 3. approval and expiry

alter table app_connections add column if not exists approved_at timestamptz;

-- Readers approve (or deny, by deleting) their own pending connections.
create or replace function approve_app_connection(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  update app_connections set approved_at = now()
    where id = p_id and user_id = auth.uid() and approved_at is null and created_at > now() - interval '10 minutes';
  if not found then
    raise exception 'That request has expired. Pair the app again.' using errcode = '22023';
  end if;
end $$;
revoke all on function approve_app_connection(uuid) from public, anon;
grant execute on function approve_app_connection(uuid) to authenticated;

-- Drop pending connections older than 10 minutes and connections unused for 90 days (for one reader, or everyone).
create or replace function prune_app_connections(p_user uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from app_connections
   where (p_user is null or user_id = p_user)
     and ((approved_at is null and created_at < now() - interval '10 minutes')
          or (approved_at is not null and coalesce(last_used_at, approved_at) < now() - interval '90 days'));
  get diagnostics n = row_count;
  delete from app_pairing_codes where expires_at < now();
  return n;
end $$;
revoke all on function prune_app_connections(uuid) from public, anon, authenticated;

-- What the reader sees in Account → Settings → Connected apps (pruned first, so expired ones never show).
create or replace function my_app_connections() returns table (
  id uuid, app text, name text, created_at timestamptz, approved_at timestamptz, last_used_at timestamptz,
  expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  perform prune_app_connections(auth.uid());
  return query
    select c.id, c.app, c.name, c.created_at, c.approved_at, c.last_used_at,
           case when c.approved_at is null then c.created_at + interval '10 minutes'
                else coalesce(c.last_used_at, c.approved_at) + interval '90 days' end
      from app_connections c where c.user_id = auth.uid() order by c.created_at desc;
end $$;
revoke all on function my_app_connections() from public, anon;
grant execute on function my_app_connections() to authenticated;

-- The connection a token belongs to, as {"state": "ok" | "pending" | "gone", ...}. Never raises, so that dropping
-- an expired connection here isn't rolled back by an error. Marks an approved connection used.
drop function if exists app_connection_for(text);
create or replace function app_connection_state(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c app_connections%rowtype;
begin
  select * into c from app_connections where token_hash = app_secret_hash(p_token);
  if not found then
    return jsonb_build_object('state', 'gone');
  end if;
  if c.approved_at is null then
    if c.created_at < now() - interval '10 minutes' then
      delete from app_connections where id = c.id;
      return jsonb_build_object('state', 'gone');
    end if;
    return jsonb_build_object('state', 'pending');
  end if;
  if coalesce(c.last_used_at, c.approved_at) < now() - interval '90 days' then
    delete from app_connections where id = c.id;
    return jsonb_build_object('state', 'gone');
  end if;
  update app_connections set last_used_at = now() where id = c.id;
  return jsonb_build_object('state', 'ok', 'user_id', c.user_id);
end $$;
revoke all on function app_connection_state(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. limited guessing

create table if not exists app_pairing_failures (
  at       timestamptz not null default now(),
  addr_key text not null       -- sha-256 of the network address and the hour: not reversible, gone within an hour
);
create index if not exists app_pairing_failures_at on app_pairing_failures (at);
alter table app_pairing_failures enable row level security;
alter table app_pairing_failures force row level security;
revoke all on app_pairing_failures from authenticated, anon;

-- The caller's network address as Supabase's API gateway passes it on (none when called directly in tests).
create or replace function request_addr_key() returns text
language sql stable as $$
  select encode(sha256(convert_to(
    coalesce(split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1), 'unknown')
    || '|' || to_char(now(), 'YYYY-MM-DD HH24'), 'UTF8')), 'hex')
$$;
revoke all on function request_addr_key() from public, anon, authenticated;

-- The redemption itself (internal). claim_pairing_code() below is what apps call.
create or replace function redeem_pairing_code(p_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c app_pairing_codes%rowtype;
  token text := random_hex(3);   -- 90 random hex digits (360 bits)
  conn_id uuid;
begin
  delete from app_pairing_codes where expires_at < now();
  delete from app_pairing_codes where code_hash = app_secret_hash(p_code) returning * into c;
  if not found then
    return jsonb_build_object('error', 'invalid', 'message', 'That code isn''t valid or has expired. Make a new one in Boekenwurm.');
  end if;
  perform prune_app_connections(c.user_id);
  insert into app_connections (user_id, app, name, token_hash)
    values (c.user_id, c.app, left(coalesce(nullif(trim(p_name), ''), c.app), 80), app_secret_hash(token))
    returning id into conn_id;
  return jsonb_build_object('token', token, 'connection_id', conn_id, 'app', c.app, 'status', 'pending');
end $$;
revoke all on function redeem_pairing_code(text, text) from public, anon, authenticated;

-- Apps trade a code for a token here. Failures are answered with {"error": ...} instead of an exception, so the
-- failed try is recorded (an exception would roll the record back): 10 per network address in 10 minutes and 300
-- in all per minute, then everyone waits. With the reader's approval on top, a guessed code connects nothing.
create or replace function claim_pairing_code(p_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := request_addr_key();
  r jsonb;
begin
  delete from app_pairing_failures where at < now() - interval '1 hour';
  if (select count(*) from app_pairing_failures where addr_key = me and at > now() - interval '10 minutes') >= 10
     or (select count(*) from app_pairing_failures where at > now() - interval '1 minute') >= 300 then
    return jsonb_build_object('error', 'too_many', 'message', 'Too many tries. Wait 10 minutes, then make a new code in Boekenwurm.');
  end if;
  r := redeem_pairing_code(p_code, p_name);
  if r ? 'error' then
    insert into app_pairing_failures (addr_key) values (me);
  end if;
  return r;
end $$;
revoke all on function claim_pairing_code(text, text) from public;
grant execute on function claim_pairing_code(text, text) to anon, authenticated;

-- A new code also clears the reader's stale connection requests.
create or replace function create_pairing_code(p_app text default 'poortwachter') returns text
language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := '';
  b bytea := decode(substr(random_hex(1), 1, 16), 'hex');
begin
  if auth.uid() is null then
    raise exception 'Sign in to connect an app' using errcode = '28000';
  end if;
  perform prune_app_connections(auth.uid());
  for i in 0..7 loop
    code := code || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1);
  end loop;
  delete from app_pairing_codes where user_id = auth.uid() or expires_at < now();
  insert into app_pairing_codes (code_hash, user_id, app, expires_at)
    values (app_secret_hash(code), auth.uid(), p_app, now() + interval '10 minutes');
  return substr(code, 1, 4) || '-' || substr(code, 5, 4);
end $$;

-- ---------------------------------------------------------------- 4. today's numbers only

drop function if exists connection_summary(text, timestamptz, timestamptz, date);

-- One whole day for the app: p_day (today or yesterday in p_tz) from p_start_hour to the same hour the next day
-- (Poortwachter's day runs 02:00 → 02:00). Numbers only: pages, active minutes, cards reviewed, diary yes/no.
-- An app that isn't (or is no longer, or not yet) connected gets {"error": "gone" | "pending", "message"}.
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
    select distinct s.at_level, (x ->> 'paragraphId')::uuid as pid
    from s, jsonb_array_elements(s.results) x
    where x ? 'paragraphId' and (x ->> 'paragraphId') ~ '^[0-9a-f-]{36}$'
  ), paras as (
    select read.at_level, p.book_id, p.page_number, p.countable
    from read join paragraphs p on p.id = read.pid and p.user_id = c.user_id
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

-- ---------------------------------------------------------------- 5. active time only while connected

create or replace function keep_activity_only_when_connected() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from app_connections where user_id = new.user_id and approved_at is not null) then
    new.active_seconds := 0;
    new.text_level := null;
    new.reader_rank := null;
  end if;
  return new;
end $$;
drop trigger if exists reading_sessions_activity on reading_sessions;
create trigger reading_sessions_activity before insert or update on reading_sessions
  for each row execute function keep_activity_only_when_connected();

-- Disconnecting the last app also clears what was measured for it.
create or replace function clear_activity_after_disconnect() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from app_connections where user_id = old.user_id and approved_at is not null) then
    update reading_sessions set active_seconds = 0, text_level = null, reader_rank = null
      where user_id = old.user_id and (active_seconds <> 0 or text_level is not null or reader_rank is not null);
  end if;
  return null;
end $$;
drop trigger if exists app_connections_cleared on app_connections;
create trigger app_connections_cleared after delete on app_connections
  for each row execute function clear_activity_after_disconnect();

-- Whatever 0013 may already have stored for readers without a connection goes now.
update reading_sessions rs set active_seconds = 0, text_level = null, reader_rank = null
 where (rs.active_seconds <> 0 or rs.text_level is not null or rs.reader_rank is not null)
   and not exists (select 1 from app_connections c where c.user_id = rs.user_id and c.approved_at is not null);

-- ---------------------------------------------------------------- 7. erase

-- Erase from my account: every connection, pending request and pairing code of the reader.
create or replace function forget_app_connections() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  delete from app_pairing_codes where user_id = auth.uid();
  delete from app_connections where user_id = auth.uid();
end $$;
revoke all on function forget_app_connections() from public, anon;
grant execute on function forget_app_connections() to authenticated;
