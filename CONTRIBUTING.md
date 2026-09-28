# Contributing to Sellbase

Thanks for helping. Sellbase is an AI-first commerce kit, so a change is only done when both a person (admin, storefront) and an agent (API, MCP, docs) can use it.

## Setup

Requirements: Node 20+, pnpm 10, Docker (for the local Supabase stack).

```bash
pnpm i
pnpm exec supabase start          # local Postgres, Auth, Storage, Edge Functions
node scripts/seed-demo.mjs        # demo store + agent token in .env
pnpm dev                          # playground on http://localhost:3100 (admin at /admin)
```

Stripe test keys are optional. Put `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (from `stripe listen`) in `.env` to test real checkouts. Never use live keys locally.

## Before opening a pull request

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm test:db              # pgTAP (RLS and SQL)
pnpm test:integration     # API against the local database
pnpm test:e2e             # Playwright (admin, storefront, static site)
pnpm docs:check           # generated docs are up to date (run pnpm docs:build)
pnpm format:check
```

CI runs all of these, plus the acceptance test: a clean project, then `sellbase init`, an agent over MCP and a test purchase.

## Rules that keep Sellbase safe

These come from [`CLAUDE.md`](CLAUDE.md) and [`SPEC.md`](SPEC.md). Pull requests that break them are not merged.

- **Money:** integers in minor units plus an ISO 4217 currency. Never floats.
- **Schema:** everything lives in the `sellbase` Postgres schema, never in `public`.
- **Database changes:**
  - every schema change is a new numbered migration; published migrations are never edited;
  - RLS on every table, with a pgTAP test;
  - every new function gets `revoke execute … from public`.
- **Service role key:** it never reaches the browser.
- **Orders:** they are only created from the payment webhook (or `order_create` for manual sales).
- **Mutations:** every mutating endpoint accepts `Idempotency-Key`.
- **Third-party secrets:** they go to Supabase Vault.
- **Validation:** Zod at every boundary. The schemas live in `@sellbase/core`.
- **Errors:** every error has `code`, `message` and `hint` (the next concrete action for an agent).
- **Money or destructive actions:** they need explicit confirmation and are written to `sellbase.audit_log`.

## Where things go

| Change                                                | Where                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| Types, schemas, API contracts, pricing                | `packages/core`                                                               |
| HTTP handlers (Edge Functions)                        | `packages/api`                                                                |
| Stripe, Resend, shipping adapters                     | `packages/adapters`                                                           |
| Admin UI                                              | `packages/admin` (copy in `texts.ts` / `texts-v2.ts`, in Spanish and English) |
| React storefront components                           | `packages/registry` (copied into user projects)                               |
| Web components for any site                           | `packages/web`                                                                |
| Agent tools                                           | `packages/mcp`                                                                |
| CLI (`init`, `upgrade`, `doctor`…)                    | `packages/cli`                                                                |
| Agent skills and templates installed in user projects | `skills/`, `templates/`                                                       |

Decisions that are hard to reverse get a short ADR in `docs/decisions/`.

## Commits and releases

- Small, focused commits with a clear message.
- Update `CHANGELOG.md` under "Unreleased" when users or their agents need to know. Add a "What your agent should review" note when upgrading needs action.
- Releases are lockstep: `node scripts/release.mjs <version>`, then tag `v<version>` (see `.github/workflows/release.yml`).

## License

By contributing you agree that your contributions are licensed under the MIT License.
