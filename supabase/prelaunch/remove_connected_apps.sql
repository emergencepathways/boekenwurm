-- Boekenwurm: remove connected apps before a public release (docs/PRELAUNCH.md, step 1).
-- NOT a migration yet: copy it into supabase/migrations/ with the next number when removing the feature.

drop trigger if exists reading_sessions_activity on reading_sessions;
drop trigger if exists app_connections_cleared on app_connections;
drop function if exists keep_activity_only_when_connected();
drop function if exists clear_activity_after_disconnect();
drop function if exists connection_summary(text, date, text, integer);
drop function if exists connection_summary(text, timestamptz, timestamptz, date);
drop function if exists claim_pairing_code(text, text);
drop function if exists redeem_pairing_code(text, text);
drop function if exists create_pairing_code(text);
drop function if exists approve_app_connection(uuid);
drop function if exists my_app_connections();
drop function if exists forget_app_connections();
drop function if exists prune_app_connections(uuid);
drop function if exists app_connection_state(text);
drop function if exists app_connection_for(text);
drop function if exists request_addr_key();
drop function if exists put_app_calendar(text, text, boolean);
drop function if exists app_calendar_ics(text);
drop table if exists app_calendars;
drop table if exists app_pairing_failures;
drop table if exists app_pairing_codes;
drop table if exists app_connections;
drop function if exists app_secret_hash(text);
drop function if exists random_hex(integer);
drop function if exists level_index(text);
alter table reading_sessions
  drop column if exists active_seconds,
  drop column if exists text_level,
  drop column if exists reader_rank;
