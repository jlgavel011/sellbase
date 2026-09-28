---
name: add-ecommerce
description: Turn the user's project into an online store with Sellbase (open source, on their own Supabase). Use when the user wants to sell online, add a shop, cart, checkout, payments, products or an admin to a website or app (Next.js, Vite + React, plain HTML, WordPress, Astro, Vue…), or asks for a Shopify alternative they own.
---

# Add e-commerce with Sellbase

Sellbase installs **inside the user's project and Supabase**:

- no platform fees, and the owner keeps the data;
- catalog (physical, digital and services), Stripe checkout, orders, inventory, abandoned carts, discounts and bookings;
- an admin at `/admin`, an API, and an MCP server so you can operate the store.

## 1. Check the project

- Find the framework: `package.json` with `next` → Next.js; `vite` + `react` → Vite; otherwise any site (web components + static admin).
- Supabase: local needs Docker (`npx supabase init` if there is no `supabase/` folder, then `npx supabase start`). For a hosted project, ask for the project URL and keys and see https://jlgavel011.github.io/sellbase/guides/deploy.html.
- Work on a new git branch so the owner can review.
- Empty folder or no site yet? Start from a template instead: `npx sellbase create <dir> --template nextjs` (or `html`), then follow its README.

## 2. Install

```bash
npx sellbase init --yes --store-name "<store name>" --currency MXN --country MX
```

`init` sets up:

- the `sellbase` schema, Edge Functions, the store and the owner;
- the admin at `/admin` (on a local stack the owner's email and password go to `.env.sellbase`);
- storefront components or web components;
- `CLAUDE.md`/`AGENTS.md`, skills and `.mcp.json`.

After it runs, **restart the MCP server** (or Claude Code) so the `sellbase` tools read `.env.sellbase`.

## 3. Set up the store

Follow the `setup-store` skill and the tools, in this order:

1. `store_status`: see what is missing.
2. Create the products the owner described with `product_upsert`, including photos, prices and stock.
3. Add the storefront to the existing design (skill `add-storefront`) without redesigning the site.
4. Stripe in **test mode**: ask for `sk_test_…`. Never use live keys without the owner's explicit OK.
5. Run `test_purchase` and confirm that the order appears in `/admin`.

## 4. Report back

Tell the owner:

- where the admin is and where the credentials are (`.env.sellbase`, never paste them);
- what is ready;
- what they must do to charge real money (https://jlgavel011.github.io/sellbase/guides/stripe-live.html).

If you hit a Sellbase bug, draft a report with `feedback_draft` and share it only if the owner agrees.
