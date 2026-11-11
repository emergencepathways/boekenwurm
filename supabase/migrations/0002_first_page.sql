-- Boekenwurm: where the reader starts reading a printed book.
-- Books often have title pages, contents and a prologue before the story; the reader chooses the first page they
-- want to read, and progress counts pages from first_page to page_count (the last printed page). Pages 9 to 212
-- are 204 pages. Existing books start at page 1.

alter table books
  add column if not exists first_page integer not null default 1 check (first_page between 1 and 5000);

alter table books
  drop constraint if exists first_page_not_after_last,
  add constraint first_page_not_after_last check (page_count is null or first_page <= page_count);

comment on column books.first_page is 'First printed page the reader reads (photographed books); progress runs first_page..page_count.';
comment on column books.page_count is 'Last printed page of the book, for progress.';
