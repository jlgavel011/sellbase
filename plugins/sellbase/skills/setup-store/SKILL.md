---
name: sellbase-setup-store
description: Set up a Sellbase store from zero until a test purchase succeeds. Use when the user asks to "set up the store", "start selling", or right after `sellbase init`.
---

# Set up the store

Goal: a successful `test_purchase` (order + email + download) with as few questions to the owner as possible.

1. Call `store_status`. Fix every `fail` item first, then `warn` items the owner cares about.
2. **Store basics** (`store_update_settings`): name, contact email, currency, tax (`settings.tax.rate_bps`: 1600 = 16% IVA, `mode: "inclusive"` in Mexico) and shipping (`settings.shipping.flat_rate_amount`, `free_over_amount`, `pickup.enabled`). Ask only for what you cannot infer from the site.
3. **Payments**: follow the `configure-payments` skill. Use Stripe _test_ keys.
4. **Catalog**: follow `manage-catalog`. Create at least one active product; if the store sells files, also a digital product with its file attached.
5. **Verify**: run `test_purchase`. If a step fails, apply its `hint` and run it again.
6. **Storefront**: follow `add-storefront` so the site can sell.
7. Finish by summarizing to the owner: what is live, what is in test mode, and what remains (e.g. switching Stripe to live keys, connecting Resend).

- **Connect other systems** (ERP, sheets, Zapier/Make/n8n): `webhook_setup` with `action: "create"`, the receiving URL and the events it needs. It needs the `webhooks:write` scope, which agent tokens only have if the owner granted it, and `confirm: true` after the owner approved that URL: customer and order data will be sent there. Give the owner the signing secret once so they store it in the receiver, then run `action: "test"`.
