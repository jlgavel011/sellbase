-- Sellbase 0003_jobs_schedule
-- Every minute pg_cron calls the sellbase-jobs Edge Function through pg_net, so outbox
-- events (digital delivery, emails) are processed even if the immediate trigger after a
-- write was lost. The URL and key live in Vault; `sellbase init` sets them.

create extension if not exists pg_net with schema extensions;

create function sellbase.configure_jobs(p_url text, p_service_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'sellbase_jobs_url';
  if v_id is null then perform vault.create_secret(p_url, 'sellbase_jobs_url', 'Sellbase jobs function URL');
  else perform vault.update_secret(v_id, p_url); end if;

  select id into v_id from vault.secrets where name = 'sellbase_jobs_key';
  if v_id is null then perform vault.create_secret(p_service_key, 'sellbase_jobs_key', 'Key used by pg_cron to call sellbase-jobs');
  else perform vault.update_secret(v_id, p_service_key); end if;
end;
$$;

create function sellbase.invoke_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'sellbase_jobs_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'sellbase_jobs_key';
  if v_url is null or v_key is null then
    return; -- not configured yet: `sellbase doctor` reports it
  end if;
  -- Skip the call when there is nothing to do.
  if not exists (select 1 from sellbase.events where processed_at is null and attempts < 8) then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke execute on function sellbase.configure_jobs(text, text), sellbase.invoke_jobs() from public;
grant execute on function sellbase.configure_jobs(text, text), sellbase.invoke_jobs() to service_role;

select cron.schedule('sellbase-run-jobs', '* * * * *', 'select sellbase.invoke_jobs()');

insert into sellbase.schema_version (version, sellbase_version) values ('0003', '0.2.0');
