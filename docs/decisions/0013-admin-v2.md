# ADR 0013 — Admin v2: Shopify-level admin with the Sellbase brand

**Status:** accepted (2026-09-27)

## Context

The first real install (a static landing page) showed that the admin worked but felt like a developer tool: generic look, emoji icons, API wording, photos only after saving, and no abandoned carts or inventory view. For a merchant, the admin _is_ the product.

## Decision

- **Own design system** inside `@sellbase/admin`:
  - tokens scoped to `.sb-admin`, `sba-*` component classes in `@layer components`, an SVG icon set and the Sellbase mark;
  - no global CSS, so the host site is untouched;
  - store themes still override `--sba-primary`, the radius and the font.
- **Shell** following Shopify's model, because merchants already know it:
  - dark top bar with global search (products, orders, customers) and an account menu;
  - side menu with subsections;
  - contextual "unsaved changes" bar, toasts and modals.
- **Product editor:**
  - photos are dropped before the product exists; they upload on save, in order;
  - reorder, alt text and delete (`PATCH /products/:id/media`, `DELETE /products/:id/media/:media_id`);
  - options × values generate the variant matrix;
  - SEO fields and collections are saved with `product_upsert` (`seo`, `collection_ids`).
- **New pages:**
  - Inventory (`GET /inventory`);
  - Abandoned checkouts (`GET /checkouts/abandoned`, `POST /checkouts/:id/recovery-email`, optional automatic email in the jobs);
  - Settings split into sections (General with logo upload, Payments, Shipping, Taxes, Checkout, Notifications with a test email, Team, AI agents, Webhooks, Integrations).
- **Checkout consent is enforced by the server** (migration 0009):
  - `settings.checkout.required_consent`;
  - `checkout_sessions.consents`, copied into `orders.metadata.consents` by a trigger;
  - `GET /storefront/store` exposes it so any storefront can show the checkbox.
- **Cart recovery links** use `?sellbase_cart=<token>`; `@sellbase/web` and `@sellbase/react` restore the cart and clean the URL.
- **Install:** on a local stack, `sellbase init` creates the owner with a password stored in `.env.sellbase`. Hosted projects keep the email invitation.

## Consequences

- The admin bundle grows a little (≈1.3 MB standalone, 40 KB CSS). It is still one static page.
- Pages from before v2 (customers, discounts, collections, agenda, manual order) use the same components, so they already look consistent. They get their own redesign later.
- Recovery emails need `settings.site_url`. The admin asks for it wherever it is missing.
