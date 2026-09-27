---
name: sellbase-add-storefront
description: Integrate Sellbase storefront components (product grid, product page, cart, checkout) into the site's existing design. Use when the site needs to show or sell products.
---

# Add the storefront

Components live in `components/sellbase/` (copied into this repo; edit them freely). They read everything from the API through `@sellbase/react`: never hardcode products or prices.

1. **Provider**: wrap the site once in `SellbaseProvider` (`components/sellbase/provider.tsx` is ready: import it in `app/layout.tsx` around `{children}`).
2. **Theme**: import `components/sellbase/theme.css` in the global CSS and set its variables to the site's colors, radius and fonts. If the components folder is gitignored, add `@source "../components/sellbase";` for Tailwind v4.
3. **Pages** (Next.js App Router):
   - Listing: `<ProductGrid />` (e.g. `app/page.tsx` or `app/shop/page.tsx`).
   - Product: `app/products/[slug]/page.tsx` → `<ProductDetail slug={slug} />`.
   - Cart: `<CartButton />` in the header and `<CartDrawer />` once in the layout.
   - Checkout: `app/checkout/page.tsx` → `<Checkout successPath="/gracias" />`.
   - Thank you: `app/gracias/page.tsx` that calls `useCart().clear()`.
4. **Match the design**: adapt markup and classes to the site; keep data flows (hooks) and the availability/error states.
5. Verify in the browser: browse → add to cart → checkout reaches Stripe. Then run `test_purchase`.

More components: `npx sellbase add product-card product-grid product-detail cart-drawer checkout`.
