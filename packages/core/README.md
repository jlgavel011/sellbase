# @sellbase/core

The single source of truth for Sellbase:

- Zod schemas;
- API route contracts (from which the server, OpenAPI, SDK and MCP tools derive);
- money helpers (integers in minor units + ISO 4217);
- pricing, taxes and discounts;
- order state machines;
- the error format (`code`, `message`, `hint`).

You rarely install it directly; `@sellbase/sdk` and the CLI depend on it.

---

Part of [Sellbase](https://github.com/jlgavel011/sellbase), open source commerce that lives inside your project. MIT licensed.
