-- Sellbase 0002_vault_storage_cron
-- Provider secrets in Supabase Vault, storage buckets, the cron job that frees stock
-- held by abandoned checkouts, and discount codes on carts.

-- Codes the buyer applied, uppercase. Automatic discounts are not stored; they are
-- evaluated on every read.
alter table sellbase.carts add column discount_codes text[] not null default '{}';

-- ── Secrets (never in plain tables) ──────────────────────────────────────────
-- p_secret is a JSON string such as {"secret_key": "...", "webhook_secret": "..."}.
create function sellbase.set_integration_secret(p_store_id uuid, p_provider text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref uuid;
begin
  select secret_ref into v_ref from sellbase.integrations
   where store_id = p_store_id and provider = p_provider
   for update;
  if not found then
    perform sellbase.raise_error('NOT_FOUND', format('Integration "%s" does not exist.', p_provider),
      'Create the integration row before storing its secret.', jsonb_build_object('provider', p_provider));
  end if;
  if v_ref is null then
    v_ref := vault.create_secret(p_secret, format('sellbase/%s/%s/%s', p_store_id, p_provider, gen_random_uuid()),
                                 format('Sellbase %s credentials', p_provider));
    update sellbase.integrations set secret_ref = v_ref
     where store_id = p_store_id and provider = p_provider;
  else
    perform vault.update_secret(v_ref, p_secret);
  end if;
end;
$$;

create function sellbase.get_integration_secret(p_store_id uuid, p_provider text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
    from sellbase.integrations i
    join vault.decrypted_secrets s on s.id = i.secret_ref
   where i.store_id = p_store_id and i.provider = p_provider;
$$;

revoke execute on function sellbase.set_integration_secret(uuid, text, text),
  sellbase.get_integration_secret(uuid, text) from public;
grant execute on function sellbase.set_integration_secret(uuid, text, text),
  sellbase.get_integration_secret(uuid, text) to service_role;

-- ── Storage ──────────────────────────────────────────────────────────────────
-- sellbase-media: public product images. sellbase-digital: private files, only reachable
-- through short-lived signed URLs issued for a valid digital grant. Writes go through
-- the API with the service role, so no storage.objects policies are needed.
insert into storage.buckets (id, name, public)
values ('sellbase-media', 'sellbase-media', true),
       ('sellbase-digital', 'sellbase-digital', false)
on conflict (id) do nothing;

-- ── Cron ─────────────────────────────────────────────────────────────────────
create extension if not exists pg_cron;

select cron.schedule(
  'sellbase-release-expired-checkouts',
  '* * * * *',
  'select sellbase.release_expired_checkouts()'
);

insert into sellbase.schema_version (version, sellbase_version) values ('0002', '0.1.0');
