---
name: sellbase-add-storefront
description: Integrate Sellbase storefront components (catalog, product page, cart, checkout, return page, order lookup, downloads, SEO) into the site's existing design, in Next.js or Vite + React. Use when the site needs to show or sell products or services.
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

## 2. Components and pages

| Page                             | Component                                                            | Notes                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Home, landing                    | `<ProductCarousel collection="lo-mas-vendido" />`, `<ProductGrid />` | Carousel scrolls with arrows or touch                                                                                      |
| Collection `/collections/[slug]` | `<ProductGrid collection={slug} />`                                  | Title and description: `useCollection(slug)`                                                                               |
| Product `/products/[slug]`       | `<ProductDetail slug={slug} />`                                      | Includes `variant-picker` (sold-out values crossed out) and, for services, `booking-picker`                                |
| Header and layout                | `<CartButton />`, `<CartDrawer cartHref="/carrito" />`               | The drawer traps focus; Escape closes it                                                                                   |
| Cart `/carrito`                  | `<CartPage />`                                                       | Lines, `discount-input`, totals                                                                                            |
| Checkout `/checkout`             | `<Checkout successPath="/gracias" />`                                | Redirects to pay                                                                                                           |
| Thank you `/gracias`             | `<CheckoutReturn />` (order-status)                                  | Shows "Confirmando tu pago…" until the webhook arrives, then the order. Clears the cart                                    |
| My order `/pedido`               | `<OrderLookup />` (order-status)                                     | Order number + email → status, tracking, appointments                                                                      |
| Downloads `/descargas/[token]`   | `<DownloadPage token={token} />`                                     | Then set `settings.download_page_url` to `https://<site>/descargas/{token}` (`store_update_settings`) so emails link there |

Routes are suggestions. Components take `hrefFor`, `productHref`, `checkoutHref` and `cartHref` to match yours; the default product URL is `/products/<slug>`.

## 3. SEO

- **Product pages:** render `<ProductJsonLd product={product} url={canonical} />` (`product-seo`). For the title and Open Graph tags, use `productMetadata(product, { url, siteName })`: in Next.js return it from `generateMetadata`, loading the product on the server with `createSellbase(...).products.get(slug)`.
- **Sitemap:** `catalogSitemap(sellbase, { baseUrl })` lists every product and collection. Next.js: return it from `app/sitemap.ts`. Vite: write `sitemapXml(entries)` to `public/sitemap.xml` in a build script.

## 4. Admin at /admin

- **Next.js:** already mounted in `app/admin/[[...path]]/page.tsx`.
- **Vite:** mount `src/sellbase/admin-page.tsx` for every path under `/admin`:
  - with React Router, `<Route path="/admin/*" element={<SellbaseAdminPage />} />`;
  - without a router, render it instead of `<App />` in `src/main.tsx` when `location.pathname.startsWith('/admin')`.

  The host must serve `index.html` for `/admin/*`: a SPA fallback, such as Vercel or Netlify rewrites.

## 5. Match the design and verify

- Adapt markup and classes to the site.
- Keep the data flow (hooks), the loading, error and sold-out states, and the accessibility attributes (labels, `aria-live`, radiogroups, focus handling).
- In the browser: browse → add to cart → checkout reaches Stripe. Then run `test_purchase`.
