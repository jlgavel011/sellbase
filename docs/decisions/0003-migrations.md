# 0003 — Numeración de migraciones y `0000_foundation`

**Estado:** aceptada · Fase 0

- Migraciones como `supabase/migrations/NNNN_nombre.sql` (cuatro dígitos). La CLI de Supabase acepta cualquier prefijo numérico y ordena por él. Es más legible que timestamps y `sellbase upgrade` compara contra `sellbase.schema_version.version`.
- Cada migración agrega su fila a `sellbase.schema_version`.
- `0000_foundation` crea schema, extensiones, privilegios y helpers. `0001_init` (Fase 1) trae las tablas de negocio, como indica el spec.
- **Privilegios de funciones:** Postgres da `EXECUTE` a `PUBLIC` en cada función nueva y un `alter default privileges in schema` no lo puede quitar. Cada migración hace `revoke execute on function … from public` explícito; el guard pgTAP falla si alguna función queda ejecutable por `anon` fuera de la lista permitida.
- **Guards globales** (`supabase/tests/database/00_guards.test.sql`) revisan el catálogo: RLS en toda tabla, `search_path` fijo en toda función, columnas `*_amount` en `bigint`, trigger `set_updated_at` donde haya `updated_at`, nada en `public`. Aplican solos a cada tabla nueva.
