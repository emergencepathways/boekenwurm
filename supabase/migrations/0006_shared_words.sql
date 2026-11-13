-- Boekenwurm: Google translations shared by all readers, and reports of wrong ones.
--
-- A word the open dictionary doesn't know is translated by Google once for everyone: the translate function saves
-- each translation here, and serves it to the next reader who taps that word without asking Google again or using
-- one of their 200 lookups. Only the function (the service role) writes this table, so a reader can't plant a
-- meaning for everyone. Meanings a reader typed stay their own (word_meanings, 0003).
--
-- A reader who finds a shared translation wrong reports it with the meaning they think is right; that meaning is
-- theirs at once (the app saves it as their own). Once 3 different readers have reported a word, it is hidden from
-- everyone until the owner reviews it (queries at the end).

create table shared_words (
  word        text primary key check (char_length(word) between 1 and 80 and word = lower(word)),  -- as sent to Google
  meaning     text not null check (char_length(meaning) between 1 and 300),
  source      text not null default 'google' check (source in ('google', 'owner')),
  reports     integer not null default 0 check (reports >= 0),
  hidden      boolean not null default false,          -- 3 reports, or hidden by the owner
  reviewed_at timestamptz,                             -- set by the owner after a review
  created_at  timestamptz not null default now()
);
alter table shared_words enable row level security;
alter table shared_words force row level security;
-- Readers may read shared meanings that aren't hidden; nobody but the server and the owner writes them.
create policy read_shared on shared_words for select to authenticated using (not hidden);
revoke insert, update, delete on shared_words from authenticated, anon;

create table word_reports (
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  word       text not null references shared_words (word) on delete cascade,
  meaning    text not null,                                                  -- the shared meaning they saw
  suggestion text check (suggestion is null or char_length(suggestion) between 1 and 300),
  created_at timestamptz not null default now(),
  primary key (user_id, word)
);
alter table word_reports enable row level security;
alter table word_reports force row level security;
-- Readers see their own reports; they are made only through report_shared_word().
create policy own_reports on word_reports for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on word_reports from authenticated, anon;

-- Report a shared translation as wrong, with the meaning the reader thinks is right. One report per reader per word
-- (a second one updates the suggestion). Returns whether the word is now hidden (3 different readers).
create function report_shared_word(p_word text, p_suggestion text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  w shared_words%rowtype;
  n integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to report a translation' using errcode = '28000';
  end if;
  select * into w from shared_words where word = lower(trim(p_word)) for update;
  if not found then
    return false; -- not a shared word (the reader's own meaning, or already removed): nothing to report
  end if;
  insert into word_reports (user_id, word, meaning, suggestion)
  values (auth.uid(), w.word, w.meaning, nullif(left(trim(coalesce(p_suggestion, '')), 300), ''))
  on conflict (user_id, word) do update set suggestion = excluded.suggestion, created_at = now();
  select count(*) into n from word_reports where word = w.word and created_at > coalesce(w.reviewed_at, '-infinity');
  update shared_words set reports = n, hidden = hidden or n >= 3 where word = w.word;
  return w.hidden or n >= 3;
end $$;

revoke all on function report_shared_word(text, text) from public;
grant execute on function report_shared_word(text, text) to authenticated;

-- ---------------------------------------------------------------- for the owner (SQL Editor, which bypasses RLS)

comment on table shared_words is
  'Google translations shared by all readers. Reported words: select w.word, w.meaning, w.reports, w.hidden, r.suggestion, u.email from shared_words w join word_reports r on r.word = w.word join auth.users u on u.id = r.user_id where w.reports > 0 order by w.reports desc, w.word; '
  'Fix one: update shared_words set meaning = ''the right meaning'', source = ''owner'', hidden = false, reports = 0, reviewed_at = now() where word = ''woord''; '
  'Remove one (Google is asked again next time): delete from shared_words where word = ''woord'';';
