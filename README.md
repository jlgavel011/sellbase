# Sellbase

**The way your AI adds sales to any app.** Open source, AI-first commerce kit that installs inside your project (your repo + your Supabase): catalog, checkout, orders, fulfillment, discounts, notifications, an admin at `/admin`, an API and an MCP server so your agent can set up and run the store.

> **Status:** Phase 0 (foundations). Not usable yet. See [`SPEC.md`](SPEC.md) for the full design and roadmap.

**ES:** Kit de comercio open source y AI-first que vive dentro de tu proyecto (tu repo + tu Supabase). Tu agente de IA configura y opera la tienda vía MCP. Estado: Fase 0.

## Development

```bash
pnpm i            # install
pnpm dev          # playground on http://localhost:3100
pnpm test         # unit (Vitest)
pnpm test:db      # pgTAP (needs `pnpm exec supabase db start` and Docker)
pnpm test:e2e     # Playwright
pnpm lint && pnpm typecheck
```

Layout: `packages/core` (Zod schemas, state machines, pricing; pure), `apps/playground` (Next.js demo for e2e), `supabase/` (migrations + pgTAP), `docs/plans` and `docs/decisions` (ADRs).

## License

MIT
