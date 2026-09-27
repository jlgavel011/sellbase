-- Sellbase 0004_services
-- Services and bookings (SPEC §5.2, §5.5): resources with weekly hours and exceptions,
-- service specs per variant, and bookings. Holds and confirmed bookings share one table so
-- a single exclusion constraint makes double booking impossible (ADR 0008).

-- ═════════════════════════════════════════════════════════════════════════════
-- Tables
-- ═════════════════════════════════════════════════════════════════════════════

create table sellbase.service_specs (
  variant_id uuid primary key references sellbase.variants on delete cascade,
  store_id uuid not null references sellbase.stores on delete cascade,
  duration_min int not null check (duration_min > 0),
  buffer_before_min int not null default 0 check (buffer_before_min >= 0),
  buffer_after_min int not null default 0 check (buffer_after_min >= 0),
  capacity int not null default 1 check (capacity between 1 and 500),
  deposit_amount bigint check (deposit_amount > 0),
  location_type text not null default 'in_person' check (location_type in ('in_person', 'online')),
  online_meeting_url text,
  booking_window_days int not null default 60 check (booking_window_days between 1 and 730),
  min_notice_min int not null default 60 check (min_notice_min >= 0),
  slot_interval_min int check (slot_interval_min between 5 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sellbase.resources (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  name text not null check (length(name) between 1 and 120),
  kind text not null default 'staff' check (kind in ('staff', 'room', 'equipment')),
  timezone text not null,
  email extensions.citext,
  active boolean not null default true,
  calendar_sync jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on sellbase.resources (store_id);

create table sellbase.service_resources (
  product_id uuid not null references sellbase.products on delete cascade,
  resource_id uuid not null references sellbase.resources on delete cascade,
  store_id uuid not null references sellbase.stores on delete cascade,
  primary key (product_id, resource_id)
);
create index on sellbase.service_resources (resource_id);

create table sellbase.availability_rules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  resource_id uuid not null references sellbase.resources on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  timezone text,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index on sellbase.availability_rules (resource_id);

create table sellbase.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  resource_id uuid not null references sellbase.resources on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null default 'closed' check (kind in ('closed', 'open')),
  note text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index on sellbase.availability_exceptions (resource_id, starts_at);

-- held → confirmed → completed | no_show | cancelled | rescheduled; held → expired.
-- `occupied` includes buffers. Each overlapping booking takes a seat (1..capacity); the
-- exclusion constraint forbids two active bookings on the same resource, seat and time.
create table sellbase.bookings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  product_id uuid references sellbase.products on delete set null,
  variant_id uuid references sellbase.variants on delete set null,
  resource_id uuid not null references sellbase.resources on delete restrict,
  seat int not null default 1 check (seat >= 1),
  status text not null default 'held'
    check (status in ('held', 'confirmed', 'completed', 'no_show', 'cancelled', 'rescheduled', 'expired')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  occupied tstzrange not null,
  expires_at timestamptz,
  checkout_session_id uuid references sellbase.checkout_sessions on delete set null,
  order_id uuid references sellbase.orders on delete cascade,
  order_item_id uuid references sellbase.order_items on delete set null,
  fulfillment_id uuid references sellbase.fulfillments on delete set null,
  customer_id uuid references sellbase.customers on delete set null,
  email extensions.citext,
  meeting_url text,
  rescheduled_from uuid references sellbase.bookings on delete set null,
  calendar_event_ids jsonb not null default '{}',
  reminder_24h_sent_at timestamptz,
  reminder_2h_sent_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (status <> 'held' or expires_at is not null),
  constraint bookings_no_double_booking exclude using gist (
    resource_id with =, seat with =, occupied with &&
  ) where (status in ('held', 'confirmed'))
);
create index on sellbase.bookings (store_id, starts_at);
create index on sellbase.bookings (order_id);
create index on sellbase.bookings (checkout_session_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- RLS, grants, triggers (guards verify every table)
-- ═════════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array['service_specs', 'resources', 'service_resources', 'availability_rules',
                           'availability_exceptions', 'bookings'] loop
    execute format('alter table sellbase.%I enable row level security', t);
    execute format('grant select on sellbase.%I to authenticated', t);
    execute format('create policy staff_read on sellbase.%I for select to authenticated using (sellbase.is_staff(store_id))', t);
  end loop;
  foreach t in array array['service_specs', 'resources', 'bookings'] loop
    execute format('create trigger set_updated_at before update on sellbase.%I for each row execute function sellbase.set_updated_at()', t);
  end loop;
end;
$$;

create policy customer_read_own on sellbase.bookings for select to authenticated
  using (sellbase.is_customer(customer_id));

-- ═════════════════════════════════════════════════════════════════════════════
-- Holds and confirmation
-- ═════════════════════════════════════════════════════════════════════════════

/*
 * Holds one booking slot for a checkout. p_line.booking: { resource_id, starts_at, ends_at,
 * occupied_start, occupied_end }. Takes the lowest free seat; raises SLOT_UNAVAILABLE when
 * every seat overlaps an active booking.
 */
create function sellbase.hold_booking(p_store_id uuid, p_session_id uuid, p_line jsonb, p_expires timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking jsonb := p_line -> 'booking';
  v_resource uuid := (v_booking ->> 'resource_id')::uuid;
  v_capacity int;
  v_id uuid;
begin
  select coalesce(capacity, 1) into v_capacity from sellbase.service_specs
   where variant_id = (p_line ->> 'variant_id')::uuid;
  v_capacity := coalesce(v_capacity, 1);

  -- Stale holds must not block anyone.
  update sellbase.bookings set status = 'expired'
   where resource_id = v_resource and status = 'held' and expires_at < now();

  for s in 1..v_capacity loop
    begin
      insert into sellbase.bookings
        (store_id, product_id, variant_id, resource_id, seat, status, starts_at, ends_at, occupied,
         expires_at, checkout_session_id)
      values
        (p_store_id, (p_line ->> 'product_id')::uuid, (p_line ->> 'variant_id')::uuid, v_resource, s, 'held',
         (v_booking ->> 'starts_at')::timestamptz, (v_booking ->> 'ends_at')::timestamptz,
         tstzrange((v_booking ->> 'occupied_start')::timestamptz, (v_booking ->> 'occupied_end')::timestamptz),
         p_expires, p_session_id)
      returning id into v_id;
      return v_id;
    exception when exclusion_violation then
      -- seat taken; try the next one
    end;
  end loop;

  perform sellbase.raise_error('SLOT_UNAVAILABLE',
    format('The %s slot is no longer available.', v_booking ->> 'starts_at'),
    'Pick another time from GET /storefront/availability and update the cart item.',
    jsonb_build_object('resource_id', v_resource, 'starts_at', v_booking ->> 'starts_at'));
  return null;
end;
$$;

/*
 * Turns a paid session's holds into confirmed bookings linked to the order. A hold that
 * expired before payment is re-taken if the slot is still free; otherwise the booking is
 * cancelled and a booking.conflict event tells the owner to reschedule or refund.
 */
create function sellbase.confirm_session_bookings(p_session_id uuid, p_order_id uuid, p_customer_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_item uuid;
  v_fulfillment uuid;
  v_capacity int;
  v_confirmed boolean;
  v_store uuid;
begin
  for r in
    select b.* from sellbase.bookings b
     where b.checkout_session_id = p_session_id and b.status in ('held', 'expired')
     order by b.starts_at
  loop
    v_store := r.store_id;
    select oi.id into v_item from sellbase.order_items oi
     where oi.order_id = p_order_id and oi.variant_id = r.variant_id
       and (oi.metadata -> 'booking' ->> 'starts_at')::timestamptz = r.starts_at
     limit 1;

    if v_fulfillment is null then
      insert into sellbase.fulfillments (store_id, order_id, type, status, items)
      values (r.store_id, p_order_id, 'booking', 'pending', '[]') returning id into v_fulfillment;
    end if;

    v_confirmed := false;
    if r.status = 'held' then
      update sellbase.bookings
         set status = 'confirmed', expires_at = null, order_id = p_order_id, order_item_id = v_item,
             customer_id = p_customer_id, email = p_email, fulfillment_id = v_fulfillment
       where id = r.id;
      v_confirmed := true;
    else
      select coalesce(capacity, 1) into v_capacity from sellbase.service_specs where variant_id = r.variant_id;
      for s in 1..coalesce(v_capacity, 1) loop
        begin
          update sellbase.bookings
             set status = 'confirmed', seat = s, expires_at = null, order_id = p_order_id, order_item_id = v_item,
                 customer_id = p_customer_id, email = p_email, fulfillment_id = v_fulfillment
           where id = r.id;
          v_confirmed := true;
          exit;
        exception when exclusion_violation then
          -- seat taken meanwhile
        end;
      end loop;
    end if;

    if v_confirmed then
      perform sellbase.emit_event(r.store_id, 'booking.confirmed', 'booking', r.id,
        jsonb_build_object('order_id', p_order_id));
    else
      update sellbase.bookings
         set status = 'cancelled', order_id = p_order_id, order_item_id = v_item, customer_id = p_customer_id,
             email = p_email, fulfillment_id = v_fulfillment,
             notes = 'Slot was taken before the payment arrived.'
       where id = r.id;
      perform sellbase.emit_event(r.store_id, 'booking.conflict', 'booking', r.id,
        jsonb_build_object('order_id', p_order_id));
      insert into sellbase.order_events (store_id, order_id, type, message, data)
      values (r.store_id, p_order_id, 'booking.conflict',
              format('The %s slot was taken before payment arrived: reschedule or refund.', r.starts_at),
              jsonb_build_object('booking_id', r.id, 'starts_at', r.starts_at));
    end if;
  end loop;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Checkout functions, now aware of booking holds
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function sellbase.create_checkout_session(
  p_cart_id uuid,
  p_provider text,
  p_lines jsonb,
  p_totals jsonb,
  p_email text,
  p_shipping_address jsonb default null,
  p_shipping_selection jsonb default null,
  p_discount_ids uuid[] default '{}',
  p_ttl interval default interval '15 minutes'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart sellbase.carts;
  v_session_id uuid;
  v_expires timestamptz := now() + p_ttl;
  v_need record;
  v_line jsonb;
  v_level sellbase.inventory_levels;
begin
  select * into v_cart from sellbase.carts where id = p_cart_id for update;
  if not found or v_cart.status <> 'open' then
    perform sellbase.raise_error('NOT_FOUND', 'Cart not found or no longer open.',
      'Create a new cart with POST /storefront/carts and add the items again.',
      jsonb_build_object('cart_id', p_cart_id));
  end if;
  if coalesce(p_email, '') = '' then
    perform sellbase.raise_error('VALIDATION_ERROR', 'An email is required to check out.',
      'Ask the customer for an email address and send it with the checkout request.', '{}');
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then
    perform sellbase.raise_error('VALIDATION_ERROR', 'The cart is empty.',
      'Add at least one item before starting checkout.', '{}');
  end if;

  insert into sellbase.checkout_sessions
    (store_id, cart_id, provider, amount_total, currency, email, shipping_address,
     shipping_selection, lines_snapshot, totals_snapshot, discount_ids, expires_at)
  values
    (v_cart.store_id, v_cart.id, p_provider, (p_totals ->> 'total_amount')::bigint,
     coalesce(p_totals ->> 'currency', v_cart.currency), p_email, p_shipping_address,
     p_shipping_selection, p_lines, p_totals, p_discount_ids, v_expires)
  returning id into v_session_id;

  -- Lock inventory rows in a stable order (by variant) to avoid deadlocks.
  for v_need in
    select (l ->> 'variant_id')::uuid as variant_id, sum((l ->> 'quantity')::int) as quantity
      from jsonb_array_elements(p_lines) l
     where l ->> 'variant_id' is not null
     group by 1 order by 1
  loop
    select il.* into v_level
      from sellbase.inventory_levels il
      join sellbase.locations loc on loc.id = il.location_id
     where il.variant_id = v_need.variant_id
     order by loc.is_default desc, il.on_hand - il.reserved desc
     limit 1
     for update of il;
    continue when not found; -- untracked variant

    if v_level.policy = 'deny' and v_level.on_hand - v_level.reserved < v_need.quantity then
      perform sellbase.raise_error('OUT_OF_STOCK',
        format('Only %s left of variant %s; requested %s.',
               greatest(v_level.on_hand - v_level.reserved, 0), v_need.variant_id, v_need.quantity),
        'Lower the quantity or remove the item from the cart, then retry checkout.',
        jsonb_build_object('variant_id', v_need.variant_id,
                           'available', greatest(v_level.on_hand - v_level.reserved, 0),
                           'requested', v_need.quantity));
    end if;

    update sellbase.inventory_levels set reserved = reserved + v_need.quantity where id = v_level.id;
    insert into sellbase.inventory_reservations
      (store_id, checkout_session_id, inventory_level_id, variant_id, quantity, expires_at)
    values (v_cart.store_id, v_session_id, v_level.id, v_need.variant_id, v_need.quantity, v_expires);
  end loop;

  -- Hold booking slots (services). A taken slot raises SLOT_UNAVAILABLE and nothing is kept.
  for v_line in select value from jsonb_array_elements(p_lines) where value ? 'booking' loop
    perform sellbase.hold_booking(v_cart.store_id, v_session_id, v_line, v_expires);
  end loop;

  return v_session_id;
end;
$$;

create or replace function sellbase.release_checkout_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  update sellbase.checkout_sessions set status = 'expired'
   where id = p_session_id and status = 'open';
  update sellbase.bookings set status = 'expired'
   where checkout_session_id = p_session_id and status = 'held';
  for r in
    select id, inventory_level_id, quantity from sellbase.inventory_reservations
     where checkout_session_id = p_session_id and released_at is null and consumed_at is null
     order by variant_id
     for update
  loop
    update sellbase.inventory_levels set reserved = greatest(reserved - r.quantity, 0)
     where id = r.inventory_level_id;
    update sellbase.inventory_reservations set released_at = now() where id = r.id;
  end loop;
end;
$$;

create or replace function sellbase.place_order_from_checkout(p_session_id uuid, p_payment jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session sellbase.checkout_sessions;
  v_store_id uuid;
  v_order_id uuid;
  v_customer_id uuid;
  v_paid bigint := coalesce((p_payment ->> 'amount')::bigint, 0);
  v_total bigint;
  v_line jsonb;
  r record;
  v_level sellbase.inventory_levels;
  v_short int;
begin
  select * into v_session from sellbase.checkout_sessions where id = p_session_id for update;
  if not found then
    perform sellbase.raise_error('NOT_FOUND', 'Checkout session not found.',
      'Check the session id in the provider metadata.', jsonb_build_object('checkout_session_id', p_session_id));
  end if;
  if v_session.order_id is not null then
    return v_session.order_id;
  end if;

  v_store_id := v_session.store_id;
  v_total := v_session.amount_total;

  insert into sellbase.customers (store_id, email)
  values (v_store_id, v_session.email)
  on conflict (store_id, email) do update set updated_at = now()
  returning id into v_customer_id;

  insert into sellbase.orders
    (store_id, number, channel, checkout_session_id, customer_id, email, currency,
     subtotal_amount, discount_amount, shipping_amount, tax_amount, total_amount, amount_paid,
     status, payment_status, shipping_address)
  values
    (v_store_id, sellbase.next_order_number(v_store_id), 'web', v_session.id, v_customer_id,
     v_session.email, v_session.currency,
     (v_session.totals_snapshot ->> 'subtotal_amount')::bigint,
     coalesce((v_session.totals_snapshot ->> 'discount_amount')::bigint, 0),
     coalesce((v_session.totals_snapshot ->> 'shipping_amount')::bigint, 0),
     coalesce((v_session.totals_snapshot ->> 'tax_amount')::bigint, 0),
     v_total, v_paid, 'open', sellbase.derive_payment_status(v_total, v_paid, 0),
     v_session.shipping_address)
  returning id into v_order_id;

  for v_line in select * from jsonb_array_elements(v_session.lines_snapshot) loop
    insert into sellbase.order_items
      (store_id, order_id, variant_id, product_id, product_type, title, variant_title, sku,
       unit_price_amount, quantity, discount_amount, tax_amount, total_amount, fulfillment_type, metadata)
    values
      (v_store_id, v_order_id, (v_line ->> 'variant_id')::uuid, (v_line ->> 'product_id')::uuid,
       v_line ->> 'product_type', v_line ->> 'title', v_line ->> 'variant_title', v_line ->> 'sku',
       (v_line ->> 'unit_price_amount')::bigint, (v_line ->> 'quantity')::int,
       coalesce((v_line ->> 'discount_amount')::bigint, 0), coalesce((v_line ->> 'tax_amount')::bigint, 0),
       (v_line ->> 'total_amount')::bigint, v_line ->> 'fulfillment_type',
       case when v_line ? 'booking' then jsonb_build_object('booking', v_line -> 'booking') else '{}'::jsonb end);
  end loop;

  insert into sellbase.payments
    (store_id, order_id, provider, provider_payment_id, method, kind, amount, currency, status, raw)
  values
    (v_store_id, v_order_id, coalesce(p_payment ->> 'provider', v_session.provider),
     p_payment ->> 'provider_payment_id', coalesce(p_payment ->> 'method', 'card'), 'charge',
     v_paid, coalesce(p_payment ->> 'currency', v_session.currency), 'succeeded',
     coalesce(p_payment -> 'raw', '{}'));

  -- Consume live reservations: stock leaves on_hand and reserved together.
  for r in
    select id, inventory_level_id, quantity from sellbase.inventory_reservations
     where checkout_session_id = v_session.id and released_at is null and consumed_at is null
     order by variant_id
     for update
  loop
    update sellbase.inventory_levels
       set on_hand = on_hand - r.quantity, reserved = reserved - r.quantity
     where id = r.inventory_level_id;
    update sellbase.inventory_reservations set consumed_at = now() where id = r.id;
  end loop;

  -- Reservations that expired before payment: take stock directly, never below zero on `deny`.
  for r in
    select distinct on (res.variant_id) res.variant_id, res.inventory_level_id,
           (select sum(x.quantity) from sellbase.inventory_reservations x
             where x.checkout_session_id = v_session.id and x.variant_id = res.variant_id
               and x.released_at is not null)::int as quantity
      from sellbase.inventory_reservations res
     where res.checkout_session_id = v_session.id and res.released_at is not null
     order by res.variant_id
  loop
    select * into v_level from sellbase.inventory_levels where id = r.inventory_level_id for update;
    v_short := case when v_level.policy = 'deny'
                    then greatest(r.quantity - (v_level.on_hand - v_level.reserved), 0) else 0 end;
    update sellbase.inventory_levels set on_hand = on_hand - (r.quantity - v_short)
     where id = v_level.id;
    if v_short > 0 then
      perform sellbase.emit_event(v_store_id, 'inventory.oversold', 'variant', r.variant_id,
        jsonb_build_object('order_id', v_order_id, 'short_by', v_short));
      insert into sellbase.order_events (store_id, order_id, type, message, data)
      values (v_store_id, v_order_id, 'inventory.oversold',
              format('Stock ran out before payment confirmed: short by %s.', v_short),
              jsonb_build_object('variant_id', r.variant_id, 'short_by', v_short));
    end if;
  end loop;

  perform sellbase.confirm_session_bookings(v_session.id, v_order_id, v_customer_id, v_session.email);

  if cardinality(v_session.discount_ids) > 0 then
    insert into sellbase.discount_redemptions (store_id, discount_id, order_id, customer_id)
    select v_store_id, d, v_order_id, v_customer_id from unnest(v_session.discount_ids) d;
    update sellbase.discounts set usage_count = usage_count + 1 where id = any (v_session.discount_ids);
  end if;

  update sellbase.carts set status = 'converted', customer_id = coalesce(customer_id, v_customer_id)
   where id = v_session.cart_id;
  update sellbase.checkout_sessions
     set status = 'completed', completed_at = now(), order_id = v_order_id
   where id = v_session.id;

  insert into sellbase.order_events (store_id, order_id, type, message, actor_type, data)
  values (v_store_id, v_order_id, 'order.created', 'Order placed and paid.', 'webhook',
          jsonb_build_object('provider', v_session.provider, 'amount', v_paid));
  insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id)
  values (v_store_id, 'webhook', v_session.provider, 'order.create', 'order', v_order_id);

  perform sellbase.emit_event(v_store_id, 'checkout.completed', 'checkout_session', v_session.id);
  perform sellbase.emit_event(v_store_id, 'order.created', 'order', v_order_id);
  perform sellbase.emit_event(v_store_id, 'payment.succeeded', 'order', v_order_id,
    jsonb_build_object('amount', v_paid));
  if sellbase.derive_payment_status(v_total, v_paid, 0) = 'paid' then
    perform sellbase.emit_event(v_store_id, 'order.paid', 'order', v_order_id);
  end if;

  return v_order_id;
end;
$$;

revoke execute on function
  sellbase.hold_booking(uuid, uuid, jsonb, timestamptz),
  sellbase.confirm_session_bookings(uuid, uuid, uuid, text)
from public;

insert into sellbase.schema_version (version, sellbase_version) values ('0004', '0.2.0');
