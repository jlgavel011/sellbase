# Sellbase

**The way your AI adds sales to any app.** Open source, AI-first commerce kit that installs inside your project (your repo + your Supabase): catalog, checkout, orders, fulfillment, discounts, notifications, an admin at `/admin`, an API and an MCP server so your agent can set up and run the store.

> **Status:** Phase 1 (working demo). Not published to npm yet. See [`SPEC.md`](SPEC.md) for the design and roadmap.

**ES:** Kit de comercio open source y AI-first que vive dentro de tu proyecto (tu repo + tu Supabase). Tu agente de IA configura y opera la tienda vía MCP.

## Quick start (Next.js + Supabase)

```bash
npx supabase start              # or use a hosted project with --supabase-url/--anon-key/--service-role-key/--db-url
npx sellbase init --yes         # schema, Edge Functions, store, agent token, components, /admin, CLAUDE.md, skills, .mcp.json
```

Then open your agent in the project and say: **"Configura mi tienda con Sellbase"**. It uses the `sellbase` MCP tools (`store_status`, `product_upsert`, `integration_connect`, `test_purchase`, …) until a test purchase succeeds.

- Admin: `/admin` (customize with `config`: theme, texts, slots, pages).
- Storefront: `components/sellbase/*` (copied into your repo; edit freely) on top of `@sellbase/react`.
- Checklist: `npx sellbase doctor`.

## Development

```bash
pnpm i            # install
pnpm dev          # playground on http://localhost:3100
pnpm test         # unit (Vitest)
pnpm test:db      # pgTAP (needs `pnpm exec supabase start` and Docker)
pnpm test:integration  # API against the local database
pnpm test:e2e     # Playwright (seed first: node scripts/seed-demo.mjs)
node scripts/acceptance.mjs   # Phase 1 acceptance: clean Next.js + init + agent over MCP + test purchase
pnpm lint && pnpm typecheck
```

Layout: `packages/core` (schemas, state machines, pricing, API contracts), `api` (Edge Functions), `adapters` (Stripe, Resend, shipping), `emails`, `sdk`, `react`, `registry` (storefront components), `admin`, `mcp`, `cli` (`sellbase`), `apps/playground`, `supabase/` (migrations + pgTAP), `skills/` and `templates/` (installed into user projects), `docs/plans` and `docs/decisions` (ADRs).

## License

MIT
