# Add an ecommerce store to a Next.js app with Supabase

This guide turns an existing Next.js (App Router) project into a store with Stripe checkout and an admin dashboard. It takes about ten minutes. At the end you have:

- a product catalog, product pages with SEO, a cart and Stripe checkout;
- orders created only by the verified Stripe webhook;
- an admin at `/admin` for products, inventory, orders, refunds, discounts and customers;
- an MCP server so your AI agent (Claude Code, Cursor…) can set up and run the store.

Everything lives in **your repo and your Supabase project**: the schema, the API (Supabase Edge Functions) and the storefront components. There is no platform fee and no third-party backend. [Sellbase](https://github.com/jlgavel011/sellbase) is open source (MIT).

> In Spanish: [Agrega una tienda en línea a tu app de Next.js con Supabase](tienda-nextjs-supabase.md).

## Why not build it by hand?

The usual recipe is a `products` table in Supabase, a Server Action that creates a Stripe Checkout Session and a webhook route that writes the order. It works for a first sale. Then the store also needs:

- **inventory**, including stock that is released when a checkout expires;
- **variants**, such as size and color;
- **shipping rates and taxes**;
- **discounts**;
- **refunds**;
- **emails**;
- **an admin for the owner**, so they don't have to edit rows in the Supabase dashboard.

Sellbase is that whole layer, already built and tested:

- RLS on every table, with pgTAP tests;
- money stored as integers;
- idempotent writes;
- Stripe keys kept in Supabase Vault.

## Requirements

- Node 20+.
- A Next.js 15 or 16 project with the App Router.
- Supabase. Locally, that means Docker, so you can run `supabase start`. You can also use a hosted project.
- A Stripe account. Test mode is enough for now.

## 1. Install

From the root of your project:

```bash
npx supabase init            # skip it if you already have supabase/config.toml
npx supabase start
npx sellbase init --yes
```

`sellbase init` does the following:

- **Supabase:** copies the migrations (schema `sellbase`, never `public`) and three Edge Functions, `sellbase-api`, `sellbase-webhooks` and `sellbase-jobs`, then applies them.
- **Store:** creates the store and its owner. Locally, the admin email and password go to `.env.sellbase`, which is gitignored.
- **Storefront:** copies the components into `components/sellbase/`. They are your files to edit.
- **Admin:** adds `components/sellbase/provider.tsx` and `app/admin/[[...path]]/page.tsx`.
- **Environment:** writes the public values to `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SELLBASE_URL`.
- **AI agent:** writes `CLAUDE.md`/`AGENTS.md`, skills and `.mcp.json`.

Want sample products to see it working? Run `npx sellbase seed cafeteria`. The other presets are `ropa`, `curso` and `consultorio`.

For a hosted Supabase project, pass its keys instead of starting the local stack:

```bash
npx sellbase init --yes --supabase-url https://<project>.supabase.co --anon-key … --service-role-key … --db-url … --owner-email you@example.com
```

The service role key is used only during `init`. It is never written to your frontend.

## 2. Wire the provider and the theme

Wrap the app once in `app/layout.tsx`:

```tsx
import { CartButton, CartDrawer } from '@/components/sellbase/cart-drawer';
import { SellbaseStoreProvider } from '@/components/sellbase/provider';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SellbaseStoreProvider>
          <header>
            <a href="/">My store</a>
            <CartButton />
          </header>
          <main>{children}</main>
          <CartDrawer cartHref="/cart" />
        </SellbaseStoreProvider>
      </body>
    </html>
  );
}
```

The admin brings its own full-page layout. If your header shouldn't show on `/admin`, put the store pages in a route group such as `app/(store)/layout.tsx`, as the [example store](https://github.com/jlgavel011/sellbase/tree/main/examples/nextjs-store) does.

Import the theme in your global CSS and set your brand. With Tailwind v4:

```css
@import 'tailwindcss';
@import '../components/sellbase/theme.css';
@source '../components/sellbase';

:root {
  --sb-primary: #3f2a1d; /* buttons and accents */
  --sb-radius: 14px;
}
```

## 3. Add the store pages

```tsx
// app/page.tsx: catalog
import { ProductGrid } from '@/components/sellbase/product-grid';

export default function Home() {
  return <ProductGrid />;
}
```

```tsx
// app/products/[slug]/page.tsx: product page with SEO
import { createSellbase, productMetadata } from '@sellbase/react';
import { ProductDetail } from '@/components/sellbase/product-detail';
import { ProductJsonLd } from '@/components/sellbase/product-seo';

const sellbase = createSellbase({
  url: process.env.NEXT_PUBLIC_SELLBASE_URL!,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
});
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const product = await sellbase.products.get((await params).slug).catch(() => null);
  return product
    ? productMetadata(product, { url: `https://example.com/products/${product.slug}` })
    : {};
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = await sellbase.products.get(slug).catch(() => null);
  return (
    <>
      {product && <ProductJsonLd product={product} url={`https://example.com/products/${slug}`} />}
      <ProductDetail slug={slug} />
    </>
  );
}
```

```tsx
// app/checkout/page.tsx
import { Checkout } from '@/components/sellbase/checkout';
export default function CheckoutPage() {
  return <Checkout successPath="/thanks" cancelPath="/cart" />;
}

// app/thanks/page.tsx: waits for the webhook, shows the order and clears the cart
import { CheckoutReturn } from '@/components/sellbase/order-status';
export default function ThanksPage() {
  return <CheckoutReturn />;
}
```

There is also `<CartPage />` (`cart-page`), `<OrderLookup />` for a "my order" page and `<ProductCarousel />`. The components read everything from the API, so products and prices are never hardcoded.

## 4. Add products and connect Stripe

Run `npm run dev`, open http://localhost:3000/admin and sign in with the credentials in `.env.sellbase`:

1. **Products → Add product:** add photos, a price, variants and stock.
2. **Settings → Payments:** paste your Stripe **test** secret key (`sk_test_…`). It is stored in Supabase Vault.
   - On a deployed project, the Stripe webhook is created for you.
   - Locally, forward it with the Stripe CLI and paste the `whsec_…` it prints:

     ```bash
     stripe listen --forward-to http://127.0.0.1:54321/functions/v1/sellbase-webhooks/stripe
     ```

3. **Test purchase:** buy something with card `4242 4242 4242 4242`. The order appears in **Orders** once the webhook confirms the payment.

`npx sellbase doctor` lists anything still pending, with the next step for each.

### Or let your agent do it

`init` registered the Sellbase MCP server in `.mcp.json`. Open Claude Code or Cursor in the project and say:

> Set up my store with Sellbase: I sell handmade candles, $250 MXN each, shipping $120.

The agent creates the products, connects Stripe in test mode and runs a test purchase until it succeeds. Money and destructive actions always ask you first and are written to the audit log.

## 5. Deploy

- **Frontend:** deploy to Vercel, or any host that runs Next.js, with the three `NEXT_PUBLIC_*` values from your hosted Supabase project. Never set the service role key in the frontend.
- **Backend:** `npx sellbase init` against the hosted project pushes the migrations and deploys the functions.
- **Live payments:** connect the live key from the admin (**Settings → Payments**), so it goes straight to Vault.

Full guides: [deploy](deploy.md) and [live payments with Stripe](stripe-live.md).

## Start from a template instead

```bash
npx sellbase create my-store --template nextjs
cd my-store && npm install && npm run setup && npm run dev
```

It is a complete Next.js 16 + Tailwind store with a Vercel deploy button: [examples/nextjs-store](https://github.com/jlgavel011/sellbase/tree/main/examples/nextjs-store). Using plain HTML, WordPress or Webflow instead of React? Use `--template html`, which uses the `<sellbase-*>` web components.
