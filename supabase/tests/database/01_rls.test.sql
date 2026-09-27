-- RLS per role (SPEC §6, ADR 0004). Positive and negative cases for anon, customers,
-- staff, admins/owners and strangers, across two stores.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner-a@test.dev'),
  ('00000000-0000-4000-8000-0000000000a2', 'staff-a@test.dev'),
  ('00000000-0000-4000-8000-0000000000b1', 'owner-b@test.dev'),
  ('00000000-0000-4000-8000-0000000000c1', 'cust1@test.dev'),
  ('00000000-0000-4000-8000-0000000000c2', 'cust2@test.dev'),
  ('00000000-0000-4000-8000-0000000000ff', 'stranger@test.dev');

insert into sellbase.stores (id, name, slug, default_currency, country) values
  ('10000000-0000-4000-8000-00000000000a', 'Store A', 'store-a', 'MXN', 'MX'),
  ('10000000-0000-4000-8000-00000000000b', 'Store B', 'store-b', 'USD', 'US');

insert into sellbase.staff_members (store_id, user_id, role) values
  ('10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1', 'owner'),
  ('10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a2', 'staff'),
  ('10000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000b1', 'owner');

insert into sellbase.products (id, store_id, type, title, slug, status, metadata) values
  ('20000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000a', 'physical', 'Tee', 'tee', 'active', '{"cost": 90}'),
  ('20000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-00000000000a', 'physical', 'Secret', 'secret', 'draft', '{}'),
  ('20000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-00000000000b', 'digital', 'Ebook', 'ebook', 'active', '{}');

insert into sellbase.variants (id, store_id, product_id, sku, price_amount, currency) values
  ('30000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-0000000000a1', 'TEE-1', 34900, 'MXN'),
  ('30000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-0000000000a2', 'SEC-1', 10000, 'MXN'),
  ('30000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-00000000000b', '20000000-0000-4000-8000-0000000000b1', null, 1500, 'USD');

select sellbase.adjust_inventory('30000000-0000-4000-8000-0000000000a1', 5, 'initial', 'system', null);

insert into sellbase.customers (id, store_id, email, auth_user_id) values
  ('40000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-00000000000a', 'cust1@test.dev', '00000000-0000-4000-8000-0000000000c1'),
  ('40000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-00000000000a', 'cust2@test.dev', '00000000-0000-4000-8000-0000000000c2');

insert into sellbase.orders (id, store_id, number, customer_id, email, currency, subtotal_amount, total_amount, status) values
  ('50000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000a', 1, '40000000-0000-4000-8000-0000000000c1', 'cust1@test.dev', 'MXN', 34900, 34900, 'open'),
  ('50000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-00000000000a', 2, '40000000-0000-4000-8000-0000000000c2', 'cust2@test.dev', 'MXN', 34900, 34900, 'open'),
  ('50000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-00000000000b', 1, null, 'x@test.dev', 'USD', 1500, 1500, 'open');

insert into sellbase.order_items (store_id, order_id, product_type, title, unit_price_amount, quantity, total_amount, fulfillment_type) values
  ('10000000-0000-4000-8000-00000000000a', '50000000-0000-4000-8000-0000000000a1', 'physical', 'Tee', 34900, 1, 34900, 'shipment'),
  ('10000000-0000-4000-8000-00000000000a', '50000000-0000-4000-8000-0000000000a2', 'physical', 'Tee', 34900, 1, 34900, 'shipment');

insert into sellbase.integrations (store_id, provider, kind) values
  ('10000000-0000-4000-8000-00000000000a', 'stripe', 'payments'),
  ('10000000-0000-4000-8000-00000000000b', 'stripe', 'payments');
insert into sellbase.api_tokens (store_id, name, token_hash, prefix, scopes) values
  ('10000000-0000-4000-8000-00000000000a', 'agent', 'hash-a', 'sb_live_ab', array['catalog:read']);

-- ── anon ─────────────────────────────────────────────────────────────────────
set local role anon;

select results_eq('select slug from sellbase.storefront_products order by slug',
  array['ebook', 'tee'], 'anon sees active products through the storefront view');
select is_empty($$ select 1 from sellbase.storefront_products where slug = 'secret' $$,
  'anon does not see draft products');
select results_eq(
  $$ select available_quantity, available from sellbase.storefront_variants where sku = 'TEE-1' $$,
  $$ values (5, true) $$, 'anon sees stock availability');
select results_eq(
  $$ select available_quantity, available from sellbase.storefront_variants where price_amount = 1500 $$,
  $$ values (null::int, true) $$, 'untracked variants are always available');
select throws_ok('select metadata from sellbase.products', '42501', null, 'anon cannot read product metadata');
select throws_ok('select * from sellbase.orders', '42501', null, 'anon cannot read orders');
select throws_ok('select * from sellbase.customers', '42501', null, 'anon cannot read customers');
select throws_ok('select * from sellbase.integrations', '42501', null, 'anon cannot read integrations');
select throws_ok($$ insert into sellbase.products (store_id, type, title, slug)
                    values ('10000000-0000-4000-8000-00000000000a', 'physical', 'X', 'x') $$,
  '42501', null, 'anon cannot write products');
select throws_ok($$ select sellbase.place_order_from_checkout(gen_random_uuid(), '{}') $$,
  '42501', null, 'anon cannot place orders');
reset role;

-- ── customer 1 ───────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000c1"}', true);

select results_eq('select number from sellbase.orders', array[1], 'customer sees only their own order');
select results_eq('select count(*)::int from sellbase.order_items', array[1], 'customer sees only their own order items');
select results_eq('select email::text from sellbase.customers', array['cust1@test.dev'], 'customer sees only themselves');
select is_empty('select 1 from sellbase.integrations', 'customer sees no integrations');
select is_empty('select 1 from sellbase.api_tokens', 'customer sees no api tokens');
select is_empty($$ select 1 from sellbase.products where status = 'draft' $$, 'customer does not see drafts');
select throws_ok($$ update sellbase.orders set notes = 'x' $$, '42501', null, 'customer cannot update orders');
select throws_ok($$ select sellbase.adjust_inventory('30000000-0000-4000-8000-0000000000a1', 1, 'x', 'staff', null) $$,
  '42501', null, 'customer cannot adjust inventory');

-- ── staff of store A ─────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a2"}', true);

select results_eq('select number from sellbase.orders order by number', array[1, 2],
  'staff sees every order of their store and none of other stores');
select results_eq($$ select count(*)::int from sellbase.products where status = 'draft' $$, array[1],
  'staff sees drafts of their store');
select is_empty($$ select 1 from sellbase.products where store_id = '10000000-0000-4000-8000-00000000000b' and status <> 'active' $$,
  'staff sees no private rows of other stores');
select is_empty('select 1 from sellbase.integrations', 'staff role cannot read integrations');
select is_empty('select 1 from sellbase.api_tokens', 'staff role cannot read api tokens');
select is_empty('select 1 from sellbase.audit_log', 'staff role cannot read the audit log');
select results_eq('select count(*)::int from sellbase.schema_version', array[2], 'staff can read the schema version');
select throws_ok($$ insert into sellbase.products (store_id, type, title, slug)
                    values ('10000000-0000-4000-8000-00000000000a', 'physical', 'X', 'x') $$,
  '42501', null, 'staff writes go through the API, not directly');
select throws_ok($$ update sellbase.orders set notes = 'x' $$, '42501', null, 'staff cannot update orders directly');

-- ── owner of store A ─────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a1"}', true);

select results_eq('select count(*)::int from sellbase.integrations', array[1], 'owner reads integrations of their store only');
select results_eq('select count(*)::int from sellbase.api_tokens', array[1], 'owner reads api tokens');
select results_eq('select count(*)::int from sellbase.audit_log', array[1], 'owner reads the audit log');

-- ── owner of store B ─────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000b1"}', true);

select results_eq('select number from sellbase.orders', array[1], 'another store owner sees only their orders');
select is_empty('select 1 from sellbase.customers', 'another store owner sees no customers of store A');

-- ── signed-in stranger ───────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000ff"}', true);

select is_empty('select 1 from sellbase.orders', 'a stranger sees no orders');
select results_eq('select count(*)::int from sellbase.storefront_products', array[2], 'a stranger still sees the public catalog');
reset role;

select * from finish();
rollback;
