<!-- sellbase:start (managed by `sellbase init`; edit outside these markers) -->

## Sellbase (commerce)

This project sells with **Sellbase**: catalog, cart, checkout, orders, digital delivery and emails run in this project's Supabase. You operate the store through the **`sellbase` MCP server** (see `.mcp.json`).

**Start every store task with the `store_status` tool.** It lists what is missing, with the next step for each item.

### Where things are

- `supabase/migrations/0000–0002_*` and `supabase/functions/sellbase-*`: Sellbase schema and Edge Functions. **Do not edit them**; `sellbase upgrade` replaces them.
- `components/sellbase/`: storefront components copied into this repo. Edit them freely to match the site.
- `app/admin/[[...path]]/page.tsx`: the admin (`@sellbase/admin`), customizable through its `config` (theme, texts, slots, pages), never by editing the package.
- `.env.sellbase`: API URL and the agent token used by the MCP server. **Secret: never print or commit it.**

### Rules

- Money is always an integer in minor units: $199.90 MXN is `19990`. Display it with `formatMoney`.
- Never compute prices, totals or stock in the browser; read them from the API/hooks.
- Orders are created only by the payment webhook. To verify the store end to end, run the `test_purchase` tool.
- Extend data with `metadata` or tables in your own schema; never alter tables in the `sellbase` schema.
- Never expose the Supabase service role key to the browser; the storefront uses the anon key only.
- Use Stripe **test** keys until the owner explicitly asks to go live.

### Skills

`.claude/skills/sellbase/`: `setup-store`, `add-storefront`, `manage-catalog`, `operate-orders`, `configure-payments`.

### Commands

```bash
npx sellbase doctor          # setup checklist
npx sellbase add <component> # copy more storefront components
npx sellbase token create    # new API token
```

<!-- sellbase:end -->
