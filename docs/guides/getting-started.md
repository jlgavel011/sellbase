# Primeros pasos

Sellbase se instala dentro de tu proyecto: tu repo y tu Supabase. No hay servidores de Sellbase de por medio.

Funciona en **cualquier sitio**:

- Next.js o Vite + React: usa componentes de React.
- HTML puro, WordPress, Webflow, Vue, Svelte, Astro, Angular…: usa etiquetas `<sellbase-*>` que se agregan con un solo `<script>`, y el admin se entrega como página estática en `/admin/`.

## Instalar

```bash
npx supabase start          # o un proyecto en la nube con --supabase-url, --anon-key, --service-role-key y --db-url
npx sellbase init --yes     # esquema, Edge Functions, tienda, token del agente, componentes, /admin y archivos del agente
npx sellbase seed ropa      # opcional: catálogo de ejemplo (ropa, curso, consultorio, cafeteria)
```

Después abre tu agente de IA en la carpeta del proyecto y dile: **"Configura mi tienda con Sellbase"**. El agente usa las herramientas MCP (`store_status`, `product_upsert`, `integration_connect`, `test_purchase`…) hasta que una compra de prueba sale bien.

## Qué queda en tu proyecto

| Ruta                                                                               | Qué es                                                        | ¿Lo edito?                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| `supabase/migrations/` (las que lista `.sellbase/manifest.json`)                   | Esquema `sellbase`                                            | No; `sellbase upgrade` las actualiza         |
| `supabase/functions/sellbase-*`                                                    | API, webhooks de pago y tareas en segundo plano               | No                                           |
| `components/sellbase/`                                                             | Componentes de la tienda (catálogo, carrito, checkout, citas) | Sí, son tuyos                                |
| `app/admin/[[...path]]/page.tsx`                                                   | El admin en `/admin`                                          | Solo su `config`                             |
| `CLAUDE.md`, `AGENTS.md`, `.claude/skills/sellbase/`, `.cursor/rules/sellbase.mdc` | Instrucciones para tu agente                                  | Fuera de los marcadores `sellbase:start/end` |
| `.mcp.json`, `.cursor/mcp.json`                                                    | Conexión del agente al servidor MCP                           | No hace falta                                |
| `.env.sellbase`                                                                    | Token del agente (secreto, en `.gitignore`)                   | No lo compartas                              |
| `.env.local`                                                                       | Llaves públicas para el navegador                             | No hace falta                                |

## Revisar el estado

`npx sellbase doctor` (o `store_status` desde el agente) muestra la lista de configuración y el siguiente paso de cada punto pendiente.

## Cobrar

Empieza con llaves de prueba de Stripe (`skills/configure-payments`). Para cobrar de verdad, sigue la guía [stripe-live.md](stripe-live.md).

## Actualizar

`npx sellbase upgrade --dry-run` muestra qué cambiaría; `npx sellbase upgrade` lo aplica con respaldo. Los componentes que editaste no se sobrescriben.
