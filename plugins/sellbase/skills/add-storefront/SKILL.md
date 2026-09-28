---
name: sellbase-add-storefront
description: Integrate the Sellbase storefront (catalog, product page, cart, checkout, return page, order lookup, downloads, SEO) into the site's existing design, in ANY site - plain HTML, WordPress, Vue, Svelte, Astro, Angular (web components) or Next.js / Vite + React (React components). Use when the site needs to show or sell products or services.
---

# Add the storefront

## Sites without React: web components (any HTML)

Plain HTML, WordPress themes, Webflow embeds, Vue, Svelte, Astro, Angular, etc. `sellbase init` copied `sellbase/sellbase.js`, `sellbase/config.js` and the static admin in `admin/`, into the folder the site serves.

1. In every page's `<head>` (or the layout/template):
   ```html
   <script src="/sellbase/config.js"></script>
   <script type="module" src="/sellbase/sellbase.js"></script>
   ```
2. Place the elements where they belong in the existing design:

   | Element                                                                           | Where                                                                                                           |
   | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
   | `<sellbase-add-to-cart product="<slug>"></sellbase-add-to-cart>`                  | Next to each product (price, options, quantity, button; services show times)                                    |
   | `<sellbase-price product="<slug>"></sellbase-price>`                              | Inline price anywhere                                                                                           |
   | `<sellbase-product slug-param="p"></sellbase-product>`                            | One product page for every product (`producto.html?p=<slug>`); set `productUrl: '/producto.html?p={slug}'`      |
   | `<sellbase-product-grid collection="<slug>" limit="12"></sellbase-product-grid>`  | Catalog sections                                                                                                |
   | `<sellbase-cart-button></sellbase-cart-button>`                                   | Header or nav. The cart drawer is added automatically                                                           |
   | `<sellbase-checkout consent="…" success-url="/gracias.html"></sellbase-checkout>` | A checkout page. Use `consent` for required confirmations such as "Confirmo que soy mayor de 18 años" (alcohol) |
   | `<sellbase-checkout-return></sellbase-checkout-return>`                           | The thank-you page (`success-url`)                                                                              |
   | `<sellbase-order-lookup></sellbase-order-lookup>`                                 | "Mi pedido" page                                                                                                |
   | `<sellbase-download></sellbase-download>`                                         | Downloads page (`?token=`). Then set `download_page_url` to `https://<site>/descargas.html?token={token}`       |

3. **Theme with CSS variables** on `:root` or on the element: `--sellbase-primary`, `--sellbase-primary-text`, `--sellbase-text`, `--sellbase-muted`, `--sellbase-bg`, `--sellbase-surface`, `--sellbase-border`, `--sellbase-radius`, `--sellbase-danger`, `--sellbase-success`. Fonts and text color are inherited. Fine-tune with `::part(button)`, `::part(input)`, `::part(panel)`. The page's own CSS cannot break them (Shadow DOM).
4. **Links:** in `sellbase/config.js` set `productUrl` (e.g. `/productos/{slug}.html`), `checkoutUrl` and `successUrl`; `locale: 'en'` for English.
5. **Your own buttons:** `window.Sellbase.cart.add(variantId, qty)`, `Sellbase.cart.open()` and `Sellbase.onChange(fn)`.
6. **Admin:** the site serves it at `/admin/`, with `#/` routes, so it needs no rewrites. Edit `admin/config.js` for theme and logo.
7. Verify: add to cart → checkout reaches Stripe; then `test_purchase`.

## React sites (Next.js, Vite)

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
