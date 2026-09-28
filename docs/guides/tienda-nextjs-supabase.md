# Agrega una tienda en línea a tu app de Next.js con Supabase

Esta guía convierte un proyecto de Next.js (App Router) en una tienda con checkout de Stripe y panel de administración, en unos diez minutos. Al terminar tienes:

- catálogo, páginas de producto con SEO, carrito y checkout con Stripe;
- pedidos que solo se crean con el webhook verificado de Stripe;
- un admin en `/admin` para productos, inventario, pedidos, reembolsos, descuentos y clientes;
- un servidor MCP para que tu agente de IA (Claude Code, Cursor…) configure y opere la tienda.

Todo vive en **tu repo y tu proyecto de Supabase**: el esquema, la API (Supabase Edge Functions) y los componentes de la tienda. No hay comisión por venta ni un backend de terceros. [Sellbase](https://github.com/jlgavel011/sellbase) es open source (MIT).

> En inglés: [Add an ecommerce store to a Next.js app with Supabase](nextjs-supabase-ecommerce.md).

## ¿Por qué no hacerlo a mano?

La receta de siempre es una tabla `products` en Supabase, una Server Action que crea la sesión de Stripe Checkout y una ruta de webhook que guarda el pedido. Sirve para la primera venta. Después la tienda también necesita:

- **inventario**, incluido liberar el stock cuando un checkout vence;
- **variantes**, como talla y color;
- **envíos e impuestos**;
- **descuentos**;
- **reembolsos**;
- **correos**;
- **un admin para el dueño**, para no editar filas en el dashboard de Supabase.

Sellbase es esa capa completa, ya hecha y probada:

- RLS en todas las tablas, con pruebas pgTAP;
- dinero guardado en enteros;
- escrituras idempotentes;
- llaves de Stripe guardadas en Supabase Vault.

## Requisitos

- Node 20 o superior.
- Un proyecto de Next.js 15 o 16 con App Router.
- Supabase. En local eso significa Docker, para correr `supabase start`. También sirve un proyecto en la nube.
- Una cuenta de Stripe. Por ahora basta con el modo de prueba.

## 1. Instalar

Desde la raíz de tu proyecto:

```bash
npx supabase init            # sáltalo si ya tienes supabase/config.toml
npx supabase start
npx sellbase init --yes
```

`sellbase init` hace lo siguiente:

- **Supabase:** copia las migraciones (esquema `sellbase`, nunca `public`) y tres Edge Functions, `sellbase-api`, `sellbase-webhooks` y `sellbase-jobs`, y las aplica.
- **Tienda:** crea la tienda y a su dueño. En local, el correo y la contraseña del admin quedan en `.env.sellbase`, que ya está en `.gitignore`.
- **Tienda en tu sitio:** copia los componentes a `components/sellbase/`. Son tuyos y puedes editarlos.
- **Admin:** agrega `components/sellbase/provider.tsx` y `app/admin/[[...path]]/page.tsx`.
- **Variables de entorno:** escribe los valores públicos en `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `NEXT_PUBLIC_SELLBASE_URL`.
- **Agente de IA:** escribe `CLAUDE.md`/`AGENTS.md`, los skills y `.mcp.json`.

¿Quieres productos de ejemplo para verla funcionando? Corre `npx sellbase seed cafeteria`. También hay `ropa`, `curso` y `consultorio`.

Con un proyecto de Supabase en la nube, pasa sus llaves en lugar de levantar el stack local:

```bash
npx sellbase init --yes --supabase-url https://<proyecto>.supabase.co --anon-key … --service-role-key … --db-url … --owner-email tu@correo.com
```

La service role key solo se usa durante `init` y nunca se escribe en tu frontend.

## 2. Conectar el provider y el tema

Envuelve la app una sola vez en `app/layout.tsx`:

```tsx
import { CartButton, CartDrawer } from '@/components/sellbase/cart-drawer';
import { SellbaseStoreProvider } from '@/components/sellbase/provider';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <SellbaseStoreProvider>
          <header>
            <a href="/">Mi tienda</a>
            <CartButton />
          </header>
          <main>{children}</main>
          <CartDrawer cartHref="/carrito" />
        </SellbaseStoreProvider>
      </body>
    </html>
  );
}
```

El admin trae su propio diseño a pantalla completa. Si no quieres que tu header salga en `/admin`, pon las páginas de la tienda en un grupo de rutas como `app/(store)/layout.tsx`, igual que la [tienda de ejemplo](https://github.com/jlgavel011/sellbase/tree/main/examples/nextjs-store).

Importa el tema en tu CSS global y pon tu marca. Con Tailwind v4:

```css
@import 'tailwindcss';
@import '../components/sellbase/theme.css';
@source '../components/sellbase';

:root {
  --sb-primary: #3f2a1d; /* botones y acentos */
  --sb-radius: 14px;
}
```

## 3. Agregar las páginas de la tienda

```tsx
// app/page.tsx: catálogo
import { ProductGrid } from '@/components/sellbase/product-grid';

export default function Home() {
  return <ProductGrid />;
}
```

```tsx
// app/products/[slug]/page.tsx: ficha de producto con SEO
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
    ? productMetadata(product, { url: `https://tusitio.com/products/${product.slug}` })
    : {};
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = await sellbase.products.get(slug).catch(() => null);
  return (
    <>
      {product && <ProductJsonLd product={product} url={`https://tusitio.com/products/${slug}`} />}
      <ProductDetail slug={slug} />
    </>
  );
}
```

```tsx
// app/checkout/page.tsx
import { Checkout } from '@/components/sellbase/checkout';
export default function CheckoutPage() {
  return <Checkout successPath="/gracias" cancelPath="/carrito" />;
}

// app/gracias/page.tsx: espera el webhook, muestra el pedido y vacía el carrito
import { CheckoutReturn } from '@/components/sellbase/order-status';
export default function GraciasPage() {
  return <CheckoutReturn />;
}
```

También están `<CartPage />` (`cart-page`), `<OrderLookup />` para la página "Mi pedido" y `<ProductCarousel />`. Los componentes leen todo de la API, así que productos y precios nunca quedan fijos en el código.

## 4. Productos y Stripe

Corre `npm run dev`, abre http://localhost:3000/admin y entra con los datos de `.env.sellbase`:

1. **Productos → Agregar producto:** fotos, precio, variantes e inventario.
2. **Ajustes → Pagos:** pega tu llave secreta de **prueba** de Stripe (`sk_test_…`). Se guarda en Supabase Vault.
   - En un proyecto desplegado, el webhook de Stripe se crea solo.
   - En local, redirígelo con la CLI de Stripe y pega el `whsec_…` que imprime:

     ```bash
     stripe listen --forward-to http://127.0.0.1:54321/functions/v1/sellbase-webhooks/stripe
     ```

3. **Compra de prueba:** compra con la tarjeta `4242 4242 4242 4242`. El pedido aparece en **Pedidos** en cuanto el webhook confirma el pago.

`npx sellbase doctor` lista lo que falta, con el siguiente paso de cada punto.

### O deja que tu agente lo haga

`init` registró el servidor MCP de Sellbase en `.mcp.json`. Abre Claude Code o Cursor en el proyecto y dile:

> Configura mi tienda con Sellbase: vendo velas artesanales a $250 MXN, envío $120.

El agente crea los productos, conecta Stripe en modo prueba y repite la compra de prueba hasta que sale bien. Todo lo que mueve dinero o borra datos te pide confirmación y queda en la bitácora.

## 5. Publicar

- **Frontend:** en Vercel o cualquier hosting de Next.js, con los tres valores `NEXT_PUBLIC_*` de tu proyecto de Supabase en la nube. Nunca pongas la service role key en el frontend.
- **Backend:** `npx sellbase init` contra el proyecto en la nube sube las migraciones y despliega las funciones.
- **Cobros reales:** conecta la llave live desde el admin (**Ajustes → Pagos**), así va directo a Vault.

Guías completas: [despliegue](deploy.md) y [cobrar de verdad con Stripe](stripe-live.md).

## O empieza desde una plantilla

```bash
npx sellbase create mi-tienda --template nextjs
cd mi-tienda && npm install && npm run setup && npm run dev
```

Es una tienda completa con Next.js 16 y Tailwind, con botón de deploy a Vercel: [examples/nextjs-store](https://github.com/jlgavel011/sellbase/tree/main/examples/nextjs-store). ¿Tu sitio es HTML puro, WordPress o Webflow en lugar de React? Usa `--template html`, que funciona con los componentes web `<sellbase-*>`.
