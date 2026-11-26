-- PRELAUNCH-REMOVE: connected apps are for the owner's own use and are removed before any public release
-- (docs/PRELAUNCH.md). Boekenwurm: connect Poortwachter with one click, the owner's account only (2026-11-26).
--
-- Typing a pairing code is replaced by a browser handoff, the way desktop apps sign in (OAuth 2.0 for native apps,
-- RFC 8252, with PKCE, RFC 7636):
--
--   1. Poortwachter, on the reader's computer, makes a one-time secret (the verifier) and sends the browser to
--      Boekenwurm with only its SHA-256 (the challenge).
--   2. Signed in, the reader reads what will be shared and clicks Allow: link_app() keeps a one-time code, bound to
--      that challenge, for 2 minutes, and the browser is sent back to Poortwachter at http://127.0.0.1:7623, an
--      address fixed in the app (no app can name another one).
--   3. Poortwachter trades the code and its verifier for its token: claim_app_link(). The code alone is useless, so a
--      copied or intercepted code connects nothing, and there is nothing to guess (256-bit codes). That is why the
--      guessing limits of 0014 and their hashed network addresses are no longer needed: they are dropped here, so
--      Boekenwurm keeps less about people, not more.
--
-- Consent and approval are the same signed-in click, so connections are approved when they are made.
-- Only accounts with the admin feature (the owner, migration 0010) can connect apps: the database checks it when a
-- connection is made and every time an app asks for numbers, and connections of other accounts are deleted.
-- Same data as 0014: today's numbers only, 90-day expiry, erase and export.

-- ---------------------------------------------------------------- the owner only

create or replace function app_owner(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from feature_access where user_id = p_user and feature = 'admin')
$$;
revoke all on function app_owner(uuid) from public, anon, authenticated;

delete from app_connections c where not app_owner(c.user_id);

-- ---------------------------------------------------------------- no more typed codes

drop function if exists claim_pairing_code(text, text);
drop function if exists redeem_pairing_code(text, text);
drop function if exists create_pairing_code(text);
drop function if exists approve_app_connection(uuid);
drop function if exists request_addr_key();
drop table if exists app_pairing_failures;
delete from app_pairing_codes;
delete from app_connections where approved_at is null;

-- A code now carries the app's challenge and the name it asked for.
alter table app_pairing_codes add column if not exists challenge text
  check (challenge ~ '^[A-Za-z0-9_-]{43}$');
alter table app_pairing_codes add column if not exists name text check (length(name) <= 80);

-- base64url of SHA-256, without padding: how PKCE writes a challenge.
create or replace function pkce_challenge(p_verifier text) returns text
language sql immutable as $$
  select translate(rtrim(encode(sha256(convert_to(p_verifier, 'UTF8')), 'base64'), '='), '+/', '-_')
$$;
revoke all on function pkce_challenge(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. the reader allows

-- Called by the signed-in owner after clicking Allow. Returns the one-time code that goes back to the app.
create or replace function link_app(p_challenge text, p_name text, p_app text default 'poortwachter') returns text
language plpgsql security definer set search_path = public as $$
declare
  code text := random_hex(2);   -- 60 random hex digits (240 bits)
begin
  if auth.uid() is null then
    raise exception 'Sign in to connect an app' using errcode = '28000';
  end if;
  if not app_owner(auth.uid()) then
    raise exception 'Connected apps are only for the owner''s account' using errcode = '42501';
  end if;
  if p_app <> 'poortwachter' or p_challenge !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'That connection request isn''t valid' using errcode = '22023';
  end if;
  perform prune_app_connections(auth.uid());
  delete from app_pairing_codes where user_id = auth.uid() or expires_at < now();
  insert into app_pairing_codes (code_hash, user_id, app, expires_at, challenge, name)
    values (app_secret_hash(code), auth.uid(), p_app, now() + interval '2 minutes', p_challenge,
            left(coalesce(nullif(regexp_replace(trim(coalesce(p_name, '')), '[[:cntrl:]]', '', 'g'), ''), 'Poortwachter'), 80));
  return code;
end $$;
revoke all on function link_app(text, text, text) from public, anon;
grant execute on function link_app(text, text, text) to authenticated;

-- ---------------------------------------------------------------- 3. the app trades code + verifier for a token

-- Never raises, so a used code stays used. Wrong verifier: the code is gone all the same.
create or replace function claim_app_link(p_code text, p_verifier text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c app_pairing_codes%rowtype;
  token text := random_hex(3);   -- 90 random hex digits (360 bits)
  conn_id uuid;
begin
  if p_code is null or p_verifier is null or p_verifier !~ '^[A-Za-z0-9_-]{43,128}$' then
    return jsonb_build_object('error', 'invalid', 'message', 'That connection request isn''t valid.');
  end if;
  delete from app_pairing_codes where expires_at < now();
  delete from app_pairing_codes where code_hash = app_secret_hash(p_code) returning * into c;
  if not found or c.challenge is null or c.challenge <> pkce_challenge(p_verifier) then
    return jsonb_build_object('error', 'invalid',
      'message', 'That connection has expired or was already used. Start again from Boekenwurm.');
  end if;
  if not app_owner(c.user_id) then
    return jsonb_build_object('error', 'invalid', 'message', 'Connected apps are only for the owner''s account.');
  end if;
  insert into app_connections (user_id, app, name, token_hash, approved_at)
    values (c.user_id, c.app, c.name, app_secret_hash(token), now())
    returning id into conn_id;
  return jsonb_build_object('token', token, 'connection_id', conn_id, 'app', c.app, 'status', 'ok');
end $$;
revoke all on function claim_app_link(text, text) from public;
grant execute on function claim_app_link(text, text) to anon, authenticated;

-- ---------------------------------------------------------------- every use: still the owner?

create or replace function app_connection_state(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c app_connections%rowtype;
begin
  select * into c from app_connections where token_hash = app_secret_hash(p_token);
  if not found then
    return jsonb_build_object('state', 'gone');
  end if;
  if c.approved_at is null or not app_owner(c.user_id)
     or coalesce(c.last_used_at, c.approved_at) < now() - interval '90 days' then
    delete from app_connections where id = c.id;
    return jsonb_build_object('state', 'gone');
  end if;
  update app_connections set last_used_at = now() where id = c.id;
  return jsonb_build_object('state', 'ok', 'user_id', c.user_id);
end $$;
revoke all on function app_connection_state(text) from public, anon, authenticated;
