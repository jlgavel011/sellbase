-- Sellbase 0009_admin_v2
-- Checkout consents kept on the server, and abandoned checkout recovery (docs/plans/fase-2.md, 2f-3).
--
-- consents: what the buyer accepted at checkout ([{ "text", "accepted_at" }]), e.g. an age
-- confirmation the store requires in settings.checkout.required_consent. It is copied into
-- orders.metadata.consents when the order is created, so it stays with the order.
-- recovery_sent_at: when the "you left something in your cart" email went out (at most once).
--
-- Rollback:
--   drop trigger orders_copy_checkout_consents on sellbase.orders;
--   drop function sellbase.copy_checkout_consents();
--   drop index sellbase.checkout_sessions_abandoned;
--   alter table sellbase.checkout_sessions drop column consents, drop column recovery_sent_at;
--   delete from sellbase.schema_version where version = '0009';

alter table sellbase.checkout_sessions
  add column consents jsonb not null default '[]' check (jsonb_typeof(consents) = 'array'),
  add column recovery_sent_at timestamptz;

create index checkout_sessions_abandoned on sellbase.checkout_sessions (store_id, created_at desc)
  where order_id is null;

create function sellbase.copy_checkout_consents()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.checkout_session_id is not null then
    new.metadata := new.metadata || coalesce(
      (select jsonb_build_object('consents', cs.consents)
         from sellbase.checkout_sessions cs
        where cs.id = new.checkout_session_id and jsonb_array_length(cs.consents) > 0),
      '{}'::jsonb);
  end if;
  return new;
end;
$$;

revoke execute on function sellbase.copy_checkout_consents() from public;

create trigger orders_copy_checkout_consents
  before insert on sellbase.orders
  for each row execute function sellbase.copy_checkout_consents();

insert into sellbase.schema_version (version, sellbase_version) values ('0009', '0.3.0');
