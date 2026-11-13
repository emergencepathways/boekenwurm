-- Boekenwurm: a lookup or page reading that Google couldn't do is given back.
--
-- The functions claim one use of the reader's daily allowance before calling Google (0003, 0004). When Google then
-- fails (an API not enabled, a quota, an outage), the reader shouldn't lose that use. Only the server can give it
-- back: these functions are for the service role (the Edge Functions), not for readers, who could otherwise reset
-- their own counts.

create function refund_translation(p_user uuid, p_day date) returns void
language sql security definer set search_path = public as $$
  update translation_usage set words = greatest(words - 1, 0) where user_id = p_user and day = p_day;
$$;

create function refund_page_read(p_user uuid, p_day date) returns void
language sql security definer set search_path = public as $$
  update page_read_usage set pages = greatest(pages - 1, 0) where user_id = p_user and day = p_day;
$$;

revoke all on function refund_translation(uuid, date) from public, anon, authenticated;
revoke all on function refund_page_read(uuid, date) from public, anon, authenticated;
grant execute on function refund_translation(uuid, date) to service_role;
grant execute on function refund_page_read(uuid, date) to service_role;
