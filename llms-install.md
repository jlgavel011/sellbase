# Installing Sellbase (for AI agents)

Sellbase is an open source commerce kit that installs **inside the user's project and Supabase**. It includes a catalog, Stripe checkout, orders, inventory, discounts, bookings and an admin at `/admin`. Its MCP server lets you set up and run the store.

## 1. Install Sellbase in the project (once)

Requirements: Node 20+, and Supabase. Locally that means Docker; a hosted Supabase project also works.

```bash
npx supabase init          # only if there is no supabase/ folder
npx supabase start
npx sellbase init --yes    # schema, Edge Functions, store, owner, admin, components, .mcp.json
```

`init` writes `.env.sellbase`, which is gitignored, with:

- `SELLBASE_URL`: the API URL;
- `SELLBASE_API_TOKEN`: a scoped token for the agent;
- the owner's admin email and password (local stack only).

It also registers the MCP server in `.mcp.json` and `.cursor/mcp.json`.

For a hosted Supabase project, pass `--supabase-url`, `--anon-key`, `--service-role-key` and `--db-url`. Guide: https://jlgavel011.github.io/sellbase/guides/deploy.html

## 2. MCP server configuration

When the client runs inside the project folder, no environment variables are needed. The server reads `.env.sellbase` itself:

```json
{
  "mcpServers": {
    "sellbase": {
      "command": "npx",
      "args": ["-y", "sellbase@latest", "mcp"]
    }
  }
}
```

Running it outside the project? Set these variables in `env`:

- `SELLBASE_URL` and `SELLBASE_API_TOKEN`, with the values from `.env.sellbase`;
- `SUPABASE_ANON_KEY` (optional).

Without credentials, the server still starts. The docs tools (`docs_search`) work, and every other tool answers with the install command.

## 3. First steps

1. Call `store_status` to see what is missing, with the next step for each item.
2. Create products with `product_upsert`.
3. Connect Stripe in **test mode** with `integration_connect`. Ask the owner for their `sk_test_…` key, and never use live keys without their explicit OK.
4. Run `test_purchase` until it succeeds, then tell the owner where the admin is (`/admin`) and that the credentials are in `.env.sellbase`.

Actions that move money or delete data require confirmation (`confirm: true`) and are written to the audit log.

Docs for agents: https://jlgavel011.github.io/sellbase/llms.txt
