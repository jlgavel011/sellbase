# 0007 — Admin como paquete con puntos de extensión

**Estado:** aceptada · Fase 1 · SPEC §19.3 · Código: `packages/admin`

## Decisión

`@sellbase/admin` se instala como paquete npm y se monta en una ruta catch-all (`/admin/[[...path]]` en Next.js). Nunca se copia ni se edita. La tienda lo personaliza con `AdminConfig`:

- **`theme`**: color primario, texto sobre primario, radio y tipografía (variables `--sba-*`).
- **`texts`**: reemplaza cualquier etiqueta (es/en), p. ej. `{ nav: { orders: 'Ventas' } }`.
- **`logo`**.
- **`slots`**: contenido propio en lugares con nombre (`home.top`, `order.detail.sidebar`, `product.form.bottom`, `sidebar.bottom`, …; lista en `SLOT_NAMES`). Cada slot recibe `{ sellbase, navigate, orderId?, productId? }`.
- **`pages`**: páginas extra en el menú y en el router del admin.

## Detalles

- **CSS aislado**: Tailwind con prefijo `sb:` y sin preflight global; el reset está limitado a `.sb-admin`. Se importa `@sellbase/admin/styles.css` una vez. El admin no depende de la configuración de Tailwind del sitio.
- **Router propio** mínimo bajo `basePath`, para funcionar igual en Next.js, Vite o hosting estático.
- **Escrituras vía API** con el JWT de la sesión de Supabase Auth (ADR 0004); si el usuario no es staff, la API responde 401/403 y el admin lo explica.
- **Primitivas estilo shadcn** propias (sin Radix) para mantener el paquete liviano. Si crece la necesidad de componentes complejos (combobox, date picker), se evalúa Radix.

## Consecuencias

- Actualizar el admin es actualizar el paquete; los puntos de extensión son la API pública y cambiarlos es un cambio semver mayor.
