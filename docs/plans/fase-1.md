# Plan — Fase 1: Demo funcional

Referencia: SPEC §15 (Fase 1), §5, §6, §7, §8, §9, §11, §12, §13, §14.

## Aceptación (del spec)

En un proyecto Next.js limpio, `npx sellbase init --yes` + un prompt al agente produce una compra de prueba exitosa (pedido + email + descarga) en < 10 min. e2e Playwright de compra física y digital.

## Hitos

Cada hito termina con tests verdes y commit propio.

### 1a. Esquema `0001_init` + RLS + pgTAP

- Tablas de §5 para Fase 1: stores, staff_members, api_tokens, audit_log, products, product_media, product_options(+values), variants, physical_specs, inventory_levels, locations, digital_assets, collections(+products), customers, customer_addresses, carts, cart_items, discounts, discount_redemptions, checkout_sessions, inventory_reservations, orders, order_items, payments, refunds, fulfillments, shipments, digital_grants, order_events, events, processed_webhooks, integrations, notification_templates, notifications, idempotency_keys.
- Servicios/citas (resources, availability, booking_holds, bookings) quedan para Fase 2 con su propia migración.
- Helpers `current_store_id()`, `is_staff()`, `has_role()`; vistas `storefront_*`; numeración de pedidos por tienda; checks que espejan las máquinas de estado; stock no negativo con `deny`.
- Funciones transaccionales en SQL: `place_order_from_checkout()` (todo el paso 3 de §8 en una transacción), `adjust_inventory()`, liberar reservas vencidas.
- pgTAP: cada política con casos positivos y negativos.

### 1b. `@sellbase/core` para Fase 1

- Contratos de la API (Zod → OpenAPI 3.1), interfaz `PaymentsAdapter` con `createCheckout` → `{ mode: 'redirect', url } | { mode: 'embedded', client_secret }`, `ShippingAdapter`, `NotifyAdapter`.

### 1c. Edge Functions

- `sellbase-api` (Hono): storefront (productos, carrito, checkout, seguimiento, descargas) + admin básico (productos, pedidos, store, integraciones, doctor). Auth por JWT de staff o `api_token` con scopes; `Idempotency-Key`; rate limit en públicos.
- `sellbase-webhooks`: Stripe (firma + `processed_webhooks`) → `place_order_from_checkout`.
- `sellbase-jobs` (pg_cron): liberar reservas, marcar carritos abandonados, procesar el outbox → entrega digital + email.
- Lógica de negocio en módulos puros que corren en Deno y en Node, para probarla con Vitest.

### 1d. Adaptadores

- `payments/stripe` (Checkout redirigido; tarjeta, Apple/Google Pay y OXXO vía métodos dinámicos), `shipping/manual` (tarifa fija, gratis desde X, recoger en tienda), `notify/resend` + `notify/log` (dev), plantillas React Email: confirmación de pedido y descarga lista.

### 1e. SDK, hooks y componentes

- `@sellbase/sdk`, `@sellbase/react` (`SellbaseProvider`, `useProducts`, `useProduct`, `useCart`, `useCheckout`), registry: `product-grid`, `product-detail`, `cart-drawer`, `checkout`.

### 1f. Admin (`@sellbase/admin`)

- SPA React + Tailwind + shadcn/ui + TanStack Query, montable en `/admin`. Login (magic link + contraseña), Productos, Pedidos, Ajustes → Pagos.
- Personalización sin fork: `createAdmin({ theme, texts, logo, slots, pages })`. Slots de UI con nombre (p. ej. `order.detail.sidebar`) y páginas extra registradas por el usuario.

### 1g. MCP + CLI + e2e de aceptación

- MCP stdio: `store_status`, `product_upsert`, `products_search`, `orders_search`, `order_get`, `test_purchase`.
- CLI: `init` (Next.js + Supabase existente, `--yes`) y `doctor`. Escribe `CLAUDE.md`, skills, `.mcp.json`.
- Playwright: compra física y digital de punta a punta en el playground.

## Dependencias externas

- **Stack Supabase completo** (Auth, Storage, Edge Runtime) para 1c en adelante.
- **Stripe** en modo test (llave secreta + webhook secret) para 1d/1g.
- **Resend** opcional: en dev se usa `notify/log`.
