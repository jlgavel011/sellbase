# 0012 — Universal: cualquier sitio o framework

**Estado:** aceptada · Fase 2 · Código: `packages/web`, `packages/admin/standalone`, `packages/cli/src/init.ts` (`writeWebFiles`), `apps/static-site`

**Contexto:** la primera tienda real es una landing en HTML puro. El usuario lo definió como parte de la esencia de Sellbase: debe funcionar en cualquier sitio (principio 6 del SPEC).

**Decisión**

- **El backend ya era universal:** API HTTP en Supabase, webhooks, jobs y MCP. No cambia.
- **Web Components (`@sellbase/web`):** `<sellbase-*>` sobre un cliente HTTP propio y mínimo, sin Zod ni React.
  - Pesa 42 KB, 13 KB comprimido.
  - Shadow DOM: el CSS del sitio no los rompe, y se tematizan con variables `--sellbase-*` y `::part`. La fuente y el color se heredan.
  - El carrito se comparte con `@sellbase/react` (misma llave de `localStorage`).
  - Configuración: `Sellbase.configure()`, `window.SellbaseConfig` (el `sellbase/config.js` que escribe `init`) o atributos `data-sellbase-*` en el `<script>`. Solo valores públicos.
  - API programática `window.Sellbase` para botones propios.
- **Admin estático:** el mismo `@sellbase/admin` compilado como página independiente (`index.html` + `admin.js` + `styles.css` + `config.js`).
  - Usa rutas con hash (`routing: 'hash'`), así que no necesita reescrituras en el hosting.
  - Las URLs absolutas del admin (retorno de Stripe, invitaciones) salen del router.
- **`sellbase init`:**
  - Next.js y Vite + React siguen igual.
  - Cualquier otro sitio (con o sin `package.json`) recibe `sellbase/sellbase.js`, `sellbase/config.js` y `admin/` en la carpeta que sirve (`public/`, `static/` o la raíz). Los archivos de Sellbase quedan en el manifiesto para `upgrade`.
  - No convierte un sitio estático en proyecto npm.
- **Checkout con consentimiento:** `<sellbase-checkout consent="…">` exige una casilla y envía `consents` con el checkout (p. ej. mayoría de edad para alcohol). Guardarlo y exigirlo del lado del servidor es el siguiente paso; requiere migración y aprobación.

**Consecuencias**

- Los componentes existen dos veces (React y Web Components). La lógica y los precios viven en el servidor; las dos capas solo dibujan.
- El admin estático pesa ~1.1 MB (285 KB comprimido), porque incluye React. Es aceptable para un panel interno.
- **Pruebas:**
  - unitarias de los elementos (jsdom);
  - e2e de `apps/static-site`: carrito, pago con consentimiento, regreso con webhook firmado, búsqueda de pedido, admin con hash y accesibilidad;
  - aceptación `scripts/acceptance-static.mjs`, también en CI.
