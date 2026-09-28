# Sellbase plugin for Claude Code

Sellbase is open source commerce that installs inside your own project and Supabase. This plugin gives Claude Code everything it needs to add a store to any project and then run it:

- the Sellbase skills, including `add-ecommerce`;
- the Sellbase MCP server (`npx -y sellbase@latest mcp`);
- the `/sellbase:setup` command.

With them, Claude Code can:

- add a store to Next.js, Vite + React or any website (plain HTML, WordPress, Astro…);
- create products, connect Stripe in test mode and run a test purchase;
- operate orders, inventory, discounts and shipping afterwards.

## Install

```
/plugin marketplace add jlgavel011/sellbase
/plugin install sellbase@sellbase
/sellbase:setup I sell handmade candles, $250 MXN each, shipping $120
```

The MCP server starts even before Sellbase is installed in a project. In that state, the docs tools work and every other tool answers with the install command (`npx sellbase init --yes`). Actions that move money or delete data always ask the owner first.

Docs: https://jlgavel011.github.io/sellbase/ · Source: https://github.com/jlgavel011/sellbase · License: MIT
