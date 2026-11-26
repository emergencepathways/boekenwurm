-- PRELAUNCH-REMOVE: connected apps are for the owner's own use and are removed before any public release
-- (docs/PRELAUNCH.md). Tightened by 0014 (no calendar, approval, limits, today only).
-- Boekenwurm: connected apps (Poortwachter first). docs/CONNECTED_APPS.md has the whole design.
--
-- A reader pairs an app from Account → Settings → Connected apps: Boekenwurm shows a short code, valid 10 minutes,
-- and the app trades it once for its own token. The token is not a sign-in: it opens exactly two things, a daily
-- summary of the reader's own numbers (connection_summary) and the app's study-plan calendar (put_app_calendar),
-- and the reader can disconnect it at any time. Codes and tokens are stored only as hashes.
--
-- Reading sessions also gain three columns the summary needs: active reading time (only time on screen with recent
-- input, packages/engine/src/activity.ts), the level of the text read, and the reader's rank at the time.

-- ---------------------------------------------------------------- reading sessions: active time and levels

alter table reading_sessions
  add column if not exists active_seconds integer not null default 0 check (active_seconds between 0 and 86400),
  add column if not exists text_level     text check (text_level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  add column if not exists reader_rank    text check (reader_rank in ('A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'));

-- Rank order, A0 lowest. A text counts as "at or above the reader's level" when its index is >= the rank's.
create function level_index(p_level text) returns integer
language sql immutable as $$
  select array_position(array['A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'], p_level)
$$;

-- ---------------------------------------------------------------- pairing codes and connections

create function app_secret_hash(p_secret text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(upper(regexp_replace(coalesce(p_secret, ''), '[\s-]', '', 'g')), 'UTF8')), 'hex')
$$;

-- Random hex from gen_random_uuid() (a strong random source built into Postgres 13+), so this needs no extension:
-- each UUID gives 30 random hex digits once its version and variant digits are left out.
create function random_hex(p_uuids integer) returns text
language sql volatile as $$
  select string_agg(substr(u, 1, 12) || substr(u, 14, 3) || substr(u, 18, 15), '')
  from (select replace(gen_random_uuid()::text, '-', '') as u from generate_series(1, p_uuids)) x
$$;
revoke all on function random_hex(integer) from public, anon, authenticated;

create table app_pairing_codes (
  code_hash  text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  user_id    uuid not null references auth.users (id) on delete cascade,
  app        text not null check (app in ('poortwachter')),
  expires_at timestamptz not null
);
alter table app_pairing_codes enable row level security;
alter table app_pairing_codes force row level security;
-- No policies: only the functions below read or write codes.
revoke all on app_pairing_codes from authenticated, anon;

create table app_connections (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  app          text not null check (app in ('poortwachter')),
  name         text not null check (char_length(name) between 1 and 80),   -- e.g. "Poortwachter on delilah-laptop"
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
alter table app_connections enable row level security;
alter table app_connections force row level security;
-- Readers see their own connections (never the token, which isn't stored) and may delete them (disconnect).
create policy own_connections_read on app_connections for select to authenticated using (user_id = auth.uid());
create policy own_connections_delete on app_connections for delete to authenticated using (user_id = auth.uid());
revoke insert, update on app_connections from authenticated, anon;
revoke all on app_connections from anon;

-- A new pairing code for the signed-in reader: 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L),
-- shown as XXXX-XXXX. Making a new one cancels the reader's earlier unused codes.
create function create_pairing_code(p_app text default 'poortwachter') returns text
language plpgsql security definer set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := '';
  b bytea := decode(substr(random_hex(1), 1, 16), 'hex');
begin
  if auth.uid() is null then
    raise exception 'Sign in to connect an app' using errcode = '28000';
  end if;
  for i in 0..7 loop
    code := code || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1);
  end loop;
  delete from app_pairing_codes where user_id = auth.uid() or expires_at < now();
  insert into app_pairing_codes (code_hash, user_id, app, expires_at)
    values (app_secret_hash(code), auth.uid(), p_app, now() + interval '10 minutes');
  return substr(code, 1, 4) || '-' || substr(code, 5, 4);
end $$;
revoke all on function create_pairing_code(text) from public, anon;
grant execute on function create_pairing_code(text) to authenticated;

-- The app trades a code for its token (once). Called without a sign-in, so it is granted to anon. The token
-- (360 random bits) is returned only here.
create function claim_pairing_code(p_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c app_pairing_codes%rowtype;
  token text := random_hex(3);   -- 90 random hex digits
  conn_id uuid;
begin
  delete from app_pairing_codes where expires_at < now();
  delete from app_pairing_codes where code_hash = app_secret_hash(p_code) returning * into c;
  if not found then
    raise exception 'That code isn''t valid or has expired. Make a new one in Boekenwurm.' using errcode = '22023';
  end if;
  insert into app_connections (user_id, app, name, token_hash)
    values (c.user_id, c.app, left(coalesce(nullif(trim(p_name), ''), c.app), 80), app_secret_hash(token))
    returning id into conn_id;
  return jsonb_build_object('token', token, 'connection_id', conn_id, 'app', c.app);
end $$;
revoke all on function claim_pairing_code(text, text) from public;
grant execute on function claim_pairing_code(text, text) to anon, authenticated;

-- The connection a token belongs to, or an error. Marks it used.
create function app_connection_for(p_token text) returns app_connections
language plpgsql security definer set search_path = public as $$
declare
  c app_connections%rowtype;
begin
  update app_connections set last_used_at = now() where token_hash = app_secret_hash(p_token) returning * into c;
  if not found then
    raise exception 'This app is no longer connected to Boekenwurm. Pair it again.' using errcode = '28000';
  end if;
  return c;
end $$;
-- Supabase grants new functions to anon and authenticated by default: this one is internal, so take that back.
revoke all on function app_connection_for(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- the daily summary

-- The reader's numbers between two moments (the app's own day, e.g. 02:00 to 02:00), and whether the diary was
-- written on p_day. Never any text: no book titles, words, sentences or diary entries.
--   pages             printed pages read (photographed and PDF books), plus 250 countable words = 1 page elsewhere
--   *_at_level        the same, counting only sessions whose text level is at or above the reader's rank then
--   active_minutes    active reading time (packages/engine/src/activity.ts)
--   cards_reviewed    flashcards reviewed in the window (each card once)
create function connection_summary(p_token text, p_from timestamptz, p_to timestamptz, p_day date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c app_connections%rowtype := app_connection_for(p_token);
  r jsonb;
begin
  if p_to <= p_from or p_to - p_from > interval '3 days' then
    raise exception 'Ask for at most three days at a time' using errcode = '22023';
  end if;
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
  ), prof as (
    select progress from profiles where user_id = c.user_id
  )
  select jsonb_build_object(
    'version', 1,
    'sessions', (select count(*) from s),
    'paragraphs', coalesce((select sum(paragraphs) from s), 0),
    'paragraphs_at_level', coalesce((select sum(paragraphs) from s where at_level), 0),
    'pages', coalesce((select sum(n) from pages), 0),
    'pages_at_level', coalesce((select n from pages where at_level), 0),
    'active_minutes', round(coalesce((select sum(active_seconds) from s), 0) / 60.0, 1),
    'active_minutes_at_level', round(coalesce((select sum(active_seconds) from s where at_level), 0) / 60.0, 1),
    'cards_reviewed', (select count(*) from cards where user_id = c.user_id and last_review >= p_from and last_review < p_to),
    'diary_done', coalesce((select (progress -> 'play' -> 'diaryDays') ? p_day::text from prof), false),
    'rank', (select reader_rank from s where reader_rank is not null order by started_at desc limit 1)
  ) into r;
  return r;
end $$;
revoke all on function connection_summary(text, timestamptz, timestamptz, date) from public;
grant execute on function connection_summary(text, timestamptz, timestamptz, date) to anon, authenticated;

-- ---------------------------------------------------------------- the app's calendar (a study plan as iCalendar)

-- An app may publish one calendar (its plan for the coming days). Boekenwurm only stores and serves it at a secret
-- address, through the "calendar" Edge Function, so calendar apps such as Google Calendar can subscribe to it.
create table app_calendars (
  connection_id uuid primary key references app_connections (id) on delete cascade,
  secret_hash   text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  ics           text not null check (octet_length(ics) <= 300000),
  updated_at    timestamptz not null default now()
);
alter table app_calendars enable row level security;
alter table app_calendars force row level security;
revoke all on app_calendars from authenticated, anon;

-- Store the app's calendar. The first call creates the secret feed address and returns it (null after that:
-- p_new_secret = true makes a new address and stops the old one).
create function put_app_calendar(p_token text, p_ics text, p_new_secret boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare
  c app_connections%rowtype := app_connection_for(p_token);
  secret text;
begin
  if p_ics is null or p_ics !~ '^BEGIN:VCALENDAR' then
    raise exception 'Not an iCalendar file' using errcode = '22023';
  end if;
  if p_new_secret or not exists (select 1 from app_calendars where connection_id = c.id) then
    secret := random_hex(2);
    insert into app_calendars (connection_id, secret_hash, ics) values (c.id, app_secret_hash(secret), p_ics)
      on conflict (connection_id) do update set secret_hash = excluded.secret_hash, ics = excluded.ics, updated_at = now();
    return secret;
  end if;
  update app_calendars set ics = p_ics, updated_at = now() where connection_id = c.id;
  return null;
end $$;
revoke all on function put_app_calendar(text, text, boolean) from public;
grant execute on function put_app_calendar(text, text, boolean) to anon, authenticated;

-- The calendar behind a feed address (for the Edge Function, which calls it with the anon key).
create function app_calendar_ics(p_secret text) returns text
language sql stable security definer set search_path = public as $$
  select ics from app_calendars where secret_hash = app_secret_hash(p_secret)
$$;
revoke all on function app_calendar_ics(text) from public;
grant execute on function app_calendar_ics(text) to anon;
