# 0001 — Representación del dinero en TypeScript

**Estado:** aceptada · Fase 0

## Contexto

La regla es dinero en enteros (unidades menores) + ISO 4217. En Postgres es `bigint`. En TS hay que elegir entre `number` y `bigint`.

## Decisión

- En TS los montos son `number` restringidos a **enteros seguros** (`Number.isSafeInteger`, ≤ 9,007,199,254,740,991 unidades menores ≈ 90 billones de MXN). Zod lo valida en cada frontera.
- Las operaciones intermedias (multiplicar, porcentajes, repartos) usan `BigInt` internamente para no perder precisión; el resultado vuelve a `number` y se valida el rango (`INVALID_AMOUNT` si se sale).
- Redondeo **half-up** (0.5 sube) en todos los cálculos.
- Porcentajes y tasas en **basis points** (1000 = 10 %, 1600 = 16 %), igual que `platform_fee_bps`.
- La conversión decimal → unidades menores (`toMinorUnits`) parsea cadenas y **rechaza** decimales de más en lugar de redondear en silencio.

## Por qué

`bigint` no se serializa a JSON ni lo entienden bien los agentes, supabase-js o los formularios; `number` entero cubre cualquier monto real de comercio.

## Consecuencias

supabase-js devuelve `bigint` de Postgres como `number` (o string si excede el rango seguro); los esquemas Zod rechazan lo segundo.
