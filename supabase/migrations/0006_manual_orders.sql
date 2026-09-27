-- Sellbase 0006_manual_orders
-- Manual orders (SPEC §7 POST /orders, §11): staff or agents record sales made outside the
-- storefront. Paid ones are recorded with provider 'manual'; unpaid ones wait in
-- pending_payment until their payment link is paid, which this version of
-- record_order_payment handles by opening the order.

/*
 * Records a later payment on an existing order: the balance after a deposit, or the
 * payment link of a manual order (which opens the order). Idempotent on
 * (provider, provider_payment_id). p_payment: { provider, provider_payment_id, method,
 * amount, currency, raw }.
 */
create or replace function sellbase.record_order_payment(p_order_id uuid, p_payment jsonb)
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
  update sellbase.orders
     set amount_paid = v_paid, payment_status = v_status,
         status = case when status = 'pending_payment' then 'open' else status end
   where id = v_order.id;

  insert into sellbase.order_events (store_id, order_id, type, message, actor_type, data)
  values (v_order.store_id, v_order.id, 'payment.balance',
          case when v_order.status = 'pending_payment' then 'Payment received.' else 'Balance payment received.' end,
          'webhook', jsonb_build_object('amount', v_amount));
  perform sellbase.emit_event(v_order.store_id, 'payment.succeeded', 'order', v_order.id,
    jsonb_build_object('amount', v_amount, 'kind', 'balance'));
  if v_status = 'paid' then
    -- A pending manual order gets its first confirmation now; a deposit balance does not.
    perform sellbase.emit_event(v_order.store_id, 'order.paid', 'order', v_order.id,
      jsonb_build_object('balance', v_order.status <> 'pending_payment'));
  end if;
  return v_status;
end;
$$;

insert into sellbase.schema_version (version, sellbase_version) values ('0006', '0.2.0');
