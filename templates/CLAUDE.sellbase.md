<!-- sellbase:start (managed by `sellbase init` / `sellbase upgrade`; edit outside these markers) -->

## Sellbase (commerce)

This project sells with **Sellbase**. The whole store runs in this project's Supabase:

- catalog, cart and checkout;
- orders, digital delivery, bookings and emails;
- discounts, customers and reports.

You operate it through the **`sellbase` MCP server** (`.mcp.json`, `.cursor/mcp.json`).

**Start every store task with the `store_status` tool.** It lists what is missing, with the next step for each item. When unsure how something works, use `docs_search`.

### Where things are

- **Sellbase database migrations** (listed in `.sellbase/manifest.json`) and `supabase/functions/sellbase-*`: the backend. **Do not edit them**; `npx sellbase upgrade` replaces them.
- **Sites without React** (plain HTML, WordPress, Vue, Astro…): `sellbase/sellbase.js` (web components `<sellbase-*>`), `sellbase/config.js` (public URL + anon key) and the static admin in `admin/`. Place the elements in the existing design (skill `add-storefront`).
- **`components/sellbase/`** (`src/components/sellbase/` in Vite projects): storefront components copied into this repo. Edit them freely to match the site. `upgrade` never overwrites your edits; it leaves diffs in `.sellbase/updates/`.
- **Admin sign-in**: locally, `sellbase init` creates the owner; the email and password are in `.env.sellbase` (`SELLBASE_ADMIN_EMAIL`, `SELLBASE_ADMIN_PASSWORD`). Tell the owner where to find them; never paste the password into chat or files that get committed. In a hosted project the owner gets an email invitation (`--owner-email`).
- **What the owner does in the admin** (don't rebuild it): products with photos (drag and drop), variants and inventory; orders, packing slips and refunds; abandoned checkouts with recovery emails; settings for payments (Stripe keys go to Vault from Settings → Payments), shipping, taxes, checkout (store URL, required age/terms checkbox), email (Resend) and integrations.
- **The admin at `/admin`** (`@sellbase/admin`; in Vite, `src/sellbase/admin-page.tsx` still has to be mounted, see `add-storefront`): customize it through its `config` (theme, texts, slots, pages), never by editing the package.
- **`.env.sellbase`**: API URL and the agent token used by the MCP server. **Secret: never print or commit it.**

### Rules

- Money is always an integer in minor units: $199.90 MXN is `19990`. Display it with `formatMoney`.
- Never compute prices, totals or stock in the browser; read them from the API or hooks.
- Orders come from the payment webhook, or from `order_create` for sales made outside the site. To verify the store end to end, run `test_purchase` (test mode only).
- Extend data with `metadata` or tables in your own schema; never alter tables in the `sellbase` schema.
- Never expose the Supabase service role key to the browser; the storefront uses the anon key only.
- **Ask the owner first and send `confirm: true`** for anything that moves money or data:
  - live Stripe keys and `payments_live_check`;
  - refunds and cancellations with refund;
  - bulk price changes;
  - manual orders marked as paid;
  - webhooks that send data to another URL.
- Agent tokens do not have `refunds:write` or `webhooks:write` unless the owner granted them.

### Help improve Sellbase

Sellbase improves through what agents run into. **Draft a report for the maintainers** in these cases:

- **Bug:** an unexpected error, a wrong doc, or a workaround you had to write.
- **Extension:** you built something on top of Sellbase that other stores would need, such as a new field, integration, report or admin page.

How:

1. Call `feedback_draft` (MCP) or run `npx sellbase feedback --kind bug|idea|extension …`.
2. Show the draft to the owner and **ask if they want to share it**.
3. Only then give them the link to submit. Nothing is sent automatically.

Never include customer data, order contents, secrets or private code. The draft is redacted, but you are responsible for what goes in it. Skill: `report-to-sellbase`.

### Skills

`.claude/skills/sellbase/`: `setup-store`, `add-storefront`, `manage-catalog`, `operate-orders`, `configure-payments`, `configure-shipping`, `services-and-bookings`, `upgrade`, `report-to-sellbase`.

### Commands

```bash
npx sellbase doctor              # setup checklist
npx sellbase add <component>     # copy more storefront components
npx sellbase seed <giro>         # example catalog: ropa, curso, consultorio, cafeteria
npx sellbase token list|create|revoke
npx sellbase upgrade --dry-run   # check an update before applying it
npx sellbase feedback --kind bug --title "…" --summary "…"   # draft a report for the maintainers
```

<!-- sellbase:end -->
