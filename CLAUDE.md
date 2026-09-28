# CLAUDE.md — Sellbase

> Nombre final: **Sellbase** (decidido el 2026-09-28). Paquetes npm: `sellbase` y `@sellbase/*`.

Estás construyendo **Sellbase**: un kit de comercio **open source, AI-first**, que se instala dentro del proyecto del usuario (su repo + su Supabase) y le da catálogo, checkout, pedidos, entregas, descuentos, notificaciones, un admin en `/admin`, una API y un servidor MCP para que su agente de IA configure y opere todo.

La especificación completa está en `SPEC.md`. **Léela antes de escribir código.** Si algo aquí contradice `SPEC.md`, gana `SPEC.md`; avísalo.

## Cómo trabajar

1. **Trabaja por fases** (ver SPEC §15). No empieces una fase sin que la anterior cumpla sus criterios de aceptación.
2. Antes de cada fase: escribe un plan corto en `docs/plans/<fase>.md`, luego implementa.
3. Cada cambio de esquema = **una nueva migración SQL versionada**. Nunca edites una migración ya publicada.
4. Tests antes de marcar algo como terminado (unit + RLS + e2e donde aplique).
5. Si una decisión no está en el spec y es difícil de revertir, **pregunta**. Si es fácil de revertir, decide, documenta en `docs/decisions/` (ADR corto) y sigue.

## Reglas no negociables

- **Dinero en enteros** (unidades menores: centavos) + código de moneda ISO 4217. Nunca `float`.
- **Todo el esquema vive en el schema de Postgres `sellbase`**, nunca en `public`. El usuario es dueño de `public`.
- **RLS activado en todas las tablas.** Sin excepciones. Cada política tiene test en pgTAP.
- **La `service_role` key nunca llega al navegador.** El cliente usa `anon` + RLS; las escrituras privilegiadas pasan por Edge Functions.
- **Los pedidos nacen del webhook de pago**, nunca del frontend.
- **Todo endpoint que muta acepta `Idempotency-Key`.** Los webhooks se procesan de forma idempotente.
- **Snapshots en pedidos**: precio, título, SKU y dirección se copian al pedido; nunca se leen "en vivo" después.
- **Secretos de terceros** (llaves de Stripe, Resend, envíos) se guardan en **Supabase Vault**, nunca en tablas planas ni en el repo.
- **Validación con Zod** en cada frontera (API, MCP, formularios). Los esquemas Zod viven en `@sellbase/core` y son la única fuente de verdad de tipos.
- **Acciones destructivas o de dinero** (reembolsos, borrados, cambios masivos de precio) requieren confirmación explícita en MCP y quedan en `sellbase.audit_log`.
- **Errores para agentes**: cada error devuelve `code`, `message` legible y `hint` con la siguiente acción concreta.

## Stack

- Monorepo: **pnpm + Turborepo**, TypeScript estricto.
- DB/Auth/Storage/Functions: **Supabase** (Postgres 15+, Edge Functions en Deno con **Hono**).
- Admin y componentes: **React 18+, Tailwind, shadcn/ui, TanStack Query**. El admin es una SPA que se monta en `/admin` de cualquier proyecto (Next.js o Vite).
- Validación: **Zod**. Emails: **React Email + Resend**.
- MCP: **@modelcontextprotocol/sdk** (TypeScript).
- Tests: **Vitest** (unit), **pgTAP** (RLS/SQL), **Playwright** (e2e).

## Comandos (a crear en Fase 0)

```bash
pnpm i                 # instalar
pnpm dev               # playground + admin + supabase local
pnpm test              # unit
pnpm test:db           # pgTAP
pnpm test:e2e          # Playwright
pnpm lint && pnpm typecheck
supabase start         # stack local
```

## Estilo

- Nombres en inglés en código, tablas y API. Documentación de usuario en inglés y español.
- Funciones pequeñas, sin clases salvo adaptadores.
- Nada de `any`. Nada de lógica de negocio en componentes de UI: va en `@sellbase/core`.
- Preferir SQL explícito y legible sobre magia de ORM.
