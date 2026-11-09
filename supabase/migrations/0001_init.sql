-- Boekenwurm: initial schema.
-- Every table belongs to one reader (user_id) and row-level security limits each reader to their own rows.
-- Storage buckets are private and laid out as {user_id}/..., with the same rule.
-- See docs/ARCHITECTURE.md for how the app syncs these tables with its local store.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- shared types

create type cefr_level as enum ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');
create type book_source as enum ('sample', 'epub', 'pdf', 'photo');
create type book_status as enum ('processing', 'ready', 'failed', 'archived');
create type page_status as enum ('queued', 'reading', 'done', 'failed');

-- updated_at is what the app's sync compares; keep it current on every change.
create function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- readers

create table profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  level        cefr_level not null default 'A1',
  settings     jsonb not null default '{}'::jsonb,        -- preset, definition language, models (never the Claude key)
  progress     jsonb not null default '{}'::jsonb,        -- engine Progress: tokens, history, offer, badges
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- A profile row for every new account.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------- books

create table books (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade default auth.uid(),
  source        book_source not null,
  title         text not null check (char_length(title) between 1 and 300),
  author        text check (char_length(author) <= 200),
  isbn          text check (isbn ~ '^[0-9]{9}[0-9X]$|^97[89][0-9]{10}$'),
  cover_path    text,                                    -- storage: covers/{user_id}/{book_id}.jpg
  file_path     text,                                    -- storage: books/{user_id}/{book_id}.epub|.pdf
  page_count    integer check (page_count between 1 and 5000),   -- printed pages, for progress
  level         cefr_level,                              -- set by the reader (photo) or graded (files)
  level_source  text check (level_source in ('reader', 'graded')),
  scan          jsonb,                                   -- book level result: distribution, grammar, word match
  status        book_status not null default 'processing',
  position      jsonb not null default '{}'::jsonb,      -- last paragraph read, mode (original | match)
  pages_read    integer[] not null default '{}',         -- printed page numbers finished (photographed books)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- A photographed book needs a cover, a page count and the reader's level for it.
  constraint photo_book_details check (
    source <> 'photo' or (cover_path is not null and page_count is not null and level is not null)
  )
);
create index books_user on books (user_id, updated_at desc);

-- Photographs of printed pages, one row per photo.
create table book_pages (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade default auth.uid(),
  book_id      uuid not null references books (id) on delete cascade,
  seq          integer not null check (seq >= 0),        -- order taken
  page_number  integer check (page_number between 1 and 5000),  -- printed number, read from the photo
  photo_path   text,                                     -- storage: pages/{user_id}/{book_id}/{id}.jpg; null once deleted
  status       page_status not null default 'queued',
  model        text,
  error        text,
  starts_mid_paragraph boolean not null default false,   -- first paragraph continues the previous page
  ends_mid_paragraph   boolean not null default false,   -- last paragraph continues on the next page
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (book_id, seq)
);
create index book_pages_book on book_pages (book_id, seq);

-- The paragraphs the reader reads, for every kind of book.
create table paragraphs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  book_id     uuid not null references books (id) on delete cascade,
  ord         integer not null check (ord >= 0),
  page_number integer,                                   -- printed page the paragraph starts on, when known
  text        text not null check (char_length(text) between 1 and 20000),
  tokens      jsonb not null default '[]'::jsonb,        -- [{t, k, s, e, lemma}]
  countable   integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (book_id, ord)
);

-- A paragraph matched to a reader's level. Private to the reader; regenerated after a level change.
create table paragraph_versions (
  paragraph_id   uuid not null references paragraphs (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade default auth.uid(),
  level          cefr_level not null,
  model          text not null,
  changed        boolean not null,
  text           text not null,
  original_level cefr_level,
  created_at     timestamptz not null default now(),
  primary key (paragraph_id, level, model)
);

-- ---------------------------------------------------------------- reading and words

create table reading_sessions (
  id            uuid primary key,                        -- the engine's session id, made on the device
  user_id       uuid not null references auth.users (id) on delete cascade default auth.uid(),
  book_id       uuid references books (id) on delete set null,
  started_at    timestamptz not null,
  ended_at      timestamptz,
  preset        text not null,
  level         cefr_level not null,
  paragraphs    integer not null default 0,
  best_streak   integer not null default 0,
  token_earned  boolean not null default false,
  ended_by      text check (ended_by in ('strike', 'end_of_book', 'left')),
  results       jsonb not null default '[]'::jsonb       -- engine ParagraphResult[]
);
create index reading_sessions_user on reading_sessions (user_id, started_at desc);

create table word_stats (
  user_id       uuid not null references auth.users (id) on delete cascade default auth.uid(),
  lemma         text not null check (char_length(lemma) between 1 and 80),
  reveals       integer not null default 0 check (reveals >= 0),
  encounters    integer not null default 0 check (encounters >= 0),
  first_seen    timestamptz not null default now(),
  last_revealed timestamptz,
  example       text,                                    -- a sentence it was revealed in
  updated_at    timestamptz not null default now(),
  primary key (user_id, lemma)
);

-- Counters from different devices are added, never overwritten.
create function add_word_stats(p_lemma text, p_reveals integer, p_encounters integer,
                               p_last_revealed timestamptz, p_example text)
returns void language sql security invoker as $$
  insert into word_stats (user_id, lemma, reveals, encounters, last_revealed, example)
  values (auth.uid(), p_lemma, greatest(p_reveals, 0), greatest(p_encounters, 0), p_last_revealed, p_example)
  on conflict (user_id, lemma) do update set
    reveals       = word_stats.reveals + excluded.reveals,
    encounters    = word_stats.encounters + excluded.encounters,
    last_revealed = greatest(word_stats.last_revealed, excluded.last_revealed),
    example       = coalesce(word_stats.example, excluded.example);
$$;

-- Flashcards (FSRS scheduling state).
create table cards (
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  lemma       text not null,
  due         timestamptz not null default now(),
  stability   real,
  difficulty  real,
  reps        integer not null default 0,
  lapses      integer not null default 0,
  state       smallint not null default 0,               -- 0 new, 1 learning, 2 review, 3 relearning
  last_review timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (user_id, lemma)
);
create index cards_due on cards (user_id, due);

-- A reader's own imported word list (e.g. from their textbook). The open default dictionary ships with the app.
create table word_lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name        text not null check (char_length(name) between 1 and 120),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table word_list_entries (
  list_id     uuid not null references word_lists (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  lemma       text not null,
  gloss       text,
  article     text check (article in ('de', 'het')),
  chapter     integer,                                   -- first chapter that uses the word, when known
  primary key (list_id, lemma)
);

-- ---------------------------------------------------------------- updated_at triggers

create trigger profiles_touch before update on profiles for each row execute function touch_updated_at();
create trigger books_touch before update on books for each row execute function touch_updated_at();
create trigger book_pages_touch before update on book_pages for each row execute function touch_updated_at();
create trigger paragraphs_touch before update on paragraphs for each row execute function touch_updated_at();
create trigger word_stats_touch before update on word_stats for each row execute function touch_updated_at();
create trigger cards_touch before update on cards for each row execute function touch_updated_at();
create trigger word_lists_touch before update on word_lists for each row execute function touch_updated_at();

-- ---------------------------------------------------------------- row-level security: own rows only

do $$
declare t text;
begin
  foreach t in array array['profiles', 'books', 'book_pages', 'paragraphs', 'paragraph_versions',
                           'reading_sessions', 'word_stats', 'cards', 'word_lists', 'word_list_entries']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy own_rows on %I for all to authenticated
                      using (user_id = auth.uid()) with check (user_id = auth.uid())$p$, t);
  end loop;
end $$;

-- A child row must point at a parent the same reader owns.
create function owns_book(b uuid) returns boolean language sql stable security invoker as $$
  select exists (select 1 from books where id = b and user_id = auth.uid());
$$;
create policy pages_in_own_book on book_pages as restrictive for all to authenticated
  using (owns_book(book_id)) with check (owns_book(book_id));
create policy paragraphs_in_own_book on paragraphs as restrictive for all to authenticated
  using (owns_book(book_id)) with check (owns_book(book_id));
create policy entries_in_own_list on word_list_entries as restrictive for all to authenticated
  using (exists (select 1 from word_lists l where l.id = list_id and l.user_id = auth.uid()))
  with check (exists (select 1 from word_lists l where l.id = list_id and l.user_id = auth.uid()));

-- ---------------------------------------------------------------- private storage

insert into storage.buckets (id, name, public) values
  ('covers', 'covers', false),
  ('pages', 'pages', false),
  ('books', 'books', false)
on conflict (id) do nothing;

create policy own_files on storage.objects for all to authenticated
  using (bucket_id in ('covers', 'pages', 'books') and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id in ('covers', 'pages', 'books') and (storage.foldername(name))[1] = auth.uid()::text);
