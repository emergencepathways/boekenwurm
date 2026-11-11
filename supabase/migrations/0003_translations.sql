-- Boekenwurm: Google Translate lookups, counted per reader, and the meanings they found, kept per reader.
--
-- A tapped word the open dictionary doesn't know is translated with Google Cloud Translation, which Boekenwurm's owner
-- pays for. Each reader may look up 200 words a day (in their own time zone); the count lives here, where the reader
-- can read it but not change it, and only claim_translation() adds to it. Every meaning found (by Google, by Claude
-- with the reader's key, or typed by the reader) is saved in word_meanings, and the app looks there before asking
-- Google again, on any of the reader's devices.

-- ---------------------------------------------------------------- the daily count

create table translation_usage (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  day     date not null,                                  -- the reader's local date
  words   integer not null default 0 check (words >= 0),  -- Google lookups that day
  primary key (user_id, day)
);

alter table translation_usage enable row level security;
alter table translation_usage force row level security;
-- Readers see their own counts; no insert, update or delete policy, so only claim_translation() changes them.
create policy own_usage on translation_usage for select to authenticated using (user_id = auth.uid());

-- One Google lookup, if today's allowance has room: returns whether it may go ahead and the count after it.
-- p_tz is the reader's IANA time zone (e.g. Europe/Amsterdam), so the day turns at their midnight; an unknown zone
-- counts in UTC.
create function claim_translation(p_tz text default 'UTC')
returns table (allowed boolean, used integer, daily_limit integer, day date)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  lim constant integer := 200;
  d date;
  n integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to look words up' using errcode = '28000';
  end if;
  begin
    d := (now() at time zone coalesce(nullif(p_tz, ''), 'UTC'))::date;
  exception when others then
    d := (now() at time zone 'UTC')::date;
  end;
  insert into translation_usage as u (user_id, day, words) values (auth.uid(), d, 1)
  on conflict (user_id, day) do update set words = u.words + 1 where u.words < lim
  returning u.words into n;
  if n is null then -- the allowance is used up: nothing was added
    select u.words into n from translation_usage u where u.user_id = auth.uid() and u.day = d;
    return query select false, n, lim, d;
  else
    return query select true, n, lim, d;
  end if;
end $$;

revoke all on function claim_translation(text) from public;
grant execute on function claim_translation(text) to authenticated;

-- ---------------------------------------------------------------- the reader's own meanings

create table word_meanings (
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  word       text not null check (char_length(word) between 1 and 80),     -- as tapped, lowercase
  lemma      text not null check (char_length(lemma) between 1 and 80),    -- the base form the app counts it under
  meaning    text not null check (char_length(meaning) between 1 and 300),
  source     text not null check (source in ('google', 'claude', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, lemma)
);
create index word_meanings_word on word_meanings (user_id, word);

create trigger word_meanings_touch before update on word_meanings for each row execute function touch_updated_at();

alter table word_meanings enable row level security;
alter table word_meanings force row level security;
create policy own_rows on word_meanings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- for the owner (SQL Editor, which bypasses RLS)

comment on table translation_usage is
  'Google Translate lookups per reader per day (limit 200). Per reader: select u.email, t.day, t.words from translation_usage t join auth.users u on u.id = t.user_id order by t.day desc, t.words desc;';
