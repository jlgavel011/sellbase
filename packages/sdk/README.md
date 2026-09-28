# @sellbase/sdk

Typed client for the Sellbase API, for browsers, servers and agents. Money is always an integer in minor units; use `formatMoney` to display it.

```ts
import { createSellbase, formatMoney } from '@sellbase/sdk';

const sellbase = createSellbase({ url: process.env.SELLBASE_URL! });
const { data } = await sellbase.products.list();
formatMoney(data[0].min_price_amount!, 'MXN'); // "$349.00"

// Admin and agent routes take a staff session or an sb_live_ token:
const admin = createSellbase({ url, token: process.env.SELLBASE_API_TOKEN });
await admin.admin.orders.search({ fulfillment_status: 'unfulfilled' });
```

Errors carry `code`, `message` and `hint` (the next concrete action). SEO helpers are included: `productJsonLd`, `productMetadata`, `catalogSitemap` and `sitemapXml`.

---

Part of [Sellbase](https://github.com/jlgavel011/sellbase), open source commerce that lives inside your project. MIT licensed.
