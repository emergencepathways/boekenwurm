-- Row-level security test, run against a plain Postgres with stand-ins for Supabase's auth and storage
-- (supabase/tests/supabase_stubs.sql). Two readers; each must see and change only their own rows.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

-- profiles were created by the trigger
select 'profiles created: ' || count(*) from profiles;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

insert into books (id, source, title, cover_path, page_count, level)
  values ('10000000-0000-0000-0000-000000000001', 'photo', 'Boek van A', 'x/cover.jpg', 212, 'A2');
insert into paragraphs (book_id, ord, page_number, text)
  values ('10000000-0000-0000-0000-000000000001', 0, 7, 'Een zin van lezer A.');
select add_word_stats('lopen', 2, 5, now(), 'Hij liep naar huis.');
select add_word_stats('lopen', 1, 3, null, null);
select 'A word_stats lopen: reveals=' || reveals || ' encounters=' || encounters from word_stats where lemma = 'lopen';

-- a photographed book without cover/page count/level is refused
do $$ begin
  insert into books (source, title) values ('photo', 'Zonder omslag');
  raise exception 'FAIL: photo book without details was accepted';
exception when check_violation then raise notice 'ok: photo book needs cover, page count and level';
end $$;

-- reader B
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'B sees books: ' || count(*) from books;
select 'B sees paragraphs: ' || count(*) from paragraphs;
select 'B sees word_stats: ' || count(*) from word_stats;

-- B can't add a paragraph to A's book
do $$ begin
  insert into paragraphs (book_id, ord, text) values ('10000000-0000-0000-0000-000000000001', 1, 'Ingebroken.');
  raise exception 'FAIL: B wrote into A''s book';
exception when insufficient_privilege then raise notice 'ok: B cannot write into A''s book';
end $$;

-- B can't claim a row for A
do $$ begin
  insert into books (user_id, source, title) values ('00000000-0000-0000-0000-00000000000a', 'epub', 'Vals');
  raise exception 'FAIL: B created a row owned by A';
exception when insufficient_privilege then raise notice 'ok: B cannot create rows for A';
end $$;

-- B's updates to A's rows touch nothing
update books set title = 'Gekaapt' where id = '10000000-0000-0000-0000-000000000001';
reset role;
select 'A''s title after B''s update: ' || title from books where id = '10000000-0000-0000-0000-000000000001';

-- storage: own folder only
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into storage.objects (bucket_id, name) values ('covers', '00000000-0000-0000-0000-00000000000a/b1.jpg');
do $$ begin
  insert into storage.objects (bucket_id, name) values ('covers', '00000000-0000-0000-0000-00000000000b/b1.jpg');
  raise exception 'FAIL: A wrote into B''s folder';
exception when insufficient_privilege then raise notice 'ok: storage is limited to the reader''s own folder';
end $$;
reset role;

-- first page (0002): progress runs first_page..page_count, and the first page can't come after the last
do $$ begin
  if (select first_page from books where id = '10000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'FAIL: existing books should start at page 1';
  end if;
  update books set first_page = 9, page_count = 212 where id = '10000000-0000-0000-0000-000000000001';
  raise notice 'ok: a book can start at page 9 of 212';
  begin
    update books set first_page = 300 where id = '10000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: first page 300 of 212 was accepted';
  exception when check_violation then raise notice 'ok: the first page cannot come after the last';
  end;
end $$;

-- translations (0003): 200 Google lookups a day per reader, counted where the reader can't change the count
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$
declare r record; i integer;
begin
  for i in 1..200 loop
    select * into r from claim_translation('Europe/Amsterdam');
    if not r.allowed then raise exception 'FAIL: lookup % of 200 was refused', i; end if;
  end loop;
  if r.used <> 200 then raise exception 'FAIL: count is % after 200 lookups', r.used; end if;
  select * into r from claim_translation('Europe/Amsterdam');
  if r.allowed or r.used <> 200 then raise exception 'FAIL: the 201st lookup was allowed'; end if;
  raise notice 'ok: 200 lookups a day are allowed, the 201st is refused';
  select * into r from claim_translation('Not/AZone');
  raise notice 'ok: an unknown time zone counts in UTC';
end $$;
do $$ begin
  update translation_usage set words = 0;
  if exists (select 1 from translation_usage where words = 0) then raise exception 'FAIL: B reset their own count'; end if;
  raise notice 'ok: a reader cannot reset their count';
end $$;
do $$ begin
  insert into translation_usage (day, words) values (current_date + 1, 0);
  raise exception 'FAIL: B wrote their own count';
exception when insufficient_privilege then raise notice 'ok: a reader cannot write their count';
end $$;
insert into word_meanings (word, lemma, meaning, source) values ('fietsenstalling', 'fietsenstalling', 'bicycle shed', 'google');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select 'A sees B''s usage rows: ' || count(*) from translation_usage;
select 'A sees B''s saved meanings: ' || count(*) from word_meanings;
do $$ declare r record; begin
  select * into r from claim_translation('Europe/Amsterdam');
  if not r.allowed or r.used <> 1 then raise exception 'FAIL: A''s count is not their own'; end if;
  raise notice 'ok: each reader has their own count';
end $$;
reset role;

-- access codes (0004): a code opens Google page reading for one reader, who may then read 20 pages a day
insert into access_codes (code_hash, feature, note) values (access_code_hash('BW-TEST-CODE-0001'), 'google_page_reading', 'test');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  perform claim_page_read('Europe/Amsterdam');
  raise exception 'FAIL: page reading without a code';
exception when insufficient_privilege then raise notice 'ok: Google page reading needs a code';
end $$;
do $$ begin
  perform count(*) from access_codes;
  raise exception 'FAIL: a reader can read the codes table';
exception when insufficient_privilege then raise notice 'ok: readers cannot read the codes, not even as hashes';
end $$;
do $$ begin
  perform redeem_code('BW-WRONG-CODE');
  raise exception 'FAIL: a wrong code was accepted';
exception when invalid_parameter_value then raise notice 'ok: a wrong code is refused';
end $$;
do $$ declare f text; r record; i integer; begin
  f := redeem_code(' bw-test code-0001 ');
  if f <> 'google_page_reading' then raise exception 'FAIL: the code opened %', f; end if;
  raise notice 'ok: a code works whatever its case, spaces and dashes';
  f := redeem_code('BW-TEST-CODE-0001');
  raise notice 'ok: the same reader can enter their code again';
  for i in 1..20 loop
    select * into r from claim_page_read('Europe/Amsterdam');
    if not r.allowed then raise exception 'FAIL: page % of 20 was refused', i; end if;
  end loop;
  select * into r from claim_page_read('Europe/Amsterdam');
  if r.allowed or r.used <> 20 then raise exception 'FAIL: the 21st page was allowed'; end if;
  raise notice 'ok: 20 pages a day are read by Google, the 21st is refused';
end $$;
do $$ begin
  insert into feature_access (user_id, feature) values ('00000000-0000-0000-0000-00000000000a', 'google_page_reading');
  raise exception 'FAIL: a reader granted themselves a feature';
exception when insufficient_privilege or unique_violation then raise notice 'ok: a reader cannot grant themselves a feature';
end $$;
do $$ begin
  update page_read_usage set pages = 0;
  if exists (select 1 from page_read_usage where pages = 0) then raise exception 'FAIL: A reset their page count'; end if;
  raise notice 'ok: a reader cannot reset their page count';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  perform redeem_code('BW-TEST-CODE-0001');
  raise exception 'FAIL: a used code worked for a second reader';
exception when invalid_parameter_value then raise notice 'ok: a code works for one reader only';
end $$;
do $$ begin
  if exists (select 1 from feature_access) then raise exception 'FAIL: B sees A''s access'; end if;
  perform claim_page_read('Europe/Amsterdam');
  raise exception 'FAIL: B reads pages without a code';
exception when insufficient_privilege then raise notice 'ok: other readers keep the free reader';
end $$;
reset role;

-- refunds (0005): a use Google couldn't serve is given back, by the server only
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  perform refund_page_read('00000000-0000-0000-0000-00000000000a', current_date);
  raise exception 'FAIL: a reader gave themselves a page back';
exception when insufficient_privilege then raise notice 'ok: readers cannot give themselves uses back';
end $$;
reset role;
set role service_role;
do $$ declare before integer; after integer; begin
  select pages into before from page_read_usage where user_id = '00000000-0000-0000-0000-00000000000a';
  perform refund_page_read('00000000-0000-0000-0000-00000000000a', (select day from page_read_usage where user_id = '00000000-0000-0000-0000-00000000000a'));
  select pages into after from page_read_usage where user_id = '00000000-0000-0000-0000-00000000000a';
  if after <> before - 1 then raise exception 'FAIL: refund went % -> %', before, after; end if;
  raise notice 'ok: the server gives back one page Google couldn''t read (% -> %)', before, after;
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ declare r record; begin
  select * into r from claim_page_read('Europe/Amsterdam');
  if not r.allowed or r.used <> 20 then raise exception 'FAIL: the refunded page could not be used again'; end if;
  raise notice 'ok: the page given back can be used again';
end $$;
reset role;

-- shared words (0006): Google's translations for everyone, written by the server only; 3 reports hide one
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000d');
set role service_role;
insert into shared_words (word, meaning) values ('fietsenstalling', 'bicycle parking'), ('vuurtoren', 'fire tower');
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select 'B sees shared words: ' || count(*) from shared_words;
do $$ begin
  insert into shared_words (word, meaning) values ('huis', 'mouse');
  raise exception 'FAIL: a reader added a shared word';
exception when insufficient_privilege then raise notice 'ok: readers cannot add shared words';
end $$;
do $$ begin
  update shared_words set meaning = 'wrong on purpose';
  raise exception 'FAIL: a reader changed a shared word';
exception when insufficient_privilege then raise notice 'ok: readers cannot change shared words';
end $$;
do $$ begin
  insert into word_reports (word, meaning) values ('vuurtoren', 'fire tower');
  raise exception 'FAIL: a reader wrote a report directly';
exception when insufficient_privilege then raise notice 'ok: reports are made only through report_shared_word';
end $$;
do $$ declare hid boolean; begin
  hid := report_shared_word('Vuurtoren', 'lighthouse');
  hid := report_shared_word('vuurtoren', 'lighthouse!');
  if hid then raise exception 'FAIL: hidden after one reader'; end if;
  if (select count(*) from word_reports) <> 1 then raise exception 'FAIL: a second report by the same reader counted'; end if;
  if report_shared_word('nietgedeeld', 'x') then raise exception 'FAIL: a word that isn''t shared'; end if;
  raise notice 'ok: one report per reader per word, with their suggestion';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin
  if report_shared_word('vuurtoren', 'lighthouse') then raise exception 'FAIL: hidden after two readers'; end if;
  if (select count(*) from word_reports) <> 1 then raise exception 'FAIL: C sees other readers'' reports'; end if;
  raise notice 'ok: readers see only their own reports';
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
do $$ begin
  if not report_shared_word('vuurtoren', 'lighthouse') then raise exception 'FAIL: not hidden after three readers'; end if;
  if exists (select 1 from shared_words where word = 'vuurtoren') then raise exception 'FAIL: a hidden word is still served'; end if;
  if not exists (select 1 from shared_words where word = 'fietsenstalling') then raise exception 'FAIL: other words hidden too'; end if;
  raise notice 'ok: 3 different readers hide a word from everyone until the owner reviews it';
end $$;
reset role;
do $$ begin
  update shared_words set meaning = 'lighthouse', source = 'owner', hidden = false, reports = 0, reviewed_at = now() where word = 'vuurtoren';
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select meaning from shared_words where word = 'vuurtoren') <> 'lighthouse' then raise exception 'FAIL: the owner''s fix isn''t served'; end if;
  if report_shared_word('vuurtoren', 'still wrong') then raise exception 'FAIL: reports from before the review still count'; end if;
  raise notice 'ok: the owner''s fix is served, and reports start again from the review';
end $$;
reset role;

-- deleting an account removes everything
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
select 'rows left for A: ' || (select count(*) from books where user_id = '00000000-0000-0000-0000-00000000000a')
     + (select count(*) from word_stats where user_id = '00000000-0000-0000-0000-00000000000a')
     + (select count(*) from profiles where user_id = '00000000-0000-0000-0000-00000000000a');
