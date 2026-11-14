-- Boekenwurm: flashcards as a review pool (Hard, Medium, Easy, Skipped) instead of FSRS scheduling.
--
-- A card is in the pool when Hard or Medium; Easy takes it out until a check-back after 3 days, 1 week, 3 weeks, then
-- every 2 months (easy_step counts the check-backs passed); Skipped drops it (packages/engine/src/review.ts).
-- `due` is when an Easy card comes back, or when a Hard or Medium card entered the pool. The FSRS columns
-- (stability, difficulty, state) are no longer written.

alter table cards
  add column pool text not null default 'medium' check (pool in ('hard', 'medium', 'easy', 'skipped')),
  add column easy_step smallint not null default 0 check (easy_step between 0 and 10);

-- Cards from before: one the reader already knew (in FSRS review, not due yet) starts as Easy; the rest wait as Medium.
update cards set pool = 'easy' where state = 2 and due > now();
