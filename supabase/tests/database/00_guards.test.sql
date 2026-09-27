-- Global guards. They inspect the catalog, so they keep protecting every table and
-- function that future migrations add, without new tests having to remember them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select has_schema('sellbase');

select is_empty(
  $$ select c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'sellbase' and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'every sellbase table has RLS enabled'
);

select is_empty(
  $$ select p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'sellbase'
        and p.prokind in ('f', 'p')
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'
        ) $$,
  'every sellbase function pins its search_path'
);

select is_empty(
  $$ select p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'sellbase'
        and has_function_privilege('anon', p.oid, 'execute')
        -- Allow-list: functions anon must run (e.g. RLS helpers). Add names deliberately.
        and p.proname <> all (array[]::text[]) $$,
  'no sellbase function is executable by anon unless allow-listed'
);

select is_empty(
  $$ select c.table_name || '.' || c.column_name
       from information_schema.columns c
      where c.table_schema = 'sellbase'
        and (c.data_type in ('real', 'double precision', 'money')
             or (c.column_name like '%\_amount' and c.data_type <> 'bigint')) $$,
  'money columns are bigint minor units; no float or money types anywhere'
);

select is_empty(
  $$ select c.table_name
       from information_schema.columns c
      where c.table_schema = 'sellbase' and c.column_name = 'updated_at'
        and not exists (
          select 1 from pg_trigger t
           join pg_class r on r.oid = t.tgrelid
           join pg_namespace n on n.oid = r.relnamespace
           join pg_proc p on p.oid = t.tgfoid
          where n.nspname = 'sellbase' and r.relname = c.table_name
            and p.proname = 'set_updated_at' and not t.tgisinternal
        ) $$,
  'every table with updated_at has the set_updated_at trigger'
);

select is_empty(
  $$ select table_name from information_schema.tables where table_schema = 'public' $$,
  'Sellbase creates nothing in public'
);

select ok(
  (select count(*) = 1 from sellbase.schema_version where version = '0000'),
  'schema_version records 0000'
);

-- set_updated_at behaves
create temp table t_updated (id int primary key, updated_at timestamptz not null);
create trigger t_updated_touch before update on t_updated
  for each row execute function sellbase.set_updated_at();
insert into t_updated values (1, '2000-01-01T00:00:00Z');
update t_updated set id = 1;
select is((select updated_at from t_updated), now(), 'set_updated_at stamps now()');

-- anon cannot read schema_version at all
set local role anon;
select throws_ok('select * from sellbase.schema_version', '42501', null, 'anon cannot read schema_version');
reset role;

-- Signed-in users that are not staff get no rows (RLS), per ADR 0004.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000dead"}', true);
select is_empty('select * from sellbase.schema_version', 'non-staff users see no schema_version rows');
reset role;

select * from finish();
rollback;
