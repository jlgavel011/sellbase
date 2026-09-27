---
name: sellbase-add-storefront
description: Integrate Sellbase storefront components (product grid, product page, cart, checkout, booking picker) into the site's existing design, in Next.js or Vite + React. Use when the site needs to show or sell products or services.
---

# Add the storefront

Start with `storefront_scaffold` and the owner's intent (e.g. "tienda de playeras", "citas para mi consultorio"). It returns the components to add and the `npx sellbase add …` command.

Components are copied into this repo, and you can edit them freely:

- Next.js: `components/sellbase/`
- Vite: `src/components/sellbase/`

They read everything from the API through `@sellbase/react`. Never hardcode products or prices.

## 1. Provider and theme

- Wrap the site once in `SellbaseStoreProvider` (`…/components/sellbase/provider.tsx`):
  - **Next.js:** in `app/layout.tsx`, around `{children}`.
  - **Vite:** in `src/main.tsx`, around `<App />`.
- Import `…/components/sellbase/theme.css` once in the global CSS. Set its variables to the site's colors, radius and fonts.
- Tailwind v4: if the components folder is outside what Tailwind scans, add `@source "../components/sellbase";`.

## 2. Pages

| Page      | Next.js (App Router)                                                | Vite (React Router)                                        |
| --------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| Listing   | `app/page.tsx` or `app/productos/page.tsx` → `<ProductGrid />`      | `<Route path="/productos" element={<ProductGrid />} />`    |
| Product   | `app/productos/[slug]/page.tsx` → `<ProductDetail slug={slug} />`   | `<Route path="/productos/:slug" …>` reading the slug param |
| Cart      | `<CartButton />` in the header, `<CartDrawer />` once in the layout | same                                                       |
| Checkout  | `app/checkout/page.tsx` → `<Checkout successPath="/gracias" />`     | `<Route path="/checkout" …>`                               |
| Thank you | `app/gracias/page.tsx`                                              | `<Route path="/gracias" …>`                                |

**Services** (appointments): `<ProductDetail />` already shows `booking-picker` for service products. The buyer picks a time in the store time zone, and it is held while they pay.

**Thank you page:** the buyer can arrive before the payment webhook.

1. Read `sellbase_checkout` from the query string.
2. Poll `sellbase.checkout.status(id)` every 2–3 s while it says `pending`, and show "Confirmando tu pago…".
3. When it says `paid`, show "Pedido #N confirmado" and call `useCart().clear()`.
4. If it says `expired`, offer to go back to the cart.

## 3. Admin at /admin

- **Next.js:** already mounted in `app/admin/[[...path]]/page.tsx`.
- **Vite:** mount `src/sellbase/admin-page.tsx` for every path under `/admin`:
  - with React Router, `<Route path="/admin/*" element={<SellbaseAdminPage />} />`;
  - without a router, render it instead of `<App />` in `src/main.tsx` when `location.pathname.startsWith('/admin')`.

  The host must serve `index.html` for `/admin/*`: a SPA fallback, such as Vercel or Netlify rewrites.

## 4. Match the design and verify

- Adapt markup and classes to the site. Keep the data flow (hooks) and the loading, error and out-of-stock states.
- In the browser: browse → add to cart → checkout reaches Stripe. Then run `test_purchase`.
