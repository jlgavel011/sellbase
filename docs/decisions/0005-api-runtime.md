# 0005 — API como paquete independiente del runtime, empaquetado para Edge Functions

**Estado:** aceptada · Fase 1

## Decisión

- La lógica de `sellbase-api`, `sellbase-webhooks` y `sellbase-jobs` vive en `packages/api` como apps **Hono** con dependencias inyectadas (`sql`, adaptadores, storage, reloj). No usa APIs de Deno ni de Node.
- El acceso a datos es **SQL explícito con `postgres.js`** sobre `SUPABASE_DB_URL` (rol `postgres`, que salta RLS igual que `service_role`). El alcance por tienda lo aplica la API en cada consulta.
- `esbuild` genera un bundle ESM por función en `supabase/functions/sellbase-*/index.js`. Esos archivos son generados: no se editan a mano y el CLI `init` los copia al proyecto del usuario.
- Los tests de integración corren con Vitest en Node contra el Supabase local, llamando a la app con `app.request()`.

## Por qué

- El mismo código se prueba en Node y se ejecuta en Deno, sin import maps.
- Hay transacciones reales para operaciones de varias tablas (p. ej. `product_upsert`).
- Distribuir un archivo por función hace trivial instalar y actualizar (`sellbase upgrade` reemplaza el bundle).

## Consecuencias

- El rate limit en memoria es por isolate. Es suficiente para frenar abusos simples; uno distribuido queda para Sellbase Cloud o una tabla.
- Cada consulta debe filtrar por `store_id`. Los tests multi-tienda lo verifican.
