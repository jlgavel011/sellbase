# Changelog

## Unreleased — Phase 2

### What your agent should review

- Run `npx sellbase upgrade --dry-run`, then `npx sellbase upgrade`. Migrations 0003–0008 are additive.
- Tokens created before 0008 keep their scopes; grant `webhooks:write` only to agents that must send data out.
- If you edited storefront components, merge the diffs in `.sellbase/updates/` (skill `upgrade`).
- Storefront: `cart-drawer` and `product-detail` now depend on `cart-lines`, `discount-input` and `variant-picker`. Add them with `npx sellbase add cart-drawer product-detail`. Your edited copies stay as they are, with a diff. The default URLs are `/products/<slug>` and `/collections/<slug>`; pass `hrefFor`/`productHref` if yours differ. Add `<CheckoutReturn />` to your thank-you page (skill `add-storefront`).

- Services and appointments: resources, weekly hours, exceptions, bookings with deposits, reminders and `.ics` invites (migrations 0004–0005).
- Order operations: fulfill with tracking, cancel, refund (full or partial), notes and payment links for balances.
- Admin: sales metrics on Home, Customers (with order and appointment history), Discounts and Collections.
- API: `/reports/summary`, `/customers`, `/discounts`, `/collections`. MCP: `report_summary`, `customers_search`, `discount_upsert`, `collection_upsert`.
- Manual orders (`POST /orders`): paid in cash/transfer/terminal or with a Stripe payment link (migration 0006). Order filters by status, delivery, channel and dates.
- Products: CSV import (our template, Spanish headers or a Shopify export) and bulk publish/archive/price changes with a preview. MCP: `order_create`, `products_import`, `products_bulk`.
- Settings: team invites and roles, API tokens with scopes and an AI agents activity log, outbound webhooks signed with HMAC and retried with backoff (migration 0007). MCP: `webhook_setup`.
- Stripe live mode: live keys need confirmation, automatic webhook endpoint with a pinned API version, account status in the doctor and the admin, and a real-money check (minimum charge refunded automatically). MCP: `payments_live_check`. Guide: `docs/guides/stripe-live.md`.
- `webhooks:write` scope (migration 0008), opt-in for agent tokens; agents confirm each webhook.
- Outbound webhooks never reach private networks: private, loopback, link-local and metadata IPs and internal names are refused on save and before each delivery, and redirects are not followed. `SELLBASE_WEBHOOKS_ALLOW_PRIVATE=true` is for the local stack only; the doctor fails if it is on in a deployed project.
- Agent experience: MCP `docs_search` and `storefront_scaffold`; `sellbase init` also writes `AGENTS.md`, `.cursor/mcp.json` and `.sellbase/manifest.json`; new skills `configure-shipping` and `upgrade`; `sellbase token list|revoke`; `docs/llms.txt`, `llms-full.txt` and a generated API reference.
- `sellbase seed <giro>` and `init --seed` (ropa, curso, consultorio, cafeteria). `sellbase init` supports Vite + React projects (VITE_ env vars, components under `src/`, an admin page to mount at `/admin`).
- `sellbase upgrade`: dry run of pending migrations in a rolled-back transaction, backup of the `sellbase` schema (`supabase db dump`), migrations and functions, components updated only when unedited (edited ones get a diff in `.sellbase/updates/`), refreshed agent files and doctor.
- Storefront (SPEC §12): new components `variant-picker`, `discount-input`, `cart-lines`, `cart-page`, `product-carousel`, `order-status` (return page + order lookup), `download-page` and `product-seo`. Accessibility checked with axe: focus handling, radiogroups and live regions. Public API `GET /storefront/collections`, `POST /storefront/orders/lookup`, `GET /storefront/downloads/:token/info`, and the order summary on the checkout status. Hooks `useCollections`, `useCollection`, `useCheckoutStatus`, `useOrderLookup`, `useDownload`; SEO helpers `productJsonLd`, `productMetadata`, `catalogSitemap`, `sitemapXml`; setting `download_page_url`.

## 0.1.0 — Phase 1 (unreleased)

First working version: a clean Next.js project goes from `npx sellbase init --yes` to a successful test purchase (order + email + download) through an AI agent over MCP.

- Schema `sellbase` (migrations 0000–0002) with RLS on every table, checkout and order functions, Vault secrets, storage buckets and a cron job.
- Edge Functions: `sellbase-api`, `sellbase-webhooks`, `sellbase-jobs`.
- Stripe Checkout (redirect, cards with Apple/Google Pay), manual shipping, Resend emails with React Email templates.
- `@sellbase/sdk`, `@sellbase/react`, storefront components, `@sellbase/admin`, `@sellbase/mcp`, `sellbase` CLI (`init`, `doctor`, `add`, `token create`, `mcp`).

### What your agent should review

- Nothing to migrate: this is the first version.
