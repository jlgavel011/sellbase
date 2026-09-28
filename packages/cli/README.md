# sellbase

Sellbase is an open source Shopify alternative you drop into your existing project: products, cart, Stripe checkout and an admin for Next.js, Vite + React or any website, on your own Supabase. This CLI installs and maintains it.

```bash
npx supabase start                 # or pass --supabase-url/--anon-key/--service-role-key/--db-url for a hosted project
npx sellbase create my-store --template nextjs   # or --template html: a ready store to start from
npx sellbase init --yes            # schema, Edge Functions, store, owner, admin, components, agent files
npx sellbase doctor                # checklist with the next step for anything missing
npx sellbase upgrade --dry-run     # see what a new version changes
npx sellbase upgrade               # backup, migrations, functions, components (your edits are kept)
npx sellbase add product-grid cart-drawer checkout   # React storefront components into your repo
npx sellbase seed ropa             # example catalog: ropa, curso, consultorio, cafeteria
npx sellbase token create --name "Claude Code"      # API token for an AI agent
npx sellbase mcp                   # MCP server over stdio (init registers it in .mcp.json)
```

On a local stack, `init` creates the store owner and writes the admin password to `.env.sellbase`. For hosted projects, pass `--owner-email` to send an invitation.

---

Part of [Sellbase](https://github.com/jlgavel011/sellbase), open source commerce that lives inside your project. MIT licensed.
