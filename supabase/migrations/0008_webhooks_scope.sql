-- Sellbase 0008_webhooks_scope
-- New token scope webhooks:write (ADR 0010): sending store data to an external URL is its
-- own permission, not part of settings:write, and agent tokens do not get it by default.
--
-- Rollback: first remove the scope from every token that has it (otherwise the old check
-- fails), then restore the previous list and drop the version row:
--   update sellbase.api_tokens set scopes = array_remove(scopes, 'webhooks:write')
--    where 'webhooks:write' = any(scopes);
--   alter table sellbase.api_tokens drop constraint api_tokens_scopes_check;
--   alter table sellbase.api_tokens add constraint api_tokens_scopes_check check (scopes <@ array[
--     'catalog:read', 'catalog:write', 'orders:read', 'orders:write', 'refunds:write',
--     'customers:read', 'discounts:write', 'settings:write', 'integrations:write']);
--   delete from sellbase.schema_version where version = '0008';

alter table sellbase.api_tokens drop constraint api_tokens_scopes_check;
alter table sellbase.api_tokens add constraint api_tokens_scopes_check check (
  scopes <@ array['catalog:read', 'catalog:write', 'orders:read', 'orders:write', 'refunds:write',
                  'customers:read', 'discounts:write', 'settings:write', 'integrations:write',
                  'webhooks:write']
);

insert into sellbase.schema_version (version, sellbase_version) values ('0008', '0.2.0');
