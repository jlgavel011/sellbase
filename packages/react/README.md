# @sellbase/react

React provider and headless hooks for Sellbase storefronts: products, collections, cart, checkout, order status, downloads and availability for services.

```tsx
import { SellbaseProvider, useProducts, useCart } from '@sellbase/react';

<SellbaseProvider url={process.env.NEXT_PUBLIC_SELLBASE_URL}>
  <Shop />
</SellbaseProvider>;
```

Ready-made components (product grid, product page, cart drawer, checkout, return page…) are copied into your repo with `npx sellbase add`, so you can edit them freely. Cart recovery links (`?sellbase_cart=…`) are restored automatically.

---

Part of [Sellbase](https://github.com/jlgavel011/sellbase), open source commerce that lives inside your project. MIT licensed.
