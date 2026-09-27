-- Sellbase 0007_webhooks
-- Outbound webhooks (SPEC §7, ADR 0010): the store's own systems subscribe to events.
-- Each endpoint has a signing secret kept in Vault; every event becomes one delivery per
-- matching endpoint, retried with backoff by the jobs function.

create table sellbase.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  url text not null check (url ~ '^https?://'),
  description text not null default '',
  -- Empty = every event.
  events text[] not null default '{}',
  enabled boolean not null default true,
  secret_ref uuid,
  secret_prefix text not null default '',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on sellbase.webhook_endpoints (store_id);

create table sellbase.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  endpoint_id uuid not null references sellbase.webhook_endpoints on delete cascade,
  event_id uuid references sellbase.events on delete set null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status_code int,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (endpoint_id, event_id)
);
create index webhook_deliveries_due on sellbase.webhook_deliveries (next_attempt_at) where status = 'pending';
create index on sellbase.webhook_deliveries (endpoint_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['webhook_endpoints', 'webhook_deliveries'] loop
    execute format('alter table sellbase.%I enable row level security', t);
    execute format('grant select on sellbase.%I to authenticated', t);
    -- Payloads carry customer data and endpoints lead to secrets: owners and admins only.
    execute format('create policy admin_read on sellbase.%I for select to authenticated using (sellbase.has_role(store_id, ''admin''))', t);
    execute format('create trigger set_updated_at before update on sellbase.%I for each row execute function sellbase.set_updated_at()', t);
  end loop;
end;
$$;

create function sellbase.set_webhook_secret(p_endpoint_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_endpoint sellbase.webhook_endpoints;
begin
  select * into v_endpoint from sellbase.webhook_endpoints where id = p_endpoint_id for update;
  if not found then
    perform sellbase.raise_error('NOT_FOUND', 'Webhook endpoint not found.', 'List endpoints with GET /webhooks.',
      jsonb_build_object('id', p_endpoint_id));
  end if;
  if v_endpoint.secret_ref is null then
    update sellbase.webhook_endpoints
       set secret_ref = vault.create_secret(p_secret,
             format('sellbase/%s/webhook/%s', v_endpoint.store_id, p_endpoint_id), 'Sellbase webhook signing secret'),
           secret_prefix = left(p_secret, 10)
     where id = p_endpoint_id;
  else
    perform vault.update_secret(v_endpoint.secret_ref, p_secret);
    update sellbase.webhook_endpoints set secret_prefix = left(p_secret, 10) where id = p_endpoint_id;
  end if;
end;
$$;

create function sellbase.get_webhook_secret(p_endpoint_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
    from sellbase.webhook_endpoints e
    join vault.decrypted_secrets s on s.id = e.secret_ref
   where e.id = p_endpoint_id;
$$;

-- Deleting an endpoint also removes its secret from Vault.
create function sellbase.delete_webhook_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.secret_ref is not null then
    delete from vault.secrets where id = old.secret_ref;
  end if;
  return old;
end;
$$;
create trigger delete_webhook_secret after delete on sellbase.webhook_endpoints
  for each row execute function sellbase.delete_webhook_secret();

revoke execute on function sellbase.set_webhook_secret(uuid, text), sellbase.get_webhook_secret(uuid),
  sellbase.delete_webhook_secret() from public;
grant execute on function sellbase.set_webhook_secret(uuid, text), sellbase.get_webhook_secret(uuid)
  to service_role;

insert into sellbase.schema_version (version, sellbase_version) values ('0007', '0.2.0');
