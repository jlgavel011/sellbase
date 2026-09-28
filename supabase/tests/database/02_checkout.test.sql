-- Checkout, order placement and inventory (SPEC §8, §16): reservations, OUT_OF_STOCK,
-- idempotent order creation, expiry, late payments, state machine and stock constraints.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
insert into sellbase.stores (id, name, slug, default_currency, country) values
  ('10000000-0000-4000-8000-00000000000a', 'Store A', 'store-a', 'MXN', 'MX');
insert into sellbase.products (id, store_id, type, title, slug, status) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', 'physical', 'Tee', 'tee', 'active'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-00000000000a', 'digital', 'Ebook', 'ebook', 'active');
insert into sellbase.variants (id, store_id, product_id, sku, price_amount, currency) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-000000000001', 'TEE', 34900, 'MXN'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-000000000002', 'EBOOK', 19900, 'MXN');
insert into sellbase.discounts (id, store_id, code, kind, value) values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', 'HOLA', 'percent', 1000);
insert into sellbase.carts (id, store_id, token, currency) values
  ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', 'cart-token-000000000001', 'MXN'),
  ('70000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-00000000000a', 'cart-token-000000000002', 'MXN'),
  ('70000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000000a', 'cart-token-000000000003', 'MXN');

create temp table t_ctx (key text primary key, id uuid);

create function pg_temp.lines(p_qty int) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('variant_id', '30000000-0000-4000-8000-000000000001', 'product_id', '20000000-0000-4000-8000-000000000001',
      'product_type', 'physical', 'title', 'Tee', 'variant_title', 'Default', 'sku', 'TEE',
      'unit_price_amount', 34900, 'quantity', p_qty, 'discount_amount', 3490 * p_qty,
      'tax_amount', 0, 'total_amount', 31410 * p_qty, 'fulfillment_type', 'shipment'),
    jsonb_build_object('variant_id', '30000000-0000-4000-8000-000000000002', 'product_id', '20000000-0000-4000-8000-000000000002',
      'product_type', 'digital', 'title', 'Ebook', 'sku', 'EBOOK',
      'unit_price_amount', 19900, 'quantity', 1, 'discount_amount', 1990,
      'tax_amount', 0, 'total_amount', 17910, 'fulfillment_type', 'digital'));
$$;
create function pg_temp.totals(p_qty int) returns jsonb language sql as $$
  select jsonb_build_object('currency', 'MXN', 'subtotal_amount', 34900 * p_qty + 19900,
    'discount_amount', 3490 * p_qty + 1990, 'shipping_amount', 0, 'tax_amount', 0,
    'total_amount', 31410 * p_qty + 17910);
$$;
create function pg_temp.stock() returns table (on_hand int, reserved int) language sql as $$
  select on_hand, reserved from sellbase.inventory_levels where variant_id = '30000000-0000-4000-8000-000000000001';
$$;

-- ── Inventory adjustments ────────────────────────────────────────────────────
select lives_ok($$ select sellbase.adjust_inventory('30000000-0000-4000-8000-000000000001', 5, 'initial count', 'staff', 'u1') $$,
  'adjust_inventory creates the stock row and default location');
select results_eq('select * from pg_temp.stock()', $$ values (5, 0) $$, 'stock starts at 5');
select results_eq($$ select count(*)::int from sellbase.audit_log where action = 'inventory.adjust' and store_id = '10000000-0000-4000-8000-00000000000a' $$, array[1],
  'inventory adjustments are audited');
select throws_ok($$ update sellbase.inventory_levels set on_hand = -1 $$, '23514', null,
  'deny policy forbids negative stock');

-- ── Checkout reserves stock ──────────────────────────────────────────────────
insert into t_ctx select 's1', sellbase.create_checkout_session(
  '70000000-0000-4000-8000-000000000001', 'stripe', pg_temp.lines(2), pg_temp.totals(2), 'buyer@test.dev',
  null, null, array['60000000-0000-4000-8000-000000000001']::uuid[]);
select results_eq('select * from pg_temp.stock()', $$ values (5, 2) $$, 'checkout reserves 2 units');
select results_eq($$ select available_quantity from sellbase.storefront_variants where sku = 'TEE' and store_id = '10000000-0000-4000-8000-00000000000a' $$, array[3],
  'storefront availability subtracts reservations');
select throws_like($$ select sellbase.create_checkout_session('70000000-0000-4000-8000-000000000002', 'stripe',
                        pg_temp.lines(4), pg_temp.totals(4), 'other@test.dev') $$,
  'Only 3 left%', 'OUT_OF_STOCK when asking for more than is available');
select results_eq('select * from pg_temp.stock()', $$ values (5, 2) $$, 'a failed checkout reserves nothing');
select throws_like($$ select sellbase.create_checkout_session('70000000-0000-4000-8000-000000000002', 'stripe',
                        pg_temp.lines(1), pg_temp.totals(1), '') $$,
  'An email is required%', 'checkout requires an email');
select throws_like($$ select sellbase.create_checkout_session('70000000-0000-4000-8000-000000000002', 'stripe',
                        '[]', pg_temp.totals(1), 'a@test.dev') $$,
  'The cart is empty%', 'checkout rejects empty carts');
select throws_ok($$ select sellbase.adjust_inventory('30000000-0000-4000-8000-000000000001', -4, 'shrink', 'staff', 'u1') $$,
  'P0001', null, 'stock cannot be adjusted below what open checkouts reserved');

-- ── Paid webhook creates the order ───────────────────────────────────────────
insert into t_ctx select 'o1', sellbase.place_order_from_checkout((select id from t_ctx where key = 's1'),
  '{"provider": "stripe", "provider_payment_id": "pi_1", "method": "card", "amount": 80730, "currency": "MXN"}');

select results_eq($$ select number, status, payment_status, fulfillment_status, total_amount::int, amount_paid::int
                      from sellbase.orders where id = (select id from t_ctx where key = 'o1') $$,
  $$ values (1001, 'open', 'paid', 'unfulfilled', 80730, 80730) $$, 'order #1001 is open and paid');
select results_eq($$ select count(*)::int from sellbase.order_items where order_id = (select id from t_ctx where key = 'o1') $$,
  array[2], 'order items are copied from the snapshot');
select results_eq($$ select sku, unit_price_amount::int, fulfillment_type from sellbase.order_items
                      where order_id = (select id from t_ctx where key = 'o1') order by sku $$,
  $$ values ('EBOOK', 19900, 'digital'), ('TEE', 34900, 'shipment') $$, 'snapshots keep sku, price and fulfillment type');
select results_eq('select * from pg_temp.stock()', $$ values (3, 0) $$, 'the reservation is consumed from stock');
select results_eq($$ select status from sellbase.carts where id = '70000000-0000-4000-8000-000000000001' $$,
  array['converted'], 'the cart is converted');
select results_eq($$ select usage_count from sellbase.discounts where store_id = '10000000-0000-4000-8000-00000000000a' $$, array[1], 'the discount redemption is counted');
select results_eq($$ select array_agg(type order by type) from sellbase.events where store_id = '10000000-0000-4000-8000-00000000000a' $$,
  $$ values (array['checkout.completed', 'order.created', 'order.paid', 'payment.succeeded']) $$,
  'outbox events are emitted in the same transaction');
select results_eq($$ select email::text from sellbase.customers where store_id = '10000000-0000-4000-8000-00000000000a' $$, array['buyer@test.dev'], 'the customer is upserted');

select results_eq($$ select sellbase.place_order_from_checkout((select id from t_ctx where key = 's1'), '{"amount": 80730}') $$,
  $$ select id from t_ctx where key = 'o1' $$, 'placing the same session again returns the same order');
select results_eq($$ select count(*)::int from sellbase.orders where store_id = '10000000-0000-4000-8000-00000000000a' $$, array[1], 'a duplicate webhook creates no second order');

-- ── Price changes after checkout do not affect the order ─────────────────────
update sellbase.variants set price_amount = 99900 where sku = 'TEE';
select results_eq($$ select unit_price_amount::int from sellbase.order_items where sku = 'TEE' and store_id = '10000000-0000-4000-8000-00000000000a' $$, array[34900],
  'order items keep the price paid');

-- ── Expired checkouts release stock ──────────────────────────────────────────
insert into t_ctx select 's2', sellbase.create_checkout_session(
  '70000000-0000-4000-8000-000000000002', 'stripe', pg_temp.lines(3), pg_temp.totals(3), 'late@test.dev',
  null, null, '{}', interval '-1 minute');
select results_eq('select * from pg_temp.stock()', $$ values (3, 3) $$, 'second checkout reserves the last 3');
select sellbase.release_expired_checkouts();
select results_eq($$ select status from sellbase.checkout_sessions where id = (select id from t_ctx where key = 's2') $$,
  array['expired'], 'the expired session is released');
select results_eq('select * from pg_temp.stock()', $$ values (3, 0) $$, 'released stock is available again');

-- ── A late payment still becomes an order, flagging oversold stock ───────────
select sellbase.adjust_inventory('30000000-0000-4000-8000-000000000001', -2, 'damaged', 'staff', 'u1');
update sellbase.checkout_sessions set consents = '[{"text": "Soy mayor de 18", "accepted_at": "2026-01-01T00:00:00Z"}]'
 where id = (select id from t_ctx where key = 's2');
insert into t_ctx select 'o2', sellbase.place_order_from_checkout((select id from t_ctx where key = 's2'),
  '{"provider": "stripe", "provider_payment_id": "pi_2", "amount": 112140}');
select results_eq('select * from pg_temp.stock()', $$ values (0, 0) $$, 'stock stops at zero instead of failing a paid order');
select results_eq($$ select (payload ->> 'short_by')::int from sellbase.events where type = 'inventory.oversold' and store_id = '10000000-0000-4000-8000-00000000000a' $$,
  array[2], 'an inventory.oversold event tells the owner how many units are missing');

select results_eq($$ select metadata #>> '{consents,0,text}' from sellbase.orders where id = (select id from t_ctx where key = 'o2') $$,
  array['Soy mayor de 18'], 'checkout consents are copied into the order');
select ok((select not (metadata ? 'consents') from sellbase.orders where id = (select id from t_ctx where key = 'o1')),
  'orders without consents get no consents key');

-- ── State machine mirror ─────────────────────────────────────────────────────
select throws_like($$ update sellbase.orders set status = 'pending_payment' where id = (select id from t_ctx where key = 'o1') $$,
  'order.status cannot go from "open" to "pending_payment"%', 'invalid order transitions are rejected in SQL');
update sellbase.orders set status = 'completed' where id = (select id from t_ctx where key = 'o1');
select throws_like($$ update sellbase.orders set status = 'open' where id = (select id from t_ctx where key = 'o1') $$,
  '%cannot go from "completed"%', 'final states cannot change');

select * from finish();
rollback;
