-- Sellbase 0005_deposits
-- Deposits for services (SPEC §8 "Anticipos"): the order keeps its full total while only
-- the deposit is charged at checkout; the balance is paid later through a payment link.

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
  -- The order is worth the full total even when only a deposit was charged now.
  v_total := coalesce((v_session.totals_snapshot ->> 'total_amount')::bigint, v_session.amount_total);

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
     p_payment ->> 'provider_payment_id', coalesce(p_payment ->> 'method', 'card'),
     case when v_session.pay_mode = 'deposit' then 'deposit' else 'charge' end,
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
  else
    perform sellbase.emit_event(v_store_id, 'order.deposit_paid', 'order', v_order_id,
      jsonb_build_object('amount', v_paid, 'balance', v_total - v_paid));
  end if;

  return v_order_id;
end;
$$;

/*
 * Records a later payment on an existing order (the balance after a deposit). Idempotent
 * on (provider, provider_payment_id). p_payment: { provider, provider_payment_id, method,
 * amount, currency, raw }.
 */
create function sellbase.record_order_payment(p_order_id uuid, p_payment jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order sellbase.orders;
  v_paid bigint;
  v_status text;
  v_amount bigint := (p_payment ->> 'amount')::bigint;
begin
  select * into v_order from sellbase.orders where id = p_order_id for update;
  if not found then
    perform sellbase.raise_error('NOT_FOUND', 'Order not found.', 'Check the order id in the payment metadata.',
      jsonb_build_object('order_id', p_order_id));
  end if;

  insert into sellbase.payments (store_id, order_id, provider, provider_payment_id, method, kind, amount, currency, status, raw)
  values (v_order.store_id, v_order.id, p_payment ->> 'provider', p_payment ->> 'provider_payment_id',
          coalesce(p_payment ->> 'method', 'card'), 'balance', v_amount,
          coalesce(p_payment ->> 'currency', v_order.currency), 'succeeded', coalesce(p_payment -> 'raw', '{}'))
  on conflict (provider, provider_payment_id) do nothing;
  if not found then
    return v_order.payment_status; -- duplicate delivery
  end if;

  v_paid := v_order.amount_paid + v_amount;
  v_status := sellbase.derive_payment_status(v_order.total_amount, v_paid, v_order.amount_refunded);
  update sellbase.orders set amount_paid = v_paid, payment_status = v_status where id = v_order.id;

  insert into sellbase.order_events (store_id, order_id, type, message, actor_type, data)
  values (v_order.store_id, v_order.id, 'payment.balance', 'Balance payment received.', 'webhook',
          jsonb_build_object('amount', v_amount));
  perform sellbase.emit_event(v_order.store_id, 'payment.succeeded', 'order', v_order.id,
    jsonb_build_object('amount', v_amount, 'kind', 'balance'));
  if v_status = 'paid' then
    perform sellbase.emit_event(v_order.store_id, 'order.paid', 'order', v_order.id, jsonb_build_object('balance', true));
  end if;
  return v_status;
end;
$$;

revoke execute on function sellbase.record_order_payment(uuid, jsonb) from public;
grant execute on function sellbase.record_order_payment(uuid, jsonb) to service_role;

insert into sellbase.schema_version (version, sellbase_version) values ('0005', '0.2.0');
