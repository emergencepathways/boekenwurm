-- Boekenwurm: what the Words tab needs to tell when a word on a word list is learned (docs/DESIGN.md "Word lists").
--
-- A word is learned when it was read in 10 or more paragraphs without being tapped (unlimited lookup mode doesn't
-- count), and, if it was ever tapped, its flashcard has been Easy for 2 weeks or more.
--   word_stats.untapped  paragraphs read with the word in them, without a tap; added from every device.
--   cards.easy_since     when the card last became Easy; null while Hard, Medium or Skipped.

alter table word_stats add column untapped integer not null default 0 check (untapped >= 0);

create function add_word_untapped(p_lemma text, p_n integer) returns void
language sql security invoker as $$
  insert into word_stats (user_id, lemma, untapped) values (auth.uid(), p_lemma, greatest(p_n, 0))
  on conflict (user_id, lemma) do update set untapped = word_stats.untapped + greatest(p_n, 0);
$$;

revoke all on function add_word_untapped(text, integer) from public;
grant execute on function add_word_untapped(text, integer) to authenticated;

alter table cards add column easy_since timestamptz;

-- Easy cards from before start counting from their last review.
update cards set easy_since = coalesce(last_review, updated_at) where pool = 'easy';
