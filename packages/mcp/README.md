# @sellbase/mcp

MCP server so AI agents (Claude Code, Cursor, any MCP client) can set up and run a Sellbase store.

Tools include:

- `store_status`, `product_upsert`, `products_import`, `products_bulk`, `integration_connect`;
- `test_purchase`, `order_action`, `order_refund`, `order_create`;
- `discount_upsert`, `collection_upsert`, `webhook_setup`, `docs_search` and more.

Money and destructive actions require `confirm: true` after the owner agrees, and everything is written to the audit log.

`sellbase init` registers it for you (`.mcp.json`, `.cursor/mcp.json`). To run it by hand:

```bash
SELLBASE_URL=… SELLBASE_API_TOKEN=sb_live_… npx sellbase mcp
```

---

Part of [Sellbase](https://github.com/jlgavel011/sellbase), open source commerce that lives inside your project. MIT licensed.
