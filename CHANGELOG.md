# Changelog

## Unreleased — Phase 2

- Services and appointments: resources, weekly hours, exceptions, bookings with deposits, reminders and `.ics` invites (migrations 0004–0005).
- Order operations: fulfill with tracking, cancel, refund (full or partial), notes and payment links for balances.
- Admin: sales metrics on Home, Customers (with order and appointment history), Discounts and Collections.
- API: `/reports/summary`, `/customers`, `/discounts`, `/collections`. MCP: `report_summary`, `customers_search`, `discount_upsert`, `collection_upsert`.

## 0.1.0 — Phase 1 (unreleased)

First working version: a clean Next.js project goes from `npx sellbase init --yes` to a successful test purchase (order + email + download) through an AI agent over MCP.

- Schema `sellbase` (migrations 0000–0002) with RLS on every table, checkout and order functions, Vault secrets, storage buckets and a cron job.
- Edge Functions: `sellbase-api`, `sellbase-webhooks`, `sellbase-jobs`.
- Stripe Checkout (redirect, cards with Apple/Google Pay), manual shipping, Resend emails with React Email templates.
- `@sellbase/sdk`, `@sellbase/react`, storefront components, `@sellbase/admin`, `@sellbase/mcp`, `sellbase` CLI (`init`, `doctor`, `add`, `token create`, `mcp`).

### What your agent should review

- Nothing to migrate: this is the first version.
