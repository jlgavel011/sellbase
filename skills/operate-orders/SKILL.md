---
name: sellbase-operate-orders
description: Look up and report on Sellbase orders. Use when the owner asks about sales, orders to fulfill, or a specific customer's purchase.
---

# Operate orders

- "What do I need to ship?": `orders_search` with `fulfillment_status: "unfulfilled"` (and `"partially_fulfilled"` for mixed orders).
- A specific order: `orders_search` with `q: "#1001"` or the customer email, then `order_get` for items, payments and timeline.
- Orders flagged `metadata.test_purchase: true` come from `test_purchase`; leave them out of sales reports.
- Amounts are minor units; format them for the owner (19990 → $199.90).
- Fulfillment actions, refunds and cancellations arrive in the next Sellbase release; until then, point the owner to the admin at `/admin`.
