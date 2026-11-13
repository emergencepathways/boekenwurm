-- Minimal stand-ins for the parts of Supabase the migration uses, so it can be tested on plain Postgres.
-- Not used in production: Supabase provides the real auth and storage schemas.
create role authenticated nologin;
create role anon nologin;
create role service_role nologin bypassrls; -- as in Supabase: the server, past row-level security
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets, name text not null);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/')
$$;
grant usage on schema auth, storage, public to authenticated;
grant execute on function auth.uid() to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
grant usage on schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
