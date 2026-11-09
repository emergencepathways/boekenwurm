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

-- deleting an account removes everything
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
select 'rows left for A: ' || (select count(*) from books where user_id = '00000000-0000-0000-0000-00000000000a')
     + (select count(*) from word_stats where user_id = '00000000-0000-0000-0000-00000000000a')
     + (select count(*) from profiles where user_id = '00000000-0000-0000-0000-00000000000a');
