# Plan — Fase 2 (priorizada)

Referencia: SPEC §15 (Fase 2), §5.2, §5.5, §9, §11, §13, §16.

## Prioridades acordadas (2026-09-27)

1. **Servicios y citas**
2. **Admin completo** (§11 sin marketing ni canales)
3. **Evals del agente** (pausado; ver "Orden acordado después de 2c")

**Pospuesto** mientras Stripe cubre los pagos: MercadoPago, OXXO/SPEI (pagos diferidos) y el agregador de envíos MX. El envío sigue siendo manual (tarifa fija, gratis desde X, recoger en tienda), ahora con guía y rastreo capturados a mano.

## Hitos

Cada hito termina con tests verdes, capturas revisadas y commit propio.

### 2a. Operaciones de pedidos ✅

Base para el admin completo y para cancelar/reembolsar citas.

- API: surtir (envío manual con paquetería, guía y URL de rastreo), cancelar (con reembolso y reposición de stock opcionales), reembolsar (total o parcial, vía Stripe), notas y reenviar la confirmación.
- Acciones de dinero: `confirm: true` obligatorio, `audit_log` y reembolso idempotente con el proveedor.
- Emails: "tu pedido va en camino", reembolso y cancelación.
- Admin: panel de acciones en el detalle de pedido, con resumen del impacto antes de confirmar.
- MCP: `order_action` (fulfill, cancel, note, resend_notification) y `order_refund` (scope `refunds:write`, que los tokens de agente no traen por defecto).

### 2b. Servicios y citas ✅

- Migración `0003_services`: `service_specs`, `resources`, `service_resources`, `availability_rules`, `availability_exceptions`, `booking_holds` (exclusion constraint `tstzrange` + `btree_gist`: sin doble reserva) y `bookings`.
- `@sellbase/core`: cálculo de horarios disponibles (zona horaria de la tienda, cambios de horario, buffers, capacidad, antelación mínima, ventana de reserva), con tests exhaustivos.
- API: `GET /storefront/availability`, citas en el carrito (`booking_slot`), hold de 10 min en el checkout, cita creada por el webhook, anticipos (`pay_mode: deposit`) y saldo con link de pago.
- Operación: reagendar, cancelar (con reembolso), completar, no-show; recordatorios a las 24 h y 2 h (jobs); invitación `.ics` en el email.
- Storefront: componente `booking-picker`. Admin: **Agenda** (calendario por recurso, disponibilidad, excepciones). MCP: `service_setup`, `bookings_search`, `booking_action`.

### 2c. Admin completo ✅

Se entrega en tres partes, cada una con commit propio:

1. ✅ **Datos de negocio**: métricas en Inicio (`GET /reports/summary`), clientes, descuentos y colecciones en API, admin y MCP (`report_summary`, `customers_search`, `discount_upsert`, `collection_upsert`).
2. ✅ **Pedidos y productos**: filtros de pedidos (estado, entrega, canal, fechas), pedido manual cobrado o con link de pago, importar CSV (plantilla, español o Shopify) y acciones masivas con vista previa de precios (ADR 0009).
3. ✅ **Ajustes**: equipo y roles con invitación por correo, tokens de API con permisos, webhooks salientes firmados con reintentos y la bitácora de agentes IA (migración 0007, ADR 0010).

Alcance original:

- Inicio con métricas (ventas de hoy/7/30 días, pedidos por surtir, citas de hoy) sobre `GET /reports/summary`.
- Pedidos: filtros por estado, canal y fecha; pedido manual.
- Productos: importar CSV y acciones masivas (publicar, archivar, precio).
- Colecciones, Clientes (detalle con historial) y Descuentos: CRUD en API, admin y MCP (`collection_upsert`, `customers_search`, `discount_upsert`).
- Ajustes: equipo y roles (invitar por email), API tokens (crear/revocar, scopes), webhooks salientes (endpoints, firma, reintentos) y **Agentes IA** (bitácora de acciones de tokens desde `audit_log`).

### Orden acordado después de 2c (2026-09-27)

El usuario pausó los evals. Antes se termina, en este orden:

1. **2d. Stripe real**: modo live de punta a punta.
   - Conectar llaves live exige `confirm: true`. La integración guarda el modo (`test`/`live`) y el estado de la cuenta (cobros y pagos habilitados, país, moneda).
   - Webhook automático: si la URL pública es https, Sellbase crea el endpoint en Stripe con los eventos que necesita y guarda su secreto en Vault. En local se usa `stripe listen` y se pasa el `webhook_secret`.
   - Versión de la API de Stripe fija en cada llamada.
   - Doctor: modo de prueba o real, cuenta sin activar, webhook sin eventos desde que se conectó. `test_purchase` en live explica que no cobra y remite a la verificación.
   - Verificación live (`POST /integrations/stripe/live-check`): un cobro real del monto mínimo (10 MXN / 0.50 USD), pagado por el dueño, que al llegar el webhook se reembolsa solo y deja la integración marcada como verificada.
   - Admin → Ajustes → Pagos: modo, cuenta, webhook y verificación. MCP: `payments_live_check`. Guía `docs/guides/stripe-live.md`.
   - Prueba real: con las llaves live del usuario, vía `stripe listen --live` en local o en la nube en 2g.
2. ✅ **2e. `sellbase init` + MCP completo + archivos para el agente** (SPEC §13–14), en tres entregas:
   - ✅ **2e-1. MCP y archivos del agente**
     - Herramientas `storefront_scaffold` (componentes según la intención) y `docs_search` (guías, skills y referencia empaquetadas con el MCP).
     - `docs/llms.txt` y `llms-full.txt` generados.
     - `CLAUDE.md` actualizado.
     - `AGENTS.md` para Codex, Cursor y otros.
     - Skills `configure-shipping` y `upgrade`.
     - `.cursor/mcp.json`.
     - `sellbase token list|revoke`.
   - ✅ **2e-2. Giros y Vite**
     - `sellbase seed <giro>` y `init --seed` (ropa, curso digital, consultorio, cafetería).
     - `init` en proyectos Vite + React: variables `VITE_`, provider y página del admin para montar en `/admin`, con instrucciones al agente.
   - ✅ **2e-3. `sellbase upgrade`**
     - Calcula migraciones pendientes con `schema_version`.
     - Respaldo con `pg_dump` del schema `sellbase` si está disponible.
     - Prueba en seco: aplica y hace rollback en una transacción.
     - Aplica y redespliega las functions.
     - Actualiza componentes solo si no fueron modificados (hashes en `.sellbase/manifest.json`); si lo fueron, deja un `.diff`.
     - Refresca skills y reglas, y corre el doctor.
   - Queda para 2g: la conexión OAuth con Supabase (Management API) y `--project-ref`.
3. ✅ **2f. Componentes del storefront** (SPEC §12): el set completo del registry, pulido y probado.
   - **API pública:**
     - `GET /storefront/collections` y `/:slug`.
     - El estado del checkout trae el resumen del pedido cuando ya está pagado.
     - `POST /storefront/orders/lookup` (número + correo, con límite de intentos más estricto).
     - `GET /storefront/downloads/:token/info`.
     - Setting opcional `settings.download_page_url` para que los correos lleven a la página de descargas de la tienda.
   - **SDK y hooks:**
     - `useCollections`, `useCollection`, `useCheckoutStatus` (consulta cada pocos segundos mientras está pendiente), `useOrderLookup` y `useDownload`.
     - Helpers de SEO en el SDK: JSON-LD `Product`/`Offer`, sitemap y metadatos OG.
   - **Registry (nuevos):** `variant-picker`, `discount-input`, `cart-page`, `product-carousel`, `order-status` (página de regreso: confirmando, pagado o expirado, y búsqueda de pedido), `download-page` y `product-seo`. `product-detail` y `cart-drawer` reutilizan `variant-picker` y `discount-input`.
   - **Pulido:** accesibilidad (etiquetas, foco, `aria-live` en estados, navegación con teclado), responsive, estados de carga, error y agotado, y comentarios para la IA en cada componente.
   - **Pruebas:**
     - Integración de la API nueva.
     - Hooks.
     - e2e en el playground: colección, carrusel, variantes, página de carrito con descuento, regreso de pago con webhook firmado (pendiente → pagado), búsqueda de pedido, descarga, sitemap y JSON-LD.
     - Revisión de accesibilidad con axe.
4. ✅ **2f-2. Universal: cualquier sitio o framework** (ADR 0012; pendiente: consentimiento exigido del lado del servidor, que requiere migración 0009) (principio 6 del SPEC; acordado 2026-09-27: "es parte de la esencia de Sellbase").
   - **`@sellbase/web`:** Web Components sobre `@sellbase/sdk`, sin React, con Shadow DOM y tema por variables CSS, publicados como un solo archivo ESM/IIFE.
     - Etiquetas: `sellbase-add-to-cart` (variantes, cantidad, agotado, citas), `sellbase-price`, `sellbase-product-grid`, `sellbase-cart-button`, `sellbase-cart-drawer`, `sellbase-checkout` (con casilla de confirmación configurable, p. ej. 18+), `sellbase-checkout-return`, `sellbase-order-lookup` y `sellbase-download`.
     - Estado del carrito compartido con los componentes React (misma llave de `localStorage`). Configuración con `data-*` en el `<script>` o con `Sellbase.configure()`.
   - **Admin estático:** `@sellbase/admin` también se compila como página independiente (`admin/index.html` + `config.js`). Usa rutas con hash para no necesitar reescrituras en el hosting.
   - **`sellbase init` universal:**
     - Next.js y Vite + React como hoy.
     - Cualquier otro proyecto con `package.json` recibe `@sellbase/web` por npm.
     - Un sitio sin `package.json` recibe `sellbase/sellbase.js`, `sellbase/config.js` y el admin en `admin/`.
     - En todos los casos se escriben los archivos del agente e instrucciones para pegar las etiquetas en el diseño existente.
   - **Pruebas:** unitarias de los componentes; e2e de un sitio HTML puro (carrito, pago, regreso con webhook firmado, admin con hash); aceptación "sitio estático limpio → init → agente → compra de prueba".
   - **Primer caso real:** la landing estática de Mezcal 7 Deseos, en una rama `sellbase`.
5. ✅ **Antes de 2g, bloqueo de webhooks a redes privadas** (`net-guard.ts`, ADR 0010):
   - Se valida al guardar y al enviar; se resuelve DNS y no se siguen redirecciones.
   - En local, `SELLBASE_WEBHOOKS_ALLOW_PRIVATE=true`; el doctor falla si esa variable queda activa en la nube.
6. **2f-3. Admin v2, nivel Shopify con marca Sellbase** (pedido 2026-09-27, tras probar la landing de Mezcal: "el administrador debe ser como Shopify … ni me deja subir fotos"). Decidido en modo autónomo:
   - **Diseño propio de Sellbase:**
     - tokens de color, radio y sombra;
     - íconos SVG en lugar de emojis;
     - barra superior con la marca y búsqueda, y menú lateral con subsecciones;
     - avisos flotantes (toast) y barra de "cambios sin guardar";
     - textos para el comerciante: los checks del doctor se muestran con copy del admin, sin rutas de API.
   - **Productos:**
     - lista con pestañas por estado, miniaturas, existencias y filtros;
     - editor en dos columnas: fotos con arrastrar y soltar (antes de guardar), reordenar, texto alternativo y borrar; opciones y matriz de variantes; precio comparado; inventario; envío; SEO con vista previa; colecciones y etiquetas; archivos digitales; datos de servicio.
     - API: `DELETE /products/:id/media/:media_id` y `PATCH /products/:id/media` (orden y alt); `seo` y `collection_ids` en `product_upsert`.
   - **Inventario:** `GET /inventory` (búsqueda y poco stock) y página con ajuste en línea.
   - **Pedidos:**
     - pestañas (por preparar, sin pagar, abiertos, cerrados);
     - detalle con cliente, pago, envío, comentarios en el historial y hoja de empaque imprimible.
   - **Carritos abandonados:**
     - `GET /checkouts/abandoned` y `POST /checkouts/:id/recovery-email`;
     - correo de recuperación;
     - envío automático opcional desde los jobs;
     - la tienda restaura el carrito con `?sellbase_cart=<token>` (web components y React).
   - **Ajustes organizados:**
     - secciones: General (logo con `POST /store/logo`), Pagos, Envíos, Impuestos, Checkout (consentimiento obligatorio, URL de la tienda, página de descargas, carritos abandonados), Notificaciones (Resend y correo de prueba), Equipo, Agentes IA, Webhooks e Integraciones;
     - guía de configuración en Inicio.
   - **Consentimiento del lado del servidor** (migración 0009):
     - `checkout_sessions.consents`;
     - la tienda puede exigirlo (`settings.checkout.required_consent`) y el checkout lo valida;
     - queda copiado en `orders.metadata.consents`;
     - `GET /storefront/store` lo expone junto con el nombre y el logo.
   - **Instalación:** `sellbase init` crea al dueño (local: usuario + contraseña en `.env.sellbase`; nube: invitación por correo).
7. **2g. Instalación en un Supabase en la nube**: `sellbase init` contra un proyecto real (migraciones, functions, secretos, cron) y compra de prueba.
   - **Acordado (2026-09-27):**
     - Proyecto de Supabase **nuevo** creado por el usuario solo para esta prueba.
     - La llave live de Stripe **no va en archivos**: el usuario la conecta desde el admin (Ajustes → Pagos), queda en Vault y se prueba el flujo real con la verificación live.
8. **2h. Evals del agente**: se construyen después. **Solo corren cuando el usuario lo pide**; nada automático ni semanal en CI.

Evals (cuando toque): `evals/` con 10+ escenarios (tienda física, curso digital, consultorio con citas, mixta, errores recuperables), agente real en un proyecto limpio, verificador vía `test_purchase` y `doctor`, métricas de éxito, tool calls y tiempo. Meta ≥ 80 %.

## Decisiones pendientes

- **Evals**: cómo corre el agente (Claude Agent SDK con API key, o Claude Code en modo headless) y el presupuesto por corrida. Se decide al llegar a 2h. Nunca programados.
