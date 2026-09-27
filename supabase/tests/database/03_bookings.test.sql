-- Bookings (SPEC §5.4, §16): no double booking, seats for capacity, holds that expire,
-- confirmation on payment and late-payment conflicts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into sellbase.stores (id, name, slug, default_currency, country) values
  ('10000000-0000-4000-8000-0000000000aa', 'Spa', 'spa-test', 'MXN', 'MX');
insert into sellbase.products (id, store_id, type, title, slug, status) values
  ('20000000-0000-4000-8000-0000000000aa', '10000000-0000-4000-8000-0000000000aa', 'service', 'Masaje', 'masaje', 'active'),
  ('20000000-0000-4000-8000-0000000000bb', '10000000-0000-4000-8000-0000000000aa', 'service', 'Yoga', 'yoga', 'active');
insert into sellbase.variants (id, store_id, product_id, price_amount, currency) values
  ('30000000-0000-4000-8000-0000000000aa', '10000000-0000-4000-8000-0000000000aa', '20000000-0000-4000-8000-0000000000aa', 80000, 'MXN'),
  ('30000000-0000-4000-8000-0000000000bb', '10000000-0000-4000-8000-0000000000aa', '20000000-0000-4000-8000-0000000000bb', 20000, 'MXN');
insert into sellbase.service_specs (variant_id, store_id, duration_min, capacity) values
  ('30000000-0000-4000-8000-0000000000aa', '10000000-0000-4000-8000-0000000000aa', 60, 1),
  ('30000000-0000-4000-8000-0000000000bb', '10000000-0000-4000-8000-0000000000aa', 60, 2);
insert into sellbase.resources (id, store_id, name, timezone) values
  ('40000000-0000-4000-8000-0000000000aa', '10000000-0000-4000-8000-0000000000aa', 'Ana', 'America/Mexico_City'),
  ('40000000-0000-4000-8000-0000000000bb', '10000000-0000-4000-8000-0000000000aa', 'Sala', 'America/Mexico_City');
insert into sellbase.carts (id, store_id, token, currency) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000aa', 'cart-booking-00000000001', 'MXN'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-0000000000aa', 'cart-booking-00000000002', 'MXN'),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-0000000000aa', 'cart-booking-00000000003', 'MXN'),
  ('50000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-0000000000aa', 'cart-booking-00000000004', 'MXN');

create temp table t_ctx (key text primary key, id uuid);

create function pg_temp.line(p_variant uuid, p_product uuid, p_resource uuid, p_start text, p_min int default 60, p_buffer int default 0)
returns jsonb language sql as $$
  select jsonb_build_object('variant_id', p_variant, 'product_id', p_product, 'product_type', 'service',
    'title', 'Servicio', 'unit_price_amount', 80000, 'quantity', 1, 'discount_amount', 0, 'tax_amount', 0,
    'total_amount', 80000, 'fulfillment_type', 'booking',
    'booking', jsonb_build_object('resource_id', p_resource, 'starts_at', p_start,
      'ends_at', (p_start::timestamptz + make_interval(mins => p_min)),
      'occupied_start', (p_start::timestamptz - make_interval(mins => p_buffer)),
      'occupied_end', (p_start::timestamptz + make_interval(mins => p_min + p_buffer))));
$$;
create function pg_temp.totals() returns jsonb language sql as $$
  select '{"currency": "MXN", "subtotal_amount": 80000, "total_amount": 80000}'::jsonb;
$$;
create function pg_temp.massage(p_start text, p_buffer int default 0) returns jsonb language sql as $$
  select pg_temp.line('30000000-0000-4000-8000-0000000000aa', '20000000-0000-4000-8000-0000000000aa',
                      '40000000-0000-4000-8000-0000000000aa', p_start, 60, p_buffer);
$$;

-- ── Holds ────────────────────────────────────────────────────────────────────
insert into t_ctx select 's1', sellbase.create_checkout_session('50000000-0000-4000-8000-000000000001', 'stripe',
  jsonb_build_array(pg_temp.massage('2026-10-05T15:00:00Z')), pg_temp.totals(), 'a@test.dev');
select results_eq($$ select status, seat from sellbase.bookings where checkout_session_id = (select id from t_ctx where key = 's1') $$,
  $$ values ('held', 1) $$, 'checkout holds the slot');

select throws_like($$ select sellbase.create_checkout_session('50000000-0000-4000-8000-000000000002', 'stripe',
  jsonb_build_array(pg_temp.massage('2026-10-05T15:30:00Z')), pg_temp.totals(), 'b@test.dev') $$,
  '%no longer available%', 'an overlapping checkout gets SLOT_UNAVAILABLE');
select is_empty($$ select 1 from sellbase.checkout_sessions where cart_id = '50000000-0000-4000-8000-000000000002' $$,
  'a failed checkout keeps nothing (no session)');

select lives_ok($$ select sellbase.create_checkout_session('50000000-0000-4000-8000-000000000002', 'stripe',
  jsonb_build_array(pg_temp.massage('2026-10-05T16:00:00Z')), pg_temp.totals(), 'b@test.dev') $$,
  'back-to-back slots do not overlap');

select throws_like($$ select sellbase.create_checkout_session('50000000-0000-4000-8000-000000000003', 'stripe',
  jsonb_build_array(pg_temp.massage('2026-10-05T17:00:00Z', 15)), pg_temp.totals(), 'c@test.dev') $$,
  '%no longer available%', 'buffers make adjacent slots conflict');

-- ── The constraint itself ────────────────────────────────────────────────────
select throws_ok($$ insert into sellbase.bookings (store_id, resource_id, seat, status, starts_at, ends_at, occupied)
  values ('10000000-0000-4000-8000-0000000000aa', '40000000-0000-4000-8000-0000000000aa', 1, 'confirmed',
          '2026-10-05T15:15:00Z', '2026-10-05T15:45:00Z', tstzrange('2026-10-05T15:15:00Z', '2026-10-05T15:45:00Z')) $$,
  '23P01', null, 'the exclusion constraint forbids double booking directly in SQL');
select lives_ok($$ insert into sellbase.bookings (store_id, resource_id, seat, status, starts_at, ends_at, occupied)
  values ('10000000-0000-4000-8000-0000000000aa', '40000000-0000-4000-8000-0000000000bb', 1, 'confirmed',
          '2026-10-05T15:15:00Z', '2026-10-05T15:45:00Z', tstzrange('2026-10-05T15:15:00Z', '2026-10-05T15:45:00Z')) $$,
  'another resource can take the same time');
select lives_ok($$ insert into sellbase.bookings (store_id, resource_id, seat, status, starts_at, ends_at, occupied)
  values ('10000000-0000-4000-8000-0000000000aa', '40000000-0000-4000-8000-0000000000aa', 1, 'cancelled',
          '2026-10-05T15:15:00Z', '2026-10-05T15:45:00Z', tstzrange('2026-10-05T15:15:00Z', '2026-10-05T15:45:00Z')) $$,
  'cancelled bookings do not block');

-- ── Capacity: seats ──────────────────────────────────────────────────────────
create function pg_temp.yoga() returns jsonb language sql as $$
  select pg_temp.line('30000000-0000-4000-8000-0000000000bb', '20000000-0000-4000-8000-0000000000bb',
                      '40000000-0000-4000-8000-0000000000bb', '2026-10-06T15:00:00Z');
$$;
select lives_ok($$ select sellbase.hold_booking('10000000-0000-4000-8000-0000000000aa', null, pg_temp.yoga(), now() + interval '10 minutes') $$, 'first yoga seat');
select lives_ok($$ select sellbase.hold_booking('10000000-0000-4000-8000-0000000000aa', null, pg_temp.yoga(), now() + interval '10 minutes') $$, 'second yoga seat');
select results_eq($$ select array_agg(seat order by seat) from sellbase.bookings where variant_id = '30000000-0000-4000-8000-0000000000bb' $$,
  $$ values (array[1, 2]) $$, 'capacity 2 fills seats 1 and 2');
select throws_like($$ select sellbase.hold_booking('10000000-0000-4000-8000-0000000000aa', null, pg_temp.yoga(), now() + interval '10 minutes') $$,
  '%no longer available%', 'a full class refuses more');

-- ── Expired holds free the slot ──────────────────────────────────────────────
update sellbase.bookings set expires_at = now() - interval '1 minute' where variant_id = '30000000-0000-4000-8000-0000000000bb' and seat = 2;
select lives_ok($$ select sellbase.hold_booking('10000000-0000-4000-8000-0000000000aa', null, pg_temp.yoga(), now() + interval '10 minutes') $$,
  'a stale hold no longer blocks');

select sellbase.release_checkout_session((select id from t_ctx where key = 's1'));
select results_eq($$ select status from sellbase.bookings where checkout_session_id = (select id from t_ctx where key = 's1') $$,
  array['expired'], 'releasing a checkout expires its holds');

-- ── Payment confirms the booking ─────────────────────────────────────────────
insert into t_ctx select 's3', sellbase.create_checkout_session('50000000-0000-4000-8000-000000000003', 'stripe',
  jsonb_build_array(pg_temp.massage('2026-10-07T15:00:00Z')), pg_temp.totals(), 'c@test.dev');
insert into t_ctx select 'o3', sellbase.place_order_from_checkout((select id from t_ctx where key = 's3'), '{"amount": 80000}');
select results_eq($$ select b.status, b.order_id = (select id from t_ctx where key = 'o3'), b.order_item_id is not null, b.fulfillment_id is not null, b.email::text
                      from sellbase.bookings b where checkout_session_id = (select id from t_ctx where key = 's3') $$,
  $$ values ('confirmed', true, true, true, 'c@test.dev') $$, 'payment confirms the booking and links it to the order');
select results_eq($$ select type from sellbase.fulfillments where order_id = (select id from t_ctx where key = 'o3') $$,
  array['booking'], 'the order gets a booking fulfillment');
select results_eq($$ select count(*)::int from sellbase.events where type = 'booking.confirmed' and store_id = '10000000-0000-4000-8000-0000000000aa' $$,
  array[1], 'booking.confirmed is emitted');

-- ── Late payment: slot still free → confirmed; taken → conflict ──────────────
insert into t_ctx select 's4', sellbase.create_checkout_session('50000000-0000-4000-8000-000000000004', 'stripe',
  jsonb_build_array(pg_temp.massage('2026-10-08T15:00:00Z'), pg_temp.massage('2026-10-08T17:00:00Z')), pg_temp.totals(), 'd@test.dev');
select sellbase.release_checkout_session((select id from t_ctx where key = 's4'));
insert into sellbase.bookings (store_id, resource_id, seat, status, starts_at, ends_at, occupied)
values ('10000000-0000-4000-8000-0000000000aa', '40000000-0000-4000-8000-0000000000aa', 1, 'confirmed',
        '2026-10-08T17:00:00Z', '2026-10-08T18:00:00Z', tstzrange('2026-10-08T17:00:00Z', '2026-10-08T18:00:00Z'));
insert into t_ctx select 'o4', sellbase.place_order_from_checkout((select id from t_ctx where key = 's4'), '{"amount": 160000}');
select results_eq($$ select array_agg(status order by starts_at) from sellbase.bookings where checkout_session_id = (select id from t_ctx where key = 's4') $$,
  $$ values (array['confirmed', 'cancelled']) $$, 'late payment re-takes a free slot and flags a taken one');
select results_eq($$ select count(*)::int from sellbase.order_events where order_id = (select id from t_ctx where key = 'o4') and type = 'booking.conflict' $$,
  array[1], 'the owner sees the conflict on the order timeline');

-- ── RLS ──────────────────────────────────────────────────────────────────────
set local role anon;
select throws_ok('select * from sellbase.bookings', '42501', null, 'anon cannot read bookings');
reset role;

select * from finish();
rollback;
