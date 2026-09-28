# Sellbase example: Next.js store

A complete coffee shop ("Aurora Café") built with Next.js 16, Tailwind 4 and Sellbase. It includes:

- a home page with a carousel and a product grid;
- product pages with SEO (metadata and JSON-LD);
- a cart drawer and a cart page;
- Stripe checkout and a thank-you page;
- order lookup;
- the admin at `/admin`.

The storefront components in `components/sellbase/` are the same files `sellbase init` copies into any project. They are yours to edit.

## Run it locally

Requirements: Node 20+ and Docker (for the local Supabase stack).

```bash
npx sellbase create my-store --template nextjs   # or copy this folder
cd my-store
npm install
npm run setup     # Supabase local stack + Sellbase schema, functions, owner and demo coffee catalog
npm run dev
```

Then:

- **Store:** open http://localhost:3000.
- **Admin:** open http://localhost:3000/admin. The owner's email and password are in `.env.sellbase`.
- **Payments:** to take test payments, connect Stripe in test mode under **Settings → Payments**, or ask your agent: "Connect Stripe in test mode and run a test purchase".

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](<https://vercel.com/new/clone?repository-url=https://github.com/jlgavel011/sellbase&root-directory=examples/nextjs-store&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,NEXT_PUBLIC_SELLBASE_URL,NEXT_PUBLIC_SITE_URL&envDescription=Public%20values%20from%20your%20Supabase%20project%20(see%20.env.example)&envLink=https://github.com/jlgavel011/sellbase/blob/main/docs/guides/deploy.md>)

1. **Install Sellbase in a hosted Supabase project.** Run `npx sellbase init --supabase-url … --anon-key … --service-role-key … --db-url …` from this folder (see the [deploy guide](https://github.com/jlgavel011/sellbase/blob/main/docs/guides/deploy.md)).
2. **Deploy.** Click the button and paste the public values from `.env.example`. Never paste the service role key: it does not belong in the browser.
3. **Connect live payments.** Use the admin (**Settings → Payments**), which stores the key in Supabase Vault. See [live payments with Stripe](https://github.com/jlgavel011/sellbase/blob/main/docs/guides/stripe-live.md).

## En español

Tienda completa de ejemplo con Next.js y Sellbase. Para correrla:

1. `npm install`;
2. `npm run setup`;
3. `npm run dev`.

La tienda queda en http://localhost:3000 y el admin en `/admin` (el usuario y la contraseña quedan en `.env.sellbase`). Para publicarla usa el botón de Vercel y sigue la [guía de despliegue](https://github.com/jlgavel011/sellbase/blob/main/docs/guides/deploy.md).
