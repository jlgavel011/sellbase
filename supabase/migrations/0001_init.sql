-- Sellbase 0001_init
-- Business tables for Phase 1 (SPEC §5), RLS (§6, ADR 0004), storefront views and the
-- transactional functions behind checkout and order placement (§8).
-- Services/bookings arrive in a later migration.

-- ═════════════════════════════════════════════════════════════════════════════
-- Errors
-- ═════════════════════════════════════════════════════════════════════════════

-- Raises an error the API can map to { code, message, hint, details }:
-- SQLSTATE P0001, message = text, hint = next action, detail = {"code": ..., ...details}.
create function sellbase.raise_error(p_code text, p_message text, p_hint text, p_details jsonb default '{}')
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = p_message,
    hint = p_hint,
    detail = (jsonb_build_object('code', p_code) || coalesce(p_details, '{}'))::text;
end;
$$;
revoke execute on function sellbase.raise_error(text, text, text, jsonb) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- Store, team and access
-- ═════════════════════════════════════════════════════════════════════════════

create table sellbase.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  default_currency char(3) not null check (default_currency ~ '^[A-Z]{3}$'),
  default_locale text not null default 'es',
  timezone text not null default 'America/Mexico_City',
  country char(2) not null check (country ~ '^[A-Z]{2}$'),
  contact_email extensions.citext,
  logo_url text,
  settings jsonb not null default '{}',
  -- Application fee on managed payments (SPEC §8). Default is decided before Phase 3 (§19.5).
  platform_fee_bps int not null default 0 check (platform_fee_bps between 0 and 10000),
  order_number_seq int not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sellbase.staff_members (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner', 'admin', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, user_id)
);
create index on sellbase.staff_members (user_id);

create table sellbase.api_tokens (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  name text not null,
  token_hash text not null unique,
  prefix text not null,
  scopes text[] not null check (
    scopes <@ array['catalog:read', 'catalog:write', 'orders:read', 'orders:write', 'refunds:write',
                    'customers:read', 'discounts:write', 'settings:write', 'integrations:write']
  ),
  created_by uuid references auth.users on delete set null,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on sellbase.api_tokens (store_id);

create table sellbase.audit_log (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  actor_type text not null check (actor_type in ('staff', 'token', 'system', 'webhook')),
  actor_id text,
  action text not null,
  entity text not null,
  entity_id uuid,
  diff jsonb not null default '{}',
  ip inet,
  created_at timestamptz not null default now()
);
create index on sellbase.audit_log (store_id, created_at desc);

-- ═════════════════════════════════════════════════════════════════════════════
-- Catalog
-- ═════════════════════════════════════════════════════════════════════════════

create table sellbase.locations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  name text not null,
  address jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index locations_one_default on sellbase.locations (store_id) where is_default;

create table sellbase.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  type text not null check (type in ('physical', 'digital', 'service')),
  title text not null check (length(title) between 1 and 200),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  seo jsonb not null default '{}',
  tags text[] not null default '{}',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, slug)
);
create index on sellbase.products (store_id, status);

create table sellbase.product_options (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  product_id uuid not null references sellbase.products on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (product_id, name)
);

create table sellbase.product_option_values (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  option_id uuid not null references sellbase.product_options on delete cascade,
  value text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (option_id, value)
);

create table sellbase.variants (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  product_id uuid not null references sellbase.products on delete cascade,
  sku text,
  title text not null default 'Default',
  option_values jsonb not null default '{}',
  price_amount bigint not null check (price_amount >= 0),
  compare_at_amount bigint check (compare_at_amount >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index variants_sku_per_store on sellbase.variants (store_id, sku) where sku is not null;
create index on sellbase.variants (product_id);

create table sellbase.product_media (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  product_id uuid not null references sellbase.products on delete cascade,
  variant_id uuid references sellbase.variants on delete set null,
  storage_path text,
  url text not null,
  alt text not null default '',
  position int not null default 0,
  kind text not null default 'image' check (kind in ('image', 'video')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on sellbase.product_media (product_id, position);

create table sellbase.physical_specs (
  variant_id uuid primary key references sellbase.variants on delete cascade,
  store_id uuid not null references sellbase.stores on delete cascade,
  weight_g int not null check (weight_g >= 0),
  length_cm numeric(8, 2) not null check (length_cm >= 0),
  width_cm numeric(8, 2) not null check (width_cm >= 0),
  height_cm numeric(8, 2) not null check (height_cm >= 0),
  requires_shipping boolean not null default true,
  hs_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sellbase.digital_assets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  variant_id uuid not null references sellbase.variants on delete cascade,
  storage_path text not null,
  file_name text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  download_limit int check (download_limit > 0),
  link_ttl_hours int not null default 72 check (link_ttl_hours > 0),
  license_template text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on sellbase.digital_assets (variant_id);

-- Variants without an inventory row are untracked (always available).
create table sellbase.inventory_levels (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  variant_id uuid not null references sellbase.variants on delete cascade,
  location_id uuid not null references sellbase.locations on delete cascade,
  on_hand int not null default 0,
  reserved int not null default 0 check (reserved >= 0),
  policy text not null default 'deny' check (policy in ('deny', 'continue')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (variant_id, location_id),
  constraint inventory_deny_not_negative check (policy = 'continue' or (on_hand >= 0 and reserved <= on_hand))
);

create table sellbase.collections (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  title text not null,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null default '',
  rule jsonb,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, slug)
);

create table sellbase.collection_products (
  collection_id uuid not null references sellbase.collections on delete cascade,
  product_id uuid not null references sellbase.products on delete cascade,
  store_id uuid not null references sellbase.stores on delete cascade,
  position int not null default 0,
  primary key (collection_id, product_id)
);
create index on sellbase.collection_products (product_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- Customers
-- ═════════════════════════════════════════════════════════════════════════════

create table sellbase.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  email extensions.citext not null,
  phone text,
  first_name text,
  last_name text,
  auth_user_id uuid references auth.users on delete set null,
  accepts_marketing boolean not null default false,
  marketing_consent_at timestamptz,
  locale text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, email)
);
create index on sellbase.customers (auth_user_id);

create table sellbase.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  customer_id uuid not null references sellbase.customers on delete cascade,
  label text,
  line1 text not null,
  line2 text,
  city text not null,
  state text,
  postal_code text not null,
  country char(2) not null,
  phone text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ═════════════════════════════════════════════════════════════════════════════
-- Carts, discounts, checkout
-- ═════════════════════════════════════════════════════════════════════════════

create table sellbase.carts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  token text not null unique check (length(token) >= 20),
  customer_id uuid references sellbase.customers on delete set null,
  email extensions.citext,
  currency char(3) not null,
  status text not null default 'open' check (status in ('open', 'converted', 'abandoned', 'expired')),
  expires_at timestamptz not null default now() + interval '30 days',
  recovered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on sellbase.carts (store_id, status, updated_at);

create table sellbase.cart_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  cart_id uuid not null references sellbase.carts on delete cascade,
  variant_id uuid not null references sellbase.variants on delete cascade,
  quantity int not null check (quantity between 1 and 999),
  booking_slot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index cart_items_one_line_per_variant on sellbase.cart_items (cart_id, variant_id)
  where booking_slot is null;

create table sellbase.discounts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  code extensions.citext,
  kind text not null check (kind in ('percent', 'fixed', 'free_shipping')),
  -- percent: basis points (1000 = 10%); fixed: minor units; free_shipping: 0.
  value bigint not null default 0 check (value >= 0),
  applies_to jsonb not null default '{"type": "all"}',
  min_subtotal_amount bigint check (min_subtotal_amount >= 0),
  usage_limit int check (usage_limit > 0),
  per_customer_limit int check (per_customer_limit > 0),
  usage_count int not null default 0 check (usage_count >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, code),
  check (kind <> 'percent' or value between 1 and 10000),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table sellbase.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  cart_id uuid not null references sellbase.carts on delete cascade,
  provider text not null,
  provider_session_id text,
  amount_total bigint not null check (amount_total >= 0),
  currency char(3) not null,
  pay_mode text not null default 'full' check (pay_mode in ('full', 'deposit')),
  status text not null default 'open' check (status in ('open', 'completed', 'expired')),
  email extensions.citext,
  shipping_address jsonb,
  shipping_selection jsonb,
  -- Priced lines and totals frozen at checkout time: the order is built from these,
  -- so a later price change never alters what the customer paid for.
  lines_snapshot jsonb not null,
  totals_snapshot jsonb not null,
  discount_ids uuid[] not null default '{}',
  order_id uuid,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_session_id)
);
create index on sellbase.checkout_sessions (status, expires_at);

create table sellbase.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  checkout_session_id uuid not null references sellbase.checkout_sessions on delete cascade,
  inventory_level_id uuid not null references sellbase.inventory_levels on delete cascade,
  variant_id uuid not null references sellbase.variants on delete cascade,
  quantity int not null check (quantity > 0),
  expires_at timestamptz not null,
  released_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (released_at is null or consumed_at is null)
);
create index on sellbase.inventory_reservations (expires_at) where released_at is null and consumed_at is null;

-- ═════════════════════════════════════════════════════════════════════════════
-- Orders
-- ═════════════════════════════════════════════════════════════════════════════

create table sellbase.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  number int not null,
  channel text not null default 'web'
    check (channel in ('web', 'admin', 'whatsapp', 'google', 'mercadolibre', 'api', 'agent')),
  checkout_session_id uuid unique references sellbase.checkout_sessions on delete set null,
  customer_id uuid references sellbase.customers on delete set null,
  email extensions.citext not null,
  phone text,
  currency char(3) not null,
  subtotal_amount bigint not null check (subtotal_amount >= 0),
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  shipping_amount bigint not null default 0 check (shipping_amount >= 0),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  total_amount bigint not null check (total_amount >= 0),
  amount_paid bigint not null default 0 check (amount_paid >= 0),
  amount_refunded bigint not null default 0 check (amount_refunded >= 0 and amount_refunded <= amount_paid),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'open', 'completed', 'cancelled')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded')),
  fulfillment_status text not null default 'unfulfilled'
    check (fulfillment_status in ('unfulfilled', 'partially_fulfilled', 'fulfilled')),
  shipping_address jsonb,
  billing_address jsonb,
  notes text,
  placed_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancel_reason text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, number)
);
create index on sellbase.orders (store_id, placed_at desc);
create index on sellbase.orders (customer_id);
alter table sellbase.checkout_sessions
  add foreign key (order_id) references sellbase.orders on delete set null;

create table sellbase.discount_redemptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  discount_id uuid not null references sellbase.discounts on delete cascade,
  order_id uuid not null references sellbase.orders on delete cascade,
  customer_id uuid references sellbase.customers on delete set null,
  created_at timestamptz not null default now(),
  unique (discount_id, order_id)
);
create index on sellbase.discount_redemptions (discount_id, customer_id);

-- Every field is a snapshot taken at purchase time.
create table sellbase.order_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  order_id uuid not null references sellbase.orders on delete cascade,
  variant_id uuid references sellbase.variants on delete set null,
  product_id uuid references sellbase.products on delete set null,
  product_type text not null check (product_type in ('physical', 'digital', 'service')),
  title text not null,
  variant_title text,
  sku text,
  unit_price_amount bigint not null check (unit_price_amount >= 0),
  quantity int not null check (quantity > 0),
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  total_amount bigint not null check (total_amount >= 0),
  fulfillment_type text not null check (fulfillment_type in ('shipment', 'digital', 'booking', 'none')),
  fulfilled_quantity int not null default 0 check (fulfilled_quantity >= 0),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on sellbase.order_items (order_id);

create table sellbase.payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  order_id uuid not null references sellbase.orders on delete cascade,
  provider text not null,
  provider_payment_id text,
  method text not null default 'card',
  kind text not null default 'charge' check (kind in ('charge', 'deposit', 'balance')),
  amount bigint not null check (amount >= 0),
  currency char(3) not null,
  status text not null check (status in ('pending', 'succeeded', 'failed', 'expired')),
  raw jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);
create index on sellbase.payments (order_id);

create table sellbase.refunds (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  payment_id uuid not null references sellbase.payments on delete cascade,
  amount bigint not null check (amount > 0),
  reason text not null,
  provider_refund_id text,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sellbase.fulfillments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  order_id uuid not null references sellbase.orders on delete cascade,
  type text not null check (type in ('shipment', 'digital', 'booking')),
  status text not null default 'pending' check (status in ('pending', 'fulfilled', 'cancelled')),
  items jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on sellbase.fulfillments (order_id);

create table sellbase.shipments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  fulfillment_id uuid not null references sellbase.fulfillments on delete cascade,
  carrier text,
  service text,
  tracking_number text,
  tracking_url text,
  label_url text,
  rate_amount bigint check (rate_amount >= 0),
  status text not null default 'label_created'
    check (status in ('label_created', 'in_transit', 'delivered', 'exception', 'returned')),
  events jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sellbase.digital_grants (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  fulfillment_id uuid not null references sellbase.fulfillments on delete cascade,
  order_id uuid not null references sellbase.orders on delete cascade,
  digital_asset_id uuid not null references sellbase.digital_assets on delete cascade,
  customer_id uuid references sellbase.customers on delete set null,
  token_hash text not null unique,
  downloads_used int not null default 0 check (downloads_used >= 0),
  download_limit int check (download_limit > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sellbase.order_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  order_id uuid not null references sellbase.orders on delete cascade,
  type text not null,
  message text not null,
  data jsonb not null default '{}',
  actor_type text not null default 'system' check (actor_type in ('staff', 'token', 'system', 'webhook', 'customer')),
  actor_id text,
  created_at timestamptz not null default now()
);
create index on sellbase.order_events (order_id, created_at);

-- ═════════════════════════════════════════════════════════════════════════════
-- Events, integrations, notifications, idempotency
-- ═════════════════════════════════════════════════════════════════════════════

-- Outbox: inserted in the same transaction as the business change.
create table sellbase.events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  type text not null,
  entity text not null,
  entity_id uuid,
  payload jsonb not null default '{}',
  attempts int not null default 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index events_pending on sellbase.events (created_at) where processed_at is null;

create table sellbase.processed_webhooks (
  provider text not null,
  event_id text not null,
  processed_at timestamptz not null default now(),
  primary key (provider, event_id)
);

-- Secrets never live here: `secret_ref` points to Supabase Vault.
create table sellbase.integrations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  provider text not null,
  kind text not null
    check (kind in ('payments', 'shipping', 'notify', 'channel', 'calendar', 'tax', 'invoicing')),
  status text not null default 'disabled' check (status in ('connected', 'error', 'disabled')),
  config jsonb not null default '{}',
  secret_ref uuid,
  connected_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, provider)
);

create table sellbase.notifications (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references sellbase.stores on delete cascade,
  event_id uuid references sellbase.events on delete set null,
  channel text not null check (channel in ('email', 'whatsapp', 'sms')),
  "to" text not null,
  template text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sellbase.idempotency_keys (
  scope text not null,
  key text not null,
  request_hash text not null,
  response_status int,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (scope, key)
);

-- ═════════════════════════════════════════════════════════════════════════════
-- Shared setup: RLS on and updated_at triggers for every table (guards verify it)
-- ═════════════════════════════════════════════════════════════════════════════

do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'sellbase' and c.relkind = 'r' loop
    execute format('alter table sellbase.%I enable row level security', t.relname);
  end loop;
  for t in select table_name from information_schema.columns
            where table_schema = 'sellbase' and column_name = 'updated_at' loop
    execute format(
      'create trigger set_updated_at before update on sellbase.%I for each row execute function sellbase.set_updated_at()',
      t.table_name);
  end loop;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Access helpers
-- ═════════════════════════════════════════════════════════════════════════════

create function sellbase.is_staff(p_store_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from sellbase.staff_members
     where store_id = p_store_id and user_id = auth.uid()
  );
$$;

-- Role hierarchy: owner > admin > staff. has_role(store, 'admin') is true for owners too.
create function sellbase.has_role(p_store_id uuid, p_role text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from sellbase.staff_members
     where store_id = p_store_id and user_id = auth.uid()
       and case p_role
             when 'staff' then true
             when 'admin' then role in ('owner', 'admin')
             when 'owner' then role = 'owner'
             else false
           end
  );
$$;

-- v1 has one store per install; every table still carries store_id (SPEC §4.3).
create function sellbase.current_store_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select id from sellbase.stores order by created_at limit 1;
$$;

create function sellbase.is_customer(p_customer_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_customer_id is not null and exists (
    select 1 from sellbase.customers where id = p_customer_id and auth_user_id = auth.uid()
  );
$$;

revoke execute on function sellbase.is_staff(uuid), sellbase.has_role(uuid, text),
  sellbase.current_store_id(), sellbase.is_customer(uuid) from public;
grant execute on function sellbase.is_staff(uuid), sellbase.has_role(uuid, text),
  sellbase.current_store_id(), sellbase.is_customer(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- Grants and policies (ADR 0004: SELECT only; writes go through the API)
-- ═════════════════════════════════════════════════════════════════════════════

grant select on all tables in schema sellbase to authenticated;
revoke select on sellbase.processed_webhooks, sellbase.idempotency_keys from authenticated;

-- Staff read everything in their store…
do $$
declare t text;
begin
  foreach t in array array[
    'stores', 'staff_members', 'locations', 'products', 'product_options', 'product_option_values',
    'variants', 'product_media', 'physical_specs', 'digital_assets', 'inventory_levels',
    'collections', 'collection_products', 'customers', 'customer_addresses', 'carts', 'cart_items',
    'discounts', 'discount_redemptions', 'checkout_sessions', 'inventory_reservations', 'orders',
    'order_items', 'payments', 'refunds', 'fulfillments', 'shipments', 'digital_grants',
    'order_events', 'notifications'
  ] loop
    execute format(
      'create policy staff_read on sellbase.%I for select to authenticated using (sellbase.is_staff(%s))',
      t, case when t = 'stores' then 'id' else 'store_id' end);
  end loop;
end;
$$;

-- …except secrets-adjacent tables, which need owner/admin.
create policy admin_read on sellbase.api_tokens for select to authenticated
  using (sellbase.has_role(store_id, 'admin'));
create policy admin_read on sellbase.integrations for select to authenticated
  using (sellbase.has_role(store_id, 'admin'));
create policy admin_read on sellbase.audit_log for select to authenticated
  using (sellbase.has_role(store_id, 'admin'));
create policy admin_read on sellbase.events for select to authenticated
  using (sellbase.has_role(store_id, 'admin'));

-- Any team member of any store may read the schema version (it has no store_id).
create policy staff_read on sellbase.schema_version for select to authenticated
  using (exists (select 1 from sellbase.staff_members where user_id = auth.uid()));

-- Signed-in customers read their own data.
create policy customer_read_self on sellbase.customers for select to authenticated
  using (auth_user_id = auth.uid());
create policy customer_read_own on sellbase.customer_addresses for select to authenticated
  using (sellbase.is_customer(customer_id));
create policy customer_read_own on sellbase.orders for select to authenticated
  using (sellbase.is_customer(customer_id));
create policy customer_read_own on sellbase.order_items for select to authenticated
  using (exists (select 1 from sellbase.orders o where o.id = order_id and sellbase.is_customer(o.customer_id)));
create policy customer_read_own on sellbase.payments for select to authenticated
  using (exists (select 1 from sellbase.orders o where o.id = order_id and sellbase.is_customer(o.customer_id)));
create policy customer_read_own on sellbase.fulfillments for select to authenticated
  using (exists (select 1 from sellbase.orders o where o.id = order_id and sellbase.is_customer(o.customer_id)));
create policy customer_read_own on sellbase.shipments for select to authenticated
  using (exists (
    select 1 from sellbase.fulfillments f join sellbase.orders o on o.id = f.order_id
     where f.id = fulfillment_id and sellbase.is_customer(o.customer_id)));
create policy customer_read_own on sellbase.carts for select to authenticated
  using (sellbase.is_customer(customer_id));
create policy customer_read_own on sellbase.cart_items for select to authenticated
  using (exists (select 1 from sellbase.carts c where c.id = cart_id and sellbase.is_customer(c.customer_id)));

-- Public catalog: anon gets column-level SELECT (never metadata) on active rows only.
grant select (id, name, slug, default_currency, default_locale, country, logo_url) on sellbase.stores to anon;
grant select (id, store_id, type, title, slug, description, status, seo, tags, created_at, updated_at)
  on sellbase.products to anon;
grant select (id, store_id, product_id, sku, title, option_values, price_amount, compare_at_amount,
              currency, status, position) on sellbase.variants to anon;
grant select (id, store_id, product_id, variant_id, url, alt, position, kind) on sellbase.product_media to anon;
grant select (variant_id, on_hand, reserved, policy) on sellbase.inventory_levels to anon;
grant select (id, store_id, title, slug, description, position) on sellbase.collections to anon;
grant select (collection_id, product_id, store_id, position) on sellbase.collection_products to anon;

create policy public_read on sellbase.stores for select to anon, authenticated using (true);
create policy public_read_active on sellbase.products for select to anon, authenticated
  using (status = 'active');
create policy public_read_active on sellbase.variants for select to anon, authenticated
  using (status = 'active' and exists (
    select 1 from sellbase.products p where p.id = product_id and p.status = 'active'));
create policy public_read_active on sellbase.product_media for select to anon, authenticated
  using (exists (select 1 from sellbase.products p where p.id = product_id and p.status = 'active'));
create policy public_read_active on sellbase.inventory_levels for select to anon, authenticated
  using (exists (
    select 1 from sellbase.variants v join sellbase.products p on p.id = v.product_id
     where v.id = variant_id and v.status = 'active' and p.status = 'active'));
create policy public_read on sellbase.collections for select to anon, authenticated using (true);
create policy public_read_active on sellbase.collection_products for select to anon, authenticated
  using (exists (select 1 from sellbase.products p where p.id = product_id and p.status = 'active'));

-- ═════════════════════════════════════════════════════════════════════════════
-- Storefront views (security_invoker: the caller's RLS applies)
-- ═════════════════════════════════════════════════════════════════════════════

create view sellbase.storefront_variants with (security_invoker = true) as
select v.id, v.store_id, v.product_id, v.sku, v.title, v.option_values, v.price_amount,
       v.compare_at_amount, v.currency, v.position,
       case when inv.tracked then greatest(inv.available, 0) end as available_quantity,
       (not coalesce(inv.tracked, false) or inv.allow_backorder or inv.available > 0) as available
  from sellbase.variants v
  left join lateral (
    select count(*) > 0 as tracked,
           sum(il.on_hand - il.reserved)::int as available,
           bool_or(il.policy = 'continue') as allow_backorder
      from sellbase.inventory_levels il where il.variant_id = v.id
  ) inv on true
 where v.status = 'active';

create view sellbase.storefront_products with (security_invoker = true) as
select p.id, p.store_id, p.type, p.title, p.slug, p.description, p.seo, p.tags, p.created_at,
       price.min_price_amount, price.max_price_amount, price.currency,
       media.url as image_url, media.alt as image_alt
  from sellbase.products p
  left join lateral (
    select min(v.price_amount) as min_price_amount, max(v.price_amount) as max_price_amount,
           min(v.currency) as currency
      from sellbase.variants v where v.product_id = p.id and v.status = 'active'
  ) price on true
  left join lateral (
    select m.url, m.alt from sellbase.product_media m
     where m.product_id = p.id order by m.position limit 1
  ) media on true
 where p.status = 'active';

create view sellbase.storefront_collections with (security_invoker = true) as
select c.id, c.store_id, c.title, c.slug, c.description, c.position from sellbase.collections c;

grant select on sellbase.storefront_variants, sellbase.storefront_products,
  sellbase.storefront_collections to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- State machine mirror (see @sellbase/core/state.ts)
-- ═════════════════════════════════════════════════════════════════════════════

create function sellbase.enforce_order_transitions()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[];
begin
  if new.status is distinct from old.status then
    allowed := case old.status
      when 'pending_payment' then array['open', 'cancelled']
      when 'open' then array['completed', 'cancelled']
      else array[]::text[]
    end;
    if not new.status = any (allowed) then
      perform sellbase.raise_error('INVALID_TRANSITION',
        format('order.status cannot go from "%s" to "%s".', old.status, new.status),
        case when cardinality(allowed) = 0 then format('"%s" is final; no further changes are allowed.', old.status)
             else format('From "%s" the allowed next states are: %s.', old.status, array_to_string(allowed, ', ')) end,
        jsonb_build_object('machine', 'order.status', 'from', old.status, 'to', new.status));
    end if;
  end if;
  if new.fulfillment_status is distinct from old.fulfillment_status
     and (old.fulfillment_status = 'fulfilled'
          or (old.fulfillment_status = 'partially_fulfilled' and new.fulfillment_status = 'unfulfilled')) then
    perform sellbase.raise_error('INVALID_TRANSITION',
      format('order.fulfillment_status cannot go from "%s" to "%s".', old.fulfillment_status, new.fulfillment_status),
      'Fulfillment only moves forward.',
      jsonb_build_object('machine', 'order.fulfillment_status'));
  end if;
  return new;
end;
$$;
revoke execute on function sellbase.enforce_order_transitions() from public;
create trigger enforce_transitions before update on sellbase.orders
  for each row execute function sellbase.enforce_order_transitions();

-- Mirror of derivePaymentStatus in @sellbase/core.
create function sellbase.derive_payment_status(p_total bigint, p_paid bigint, p_refunded bigint)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_refunded > 0 then case when p_refunded >= p_paid then 'refunded' else 'partially_refunded' end
    when p_paid <= 0 then case when p_total = 0 then 'paid' else 'unpaid' end
    when p_paid >= p_total then 'paid'
    else 'partially_paid'
  end;
$$;
revoke execute on function sellbase.derive_payment_status(bigint, bigint, bigint) from public;

-- ═════════════════════════════════════════════════════════════════════════════
-- Transactional operations (service_role only; called by Edge Functions)
-- ═════════════════════════════════════════════════════════════════════════════

create function sellbase.emit_event(p_store_id uuid, p_type text, p_entity text, p_entity_id uuid, p_payload jsonb default '{}')
returns uuid
language sql
set search_path = ''
as $$
  insert into sellbase.events (store_id, type, entity, entity_id, payload)
  values (p_store_id, p_type, p_entity, p_entity_id, coalesce(p_payload, '{}'))
  returning id;
$$;

create function sellbase.next_order_number(p_store_id uuid)
returns int
language sql
set search_path = ''
as $$
  update sellbase.stores set order_number_seq = order_number_seq + 1
   where id = p_store_id
  returning order_number_seq;
$$;

/*
 * Freezes a priced cart into a checkout session and reserves stock (SPEC §8 step 2).
 * p_lines: array of priced lines from @sellbase/core, each with variant_id, product_id,
 * product_type, title, variant_title, sku, unit_price_amount, quantity, discount_amount,
 * tax_amount, total_amount, fulfillment_type.
 * Raises OUT_OF_STOCK when a `deny` variant lacks availability; nothing is reserved then.
 */
create function sellbase.create_checkout_session(
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

  return v_session_id;
end;
$$;

-- Releases a session's reservations (payment provider failed, session expired or cancelled).
create function sellbase.release_checkout_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  update sellbase.checkout_sessions set status = 'expired'
   where id = p_session_id and status = 'open';
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

-- Called by pg_cron: expires stale open sessions and frees their stock.
create function sellbase.release_expired_checkouts()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  n int := 0;
begin
  for s in select id from sellbase.checkout_sessions
            where status = 'open' and expires_at < now() for update skip locked loop
    perform sellbase.release_checkout_session(s.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

/*
 * Creates the order from a paid checkout session (SPEC §8 step 3), in one transaction:
 * order + snapshot items + payment, consume reservations, discount redemptions,
 * customer upsert, cart converted, timeline and outbox events.
 * Idempotent: a second call for the same session returns the existing order.
 * p_payment: { provider, provider_payment_id, method, amount, currency, raw }.
 * A late payment whose reservation already expired still becomes an order (the customer
 * paid); if stock ran out, on_hand stops at 0 and an inventory.oversold event alerts the owner.
 */
create function sellbase.place_order_from_checkout(p_session_id uuid, p_payment jsonb)
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
       unit_price_amount, quantity, discount_amount, tax_amount, total_amount, fulfillment_type)
    values
      (v_store_id, v_order_id, (v_line ->> 'variant_id')::uuid, (v_line ->> 'product_id')::uuid,
       v_line ->> 'product_type', v_line ->> 'title', v_line ->> 'variant_title', v_line ->> 'sku',
       (v_line ->> 'unit_price_amount')::bigint, (v_line ->> 'quantity')::int,
       coalesce((v_line ->> 'discount_amount')::bigint, 0), coalesce((v_line ->> 'tax_amount')::bigint, 0),
       (v_line ->> 'total_amount')::bigint, v_line ->> 'fulfillment_type');
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

/*
 * Adjusts stock with a reason and audit trail. Creates the inventory row at the default
 * location on first use. Raises OUT_OF_STOCK if a `deny` variant would drop below what is
 * already reserved.
 */
create function sellbase.adjust_inventory(
  p_variant_id uuid,
  p_delta int,
  p_reason text,
  p_actor_type text,
  p_actor_id text,
  p_policy text default null
)
returns sellbase.inventory_levels
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_variant sellbase.variants;
  v_location_id uuid;
  v_level sellbase.inventory_levels;
begin
  select * into v_variant from sellbase.variants where id = p_variant_id;
  if not found then
    perform sellbase.raise_error('NOT_FOUND', 'Variant not found.',
      'Look up variant ids with products_search or GET /products/:id.', jsonb_build_object('variant_id', p_variant_id));
  end if;

  select id into v_location_id from sellbase.locations
   where store_id = v_variant.store_id and is_default;
  if v_location_id is null then
    insert into sellbase.locations (store_id, name, is_default)
    values (v_variant.store_id, 'Default', true) returning id into v_location_id;
  end if;

  insert into sellbase.inventory_levels (store_id, variant_id, location_id, on_hand, policy)
  values (v_variant.store_id, p_variant_id, v_location_id, 0, coalesce(p_policy, 'deny'))
  on conflict (variant_id, location_id) do nothing;

  select * into v_level from sellbase.inventory_levels
   where variant_id = p_variant_id and location_id = v_location_id for update;

  if coalesce(p_policy, v_level.policy) = 'deny' and v_level.on_hand + p_delta < v_level.reserved then
    perform sellbase.raise_error('OUT_OF_STOCK',
      format('Stock cannot go below %s: that many units are reserved by open checkouts.', v_level.reserved),
      'Wait for open checkouts to finish or expire (15 min), or use a smaller adjustment.',
      jsonb_build_object('on_hand', v_level.on_hand, 'reserved', v_level.reserved, 'delta', p_delta));
  end if;

  update sellbase.inventory_levels
     set on_hand = on_hand + p_delta, policy = coalesce(p_policy, policy)
   where id = v_level.id
  returning * into v_level;

  insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id, diff)
  values (v_variant.store_id, p_actor_type, p_actor_id, 'inventory.adjust', 'variant', p_variant_id,
          jsonb_build_object('delta', p_delta, 'reason', p_reason, 'on_hand', v_level.on_hand));
  return v_level;
end;
$$;

revoke execute on function
  sellbase.emit_event(uuid, text, text, uuid, jsonb),
  sellbase.next_order_number(uuid),
  sellbase.create_checkout_session(uuid, text, jsonb, jsonb, text, jsonb, jsonb, uuid[], interval),
  sellbase.release_checkout_session(uuid),
  sellbase.release_expired_checkouts(),
  sellbase.place_order_from_checkout(uuid, jsonb),
  sellbase.adjust_inventory(uuid, int, text, text, text, text)
from public;
grant execute on function
  sellbase.create_checkout_session(uuid, text, jsonb, jsonb, text, jsonb, jsonb, uuid[], interval),
  sellbase.release_checkout_session(uuid),
  sellbase.release_expired_checkouts(),
  sellbase.place_order_from_checkout(uuid, jsonb),
  sellbase.adjust_inventory(uuid, int, text, text, text, text)
to service_role;

insert into sellbase.schema_version (version, sellbase_version) values ('0001', '0.1.0');
