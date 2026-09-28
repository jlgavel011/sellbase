# Sellbase example: HTML landing page

A static landing page for a coffee shop ("Aurora Café") that sells with Sellbase web components. It uses no framework and no build step:

- `index.html`: hero and `<sellbase-product-grid>`;
- `producto.html`: `<sellbase-product slug-param="p">`, the product page for every product;
- `checkout.html`: `<sellbase-checkout>`;
- `gracias.html`: the order confirmation;
- `pedido.html`: order lookup;
- `/admin`: the store admin (a static page, written by `sellbase init`).

Every page loads `sellbase/config.js` (the store URL and the public anon key) and `sellbase/sellbase.js` (the components). After that, each page sets which of its URLs the components link to:

```html
<script>
  window.SellbaseConfig = {
    ...window.SellbaseConfig,
    productUrl: '/producto.html?p={slug}',
    checkoutUrl: '/checkout.html',
    successUrl: '/gracias.html',
  };
</script>
```

Change colors and fonts with the `--sellbase-*` CSS variables in `styles.css`.

## Run it locally

Requirements: Node 20+ and Docker (for the local Supabase stack).

```bash
npx sellbase create my-landing --template html   # or copy this folder
cd my-landing
npx supabase init && npx supabase start
npx sellbase init --yes --seed cafeteria         # schema, functions, owner, demo catalog, sellbase/ and admin/
npx serve .                                      # any static server works
```

Then:

- **Site:** open the URL `serve` prints.
- **Admin:** open `/admin`. The owner's email and password are in `.env.sellbase`.

## Deploy

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/jlgavel011/sellbase&base=examples/html-landing)

The site is plain files, so it works on any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages, cPanel…):

1. **Install Sellbase in a hosted Supabase project.** Run `npx sellbase init --supabase-url … --anon-key … --service-role-key … --db-url …` from this folder (see the [deploy guide](https://github.com/jlgavel011/sellbase/blob/main/docs/guides/deploy.md)).
2. **Publish the folder.** It must include `sellbase/` and `admin/`, which `init` writes. `config.js` only holds public values (the URL and the anon key).
3. **Connect live payments.** Use the admin (**Settings → Payments**). See [live payments with Stripe](https://github.com/jlgavel011/sellbase/blob/main/docs/guides/stripe-live.md).

## En español

Landing en HTML puro que vende con los componentes web de Sellbase:

1. `npx supabase init && npx supabase start`;
2. `npx sellbase init --yes --seed cafeteria`;
3. sirve la carpeta con cualquier servidor estático.

El admin queda en `/admin`. Para publicarla, sube la carpeta completa (incluye `sellbase/` y `admin/`) a cualquier hosting estático.
