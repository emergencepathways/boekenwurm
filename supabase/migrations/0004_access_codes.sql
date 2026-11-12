-- Boekenwurm: access codes for features that aren't open to every reader yet, and Google page reading behind one.
--
-- Google page reading reads a photographed page with Google Cloud Vision, which Boekenwurm's owner pays for. For now
-- it is a test of a future paid feature: only readers who redeemed a code have it, and each may read 20 pages a day
-- (in their own time zone). Everyone else keeps the free reader on their device.
--
-- Codes are stored only as a hash, so this table never holds a usable code. A code works a set number of times
-- (once by default). Readers can't read the codes, their own access or their counts except through what is granted
-- below, and can't change them.

-- ---------------------------------------------------------------- codes and access

-- The hash a code is stored and checked under: case, spaces and dashes don't matter ("bw-abcd efgh" = "BWABCDEFGH").
create function access_code_hash(p_code text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')), 'UTF8')), 'hex')
$$;

create table access_codes (
  code_hash  text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  feature    text not null check (feature in ('google_page_reading')),
  max_uses   integer not null default 1 check (max_uses >= 1),
  uses       integer not null default 0 check (uses >= 0 and uses <= max_uses),
  note       text,                                         -- who it is for; for the owner only
  created_at timestamptz not null default now()
);
alter table access_codes enable row level security;
alter table access_codes force row level security;
-- No policies: readers can't see or change codes. Only redeem_code() reads them.
revoke all on access_codes from authenticated, anon;

create table feature_access (
  user_id    uuid not null references auth.users (id) on delete cascade,
  feature    text not null check (feature in ('google_page_reading')),
  granted_at timestamptz not null default now(),
  primary key (user_id, feature)
);
alter table feature_access enable row level security;
alter table feature_access force row level security;
-- Readers see their own features; only redeem_code() (or the owner, in the SQL Editor) grants them.
create policy own_features on feature_access for select to authenticated using (user_id = auth.uid());

-- Redeem a code for the signed-in reader: returns the feature it opens. A code the reader already used, or one for a
-- feature they already have, opens it without using up another use.
create function redeem_code(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  c access_codes%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to use a code' using errcode = '28000';
  end if;
  select * into c from access_codes where code_hash = access_code_hash(p_code) for update;
  if not found then
    raise exception 'That code isn''t valid' using errcode = '22023';
  end if;
  if exists (select 1 from feature_access where user_id = auth.uid() and feature = c.feature) then
    return c.feature;
  end if;
  if c.uses >= c.max_uses then
    raise exception 'That code has already been used' using errcode = '22023';
  end if;
  update access_codes set uses = uses + 1 where code_hash = c.code_hash;
  insert into feature_access (user_id, feature) values (auth.uid(), c.feature);
  return c.feature;
end $$;

revoke all on function redeem_code(text) from public;
grant execute on function redeem_code(text) to authenticated;

-- ---------------------------------------------------------------- Google page reading: 20 pages a day

create table page_read_usage (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  day     date not null,                                  -- the reader's local date
  pages   integer not null default 0 check (pages >= 0),  -- pages read by Google that day
  primary key (user_id, day)
);
alter table page_read_usage enable row level security;
alter table page_read_usage force row level security;
create policy own_usage on page_read_usage for select to authenticated using (user_id = auth.uid());

-- One page read by Google, for a reader with access and room in today's allowance. Refuses readers without access.
create function claim_page_read(p_tz text default 'UTC')
returns table (allowed boolean, used integer, daily_limit integer, day date)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  lim constant integer := 20;
  d date;
  n integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to use Google page reading' using errcode = '28000';
  end if;
  if not exists (select 1 from feature_access f where f.user_id = auth.uid() and f.feature = 'google_page_reading') then
    raise exception 'Google page reading needs an access code' using errcode = '42501';
  end if;
  begin
    d := (now() at time zone coalesce(nullif(p_tz, ''), 'UTC'))::date;
  exception when others then
    d := (now() at time zone 'UTC')::date;
  end;
  insert into page_read_usage as u (user_id, day, pages) values (auth.uid(), d, 1)
  on conflict (user_id, day) do update set pages = u.pages + 1 where u.pages < lim
  returning u.pages into n;
  if n is null then
    select u.pages into n from page_read_usage u where u.user_id = auth.uid() and u.day = d;
    return query select false, n, lim, d;
  else
    return query select true, n, lim, d;
  end if;
end $$;

revoke all on function claim_page_read(text) from public;
grant execute on function claim_page_read(text) to authenticated;

-- ---------------------------------------------------------------- for the owner (SQL Editor, which bypasses RLS)

comment on table access_codes is
  'Codes that open a feature, stored as hashes. New code: insert into access_codes (code_hash, feature, note) values (access_code_hash(''BW-XXXX-XXXX-XXXX-XXXX''), ''google_page_reading'', ''for whom''); Who has what: select u.email, f.feature, f.granted_at from feature_access f join auth.users u on u.id = f.user_id;';
comment on table page_read_usage is
  'Google page reading per reader per day (limit 20). Per reader: select u.email, p.day, p.pages from page_read_usage p join auth.users u on u.id = p.user_id order by p.day desc;';
