# 0004 — RLS de solo lectura; toda escritura pasa por la API

**Estado:** aceptada · Fase 1 · Migración: `0001_init.sql`

## Contexto

El §6 dice "CRUD según rol" para staff, y el §4.3 dice "escrituras siempre vía Edge Functions". Si el admin escribiera directo con supabase-js, las reglas de negocio (máquinas de estado, snapshots, auditoría, scopes, idempotencia) tendrían que duplicarse en políticas RLS y triggers, y el admin, la API y el MCP podrían divergir.

## Decisión

- `anon` y `authenticated` solo reciben `SELECT`. RLS filtra las filas:
  - **staff**: todo lo de su tienda; `integrations`, `api_tokens`, `audit_log` y `events` solo owner/admin.
  - **cliente autenticado**: sus pedidos, líneas, pagos, entregas y carritos (`customers.auth_user_id = auth.uid()`).
  - **anon** y clientes: catálogo `active` a través de vistas `storefront_*` (`security_invoker`), con `GRANT` por columna sobre las tablas base (nunca `metadata`).
- Todas las escrituras van por `sellbase-api` con `service_role`, que valida rol o scopes, aplica la lógica de `@sellbase/core` y escribe `audit_log`. Es el mismo camino para admin, agente e integraciones: paridad total.
- Las operaciones que deben ser atómicas (checkout, alta de pedido, inventario) son funciones SQL `security definer` que solo `service_role` puede ejecutar.
- Las máquinas de estado también se validan con triggers en SQL, como segunda barrera.

## Consecuencias

- El admin necesita la API para mutar (ya era así para acciones de dinero).
- Cualquier cliente autenticado puede leer las columnas públicas de productos activos. `metadata` no se expone a `anon` ni a clientes a través de las vistas, pero un cliente autenticado sí puede leer la tabla base `products` de productos activos. **No guardes secretos en `metadata`**: usa tu propio schema.
