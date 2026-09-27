-- Sellbase 0000_foundation
-- Schema, extensions, privileges and shared helpers. Business tables arrive in 0001_init.
-- Published migrations are immutable: every change is a new file.

create schema if not exists sellbase;
comment on schema sellbase is
  'Sellbase commerce kit. Managed by Sellbase migrations: do not alter. Extend via metadata jsonb or your own schema.';

create extension if not exists citext with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- ── Privileges ───────────────────────────────────────────────────────────────
-- API roles may see the schema, but get no table access by default: every table
-- grants explicitly what anon/authenticated need, and RLS decides the rows.
grant usage on schema sellbase to anon, authenticated, service_role;

alter default privileges in schema sellbase grant all on tables to service_role;
alter default privileges in schema sellbase grant all on sequences to service_role;
alter default privileges in schema sellbase grant execute on functions to service_role;
-- Postgres grants EXECUTE to PUBLIC on every new function, and a per-schema default
-- cannot remove it. Each migration must `revoke execute ... from public` per function;
-- the pgTAP guard fails if a function stays executable by anon.

-- ── Helpers ──────────────────────────────────────────────────────────────────
create function sellbase.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function sellbase.set_updated_at() from public;
comment on function sellbase.set_updated_at() is
  'BEFORE UPDATE trigger: keeps updated_at current. Attach to every table with an updated_at column.';

-- ── Schema version ───────────────────────────────────────────────────────────
-- `sellbase upgrade` reads this to compute pending migrations; each migration appends a row.
create table sellbase.schema_version (
  version text primary key,
  sellbase_version text not null,
  applied_at timestamptz not null default now()
);
alter table sellbase.schema_version enable row level security;
-- No policies yet: only service_role (which bypasses RLS) can read it.
-- 0001_init adds a staff read policy once staff_members exists.

insert into sellbase.schema_version (version, sellbase_version) values ('0000', '0.0.0');
