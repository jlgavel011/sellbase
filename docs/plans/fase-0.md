# Plan — Fase 0: Cimientos

Referencia: SPEC §15 (Fase 0), §5.6, §8 (pricing), §16.

## Objetivo

Monorepo funcionando con tooling y CI, Supabase local configurado, playground Next.js, y `@sellbase/core` con esquemas Zod, máquinas de estado y cálculo de totales.

## Criterios de aceptación

- `pnpm test` verde (unit) con **30+ casos de pricing**.
- `pnpm test:db` verde en CI (pgTAP).
- `pnpm lint` y `pnpm typecheck` verdes.
- CI corre lint, typecheck, unit, pgTAP y e2e.

## Entregables

### 1. Monorepo

- pnpm workspaces + Turborepo; TypeScript estricto (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- ESLint (flat config, typescript-eslint, `no-explicit-any` = error) + Prettier.
- Vitest en cada paquete; `pnpm test` agrega vía Turbo.
- Solo se crean los paquetes que tienen contenido en esta fase: `packages/core`, `apps/playground`. Los demás (§4.2) se crean en la fase en que se usan, para no dejar cascarones vacíos.

### 2. `@sellbase/core` (puro, sin IO)

- `errors`: `SellbaseError { code, message, hint, details }` + catálogo de códigos.
- `money`: validación de montos (enteros seguros ≥ 0), moneda ISO 4217, dígitos menores por moneda, `formatMoney`, redondeo y reparto proporcional (largest remainder).
- `schemas`: Zod de entidades principales (store, product, variant, specs físicas/digitales/servicio, customer, address, cart, discount, order, order item, payment) y de entradas de API.
- `state`: máquinas de estado de `orders.status`, `fulfillment_status`, `bookings.status`; `payment_status` derivado de montos; `shouldCompleteOrder`.
- `pricing`: `calculateTotals(input)` → subtotal, descuentos (por línea y envío), envío, impuesto (incluido o excluido), total; con reparto del descuento por línea para los snapshots de `order_items`.

### 3. Supabase

- `supabase/config.toml` (schema `sellbase` expuesto a la API).
- Migración `0000_foundation.sql`: schema `sellbase`, extensiones (`citext`, `btree_gist`, `pgtap` solo en tests), función `sellbase.set_updated_at()`, tabla `sellbase.schema_version` con RLS.
- pgTAP: guardas globales que seguirán vigentes en cada fase: **toda tabla de `sellbase` tiene RLS**, toda función fija `search_path` y ninguna es ejecutable por `anon` sin permiso explícito, montos en `bigint`, Sellbase no crea nada en `public`.

### 4. Playground

- Next.js (App Router) mínimo que importa `@sellbase/core` (prueba que el paquete se consume en un app real).
- Playwright con un smoke test.

### 5. CI

- GitHub Actions: `check` (lint, typecheck, unit), `db` (Supabase CLI + `supabase test db`), `e2e` (Playwright).

## Decisiones de esta fase (ADRs en `docs/decisions/`)

- 0001: Dinero como `number` entero seguro en TS (no `bigint`) y redondeo half-up.
- 0002: Reglas de pricing (impuesto incluido/excluido, orden de descuentos, envío gratis, reparto por línea).
- 0003: Numeración de migraciones `NNNN_nombre.sql` y migración `0000_foundation`.
