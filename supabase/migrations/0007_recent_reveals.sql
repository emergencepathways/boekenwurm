-- Boekenwurm: when each word was revealed in the last 14 days, for the colour-coded text (a reader setting).
--
-- word_stats keeps lifetime counters (0001). The colours need how often a word was revealed recently, on every
-- device, so the reveal times of the last 14 days are kept with the word. Devices add their times; nothing older than
-- 14 days is kept, and a time sent twice (a retried sync) is kept once.

alter table word_stats add column recent_reveals timestamptz[] not null default '{}';

create function add_recent_reveals(p_lemma text, p_times timestamptz[]) returns void
language sql security invoker as $$
  insert into word_stats (user_id, lemma) values (auth.uid(), p_lemma)
  on conflict (user_id, lemma) do nothing;
  update word_stats w set recent_reveals = coalesce((
    select array_agg(t order by t)
    from (select distinct unnest(w.recent_reveals || coalesce(p_times, '{}')) as t) x
    where t > now() - interval '14 days' and t <= now() + interval '1 day'
  ), '{}')
  where w.user_id = auth.uid() and w.lemma = p_lemma;
$$;

revoke all on function add_recent_reveals(text, timestamptz[]) from public;
grant execute on function add_recent_reveals(text, timestamptz[]) to authenticated;
