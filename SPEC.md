# Sellbase — Especificación de producto y técnica (v0.1)

> Nombre provisional. Documento pensado para que Claude Code diseñe e implemente el producto por fases.

---

## 1. Visión

**Sellbase es la forma en que tu IA agrega ventas a cualquier app.**

Hoy cualquiera genera una landing con IA en minutos, pero casi nadie vende desde ella: falta catálogo, carrito, checkout, pedidos, envíos, entregas digitales, citas y notificaciones. Sellbase es un **kit de comercio open source** que se instala **dentro del proyecto del usuario** (su repo + su Supabase) y deja todo eso resuelto, con un admin en `/admin` y un servidor MCP para que su agente (Claude Code, Cursor, etc.) configure y opere la tienda.

### Promesa medible
> De `npx sellbase init` a una **compra de prueba exitosa** (pedido creado + email enviado + entrega generada) en **menos de 10 minutos**, sin tocar el admin.

### Principios
1. **AI-first**: todo lo que hace el admin lo puede hacer el agente (paridad total API/MCP/admin).
2. **Tus datos, tu infraestructura**: vive en el Supabase del usuario; nosotros no alojamos sus datos.
3. **Siempre el mismo núcleo**: el mismo esquema, las mismas APIs y el mismo admin en cada instalación; el frente es 100% libre.
4. **Defaults perfectos, todo sobrescribible**: funciona sin configurar; al ser open source, todo se puede cambiar.
5. **Seguro por defecto**: RLS en todo, secretos en Vault, pedidos nacen del webhook.
6. **Universal**: funciona en cualquier sitio: HTML puro, WordPress, Webflow, Vue, Svelte, Astro, Angular, Next.js o Vite. El backend son servicios HTTP en Supabase. En el navegador se integra con Web Components (`@sellbase/web`, un `<script>`), y el admin se entrega como página estática. React es una opción, no un requisito.

### Qué NO es (non-goals v1)
- No es un constructor de sitios ni un theme engine: el frente lo genera la IA del usuario.
- No es un marketplace multi-vendedor.
- No es un ERP ni un WMS.
- No custodia dinero: los pagos van directo a la cuenta del comercio.

---

## 2. Usuarios

| Persona | Qué quiere | Cómo usa Sellbase |
|---|---|---|
| **Constructor con IA** (founder, creador, vibe coder) | Que su landing venda ya | `npx sellbase init` + le pide todo a su agente |
| **Dueño/operador** (puede no ser técnico) | Ver pedidos, cargar productos, surtir | Admin en `/admin` desde celular o compu |
| **Agencia / dev** | Instalarlo en muchos proyectos de clientes | CLI, plantillas, marca blanca |
| **Agente de IA** | Herramientas claras, sin ambigüedad | MCP + skills + `CLAUDE.md` en el repo |

---

## 3. Alcance funcional

Cuatro módulos, más una capa transversal:

1. **Productos (catálogo)**: físicos, digitales y servicios/citas en un solo modelo.
2. **Checkout**: carrito, descuentos, métodos de pago, anticipos.
3. **Pedidos**: registro central; incluye **entrega** (envío, descarga, cita) y **notificaciones** en su ciclo de vida.
4. **Integraciones**:
   - **Canales de venta (entrada)**: Google Merchant, catálogo de WhatsApp/Meta, Mercado Libre, agentes de compra (fase posterior).
   - **Servicios de operación (salida)**: pagos, envíos, email/WhatsApp transaccional, calendario, facturación CFDI (fase posterior).

**Capa transversal**: API pública, SDK, componentes de storefront, admin, MCP, CLI, eventos/webhooks, auditoría.

**Email marketing** (v2): contactos con consentimiento, segmentos, campañas y automatizaciones (carrito abandonado, post-compra, "volvió a stock"). En v1 solo transaccional + carrito abandonado.

---

## 4. Arquitectura

### 4.1 Planos

```
┌──────────────────────── Repo del usuario ─────────────────────────┐
│  Sitio (Next.js / Vite / lo que sea, hecho por su IA)              │
│   ├─ Componentes Sellbase copiados al repo (grid, PDP, carrito…)   │
│   ├─ /checkout  (componente de checkout)                           │
│   └─ /admin     (SPA del admin de Sellbase, montada en su URL)     │
│  CLAUDE.md + .claude/skills/sellbase/*  + config MCP               │
└───────────────┬────────────────────────────────────────────────────┘
                │ supabase-js (anon + RLS)   │ fetch → API
┌───────────────▼──── Supabase del usuario ─▼────────────────────────┐
│  Postgres schema `sellbase` (tablas, vistas, funciones, RLS)       │
│  Edge Functions: sellbase-api · sellbase-webhooks · sellbase-jobs  │
│  Storage: sellbase-media (público) · sellbase-digital (privado)    │
│  Vault: secretos de proveedores · pg_cron: jobs                    │
└───────────────┬────────────────────────────────────────────────────┘
                │ adaptadores
   Stripe · MercadoPago · Resend · Envíos (agregador) · Google · Meta
```

**Opcional (Sellbase Cloud, de pago)**: servicios que requieren servidores o contratos nuestros (tarifas de envío negociadas, sincronización de canales, MCP remoto hosteado, actualizaciones asistidas). Se activa con `SELLBASE_CLOUD_KEY`. **Todo el kit funciona sin Cloud.**

### 4.2 Monorepo

```
sellbase/
├─ apps/
│  ├─ playground/          # sitio demo Next.js que consume todo (para e2e)
│  └─ docs/                # docs públicas + llms.txt
├─ packages/
│  ├─ core/                # Zod schemas, tipos, máquinas de estado, cálculo de totales (puro, sin IO)
│  ├─ sdk/                 # cliente TS tipado de la API (browser + server)
│  ├─ react/               # hooks headless (useCart, useProduct, useCheckout…)
│  ├─ registry/            # componentes estilo shadcn que el CLI COPIA al repo del usuario
│  ├─ admin/               # SPA del admin (React), montable en /admin
│  ├─ mcp/                 # servidor MCP (stdio local; remoto después)
│  ├─ cli/                 # `sellbase init | upgrade | doctor | seed | mcp | token`
│  ├─ adapters/            # payments/*, shipping/*, notify/*, tax/*, channels/*
│  └─ emails/              # plantillas React Email
├─ supabase/
│  ├─ migrations/          # SQL versionado: 0001_init.sql, 0002_…
│  ├─ functions/           # sellbase-api, sellbase-webhooks, sellbase-jobs
│  ├─ tests/               # pgTAP
│  └─ seed.sql
├─ skills/                 # Agent Skills que el CLI copia a .claude/skills/sellbase
└─ templates/              # CLAUDE.md del usuario, ejemplos por giro
```

### 4.3 Decisiones clave
- **Admin como SPA** que habla con Supabase (anon + RLS) y con `sellbase-api`. Así funciona igual en Next.js, Vite/Lovable o cualquier host estático. El CLI crea la ruta de montaje según el framework detectado.
- **Componentes copiados, no importados** (modelo shadcn): el storefront vive en el repo del usuario y la IA lo modifica libremente. La lógica sí se importa de `@sellbase/react` y `@sellbase/sdk` para poder actualizarla.
- **Un solo store por instalación** en v1, pero **todas las tablas llevan `store_id`** para soportar multi-tienda (agencias) sin migración dolorosa.
- **Lecturas públicas** vía vistas `sellbase.storefront_*` con RLS; **escrituras** siempre vía Edge Functions.

---

## 5. Modelo de datos

Schema de Postgres: `sellbase`. Convenciones:
- PK `id uuid default gen_random_uuid()`; `created_at`, `updated_at timestamptz` con trigger.
- Dinero: `*_amount bigint` + `currency char(3)`.
- Extensibilidad: columna `metadata jsonb not null default '{}'` en entidades principales. **Los usuarios y sus agentes extienden vía `metadata` o tablas propias en otro schema; nunca alteran tablas de `sellbase`.**
- `store_id uuid not null references sellbase.stores` en todas las tablas de negocio.

### 5.1 Tienda, equipo y acceso
- **stores**: `name, slug, default_currency, default_locale, timezone, country, contact_email, logo_url, settings jsonb, platform_fee_bps int default <valor del proveedor>`.
- **staff_members**: `user_id → auth.users, role ('owner'|'admin'|'staff')`. Único por (store, user).
- **api_tokens**: `name, token_hash, prefix, scopes text[], created_by, last_used_at, expires_at, revoked_at`. Tokens tipo `sb_live_…`; se guarda solo el hash.
- **audit_log**: `actor_type ('staff'|'token'|'system'|'webhook'), actor_id, action, entity, entity_id, diff jsonb, ip, created_at`.
- **schema_version**: `version text, applied_at, sellbase_version text`.

### 5.2 Catálogo
- **products**: `type ('physical'|'digital'|'service'), title, slug, description (markdown), status ('draft'|'active'|'archived'), seo jsonb, tags text[], metadata`.
- **product_media**: `product_id, variant_id null, storage_path, url, alt, position, kind ('image'|'video')`.
- **product_options**: `product_id, name` (ej. Talla) · **product_option_values**: `option_id, value`.
- **variants**: `product_id, sku, title, option_values jsonb, price_amount, compare_at_amount, currency, status, position`. Todo producto tiene al menos una variante (la "default").
- **physical_specs** (1:1 con variante física): `weight_g, length_cm, width_cm, height_cm, requires_shipping bool, hs_code null`.
- **inventory_levels**: `variant_id, location_id, on_hand int, reserved int, policy ('deny'|'continue')`. Disponible = `on_hand - reserved`.
- **locations**: `name, address jsonb, is_default`.
- **digital_assets**: `variant_id, storage_path (bucket privado), file_name, size_bytes, download_limit int null, link_ttl_hours int default 72, license_template text null`.
- **service_specs** (1:1 con variante de servicio): `duration_min, buffer_before_min, buffer_after_min, capacity int default 1, deposit_amount null, location_type ('in_person'|'online'), online_meeting_url null, booking_window_days, min_notice_min`.
- **resources**: `name, kind ('staff'|'room'|'equipment'), calendar_sync jsonb null`. **service_resources**: relación N:M.
- **availability_rules**: `resource_id, weekday, start_time, end_time, timezone`. **availability_exceptions**: `resource_id, starts_at, ends_at, kind ('closed'|'open')`.
- **collections**: `title, slug, description, rule jsonb null (colecciones automáticas), position`. **collection_products**: `collection_id, product_id, position`.

### 5.3 Clientes
- **customers**: `email (citext), phone, first_name, last_name, auth_user_id null, accepts_marketing bool, marketing_consent_at, locale, metadata`. Único por (store, email).
- **customer_addresses**: `customer_id, label, line1, line2, city, state, postal_code, country, phone, is_default`.

### 5.4 Carrito, descuentos y checkout
- **carts**: `customer_id null, email null, currency, status ('open'|'converted'|'abandoned'|'expired'), expires_at, recovered_at, token (público, opaco)`.
- **cart_items**: `cart_id, variant_id, quantity, booking_slot jsonb null (para servicios: {resource_id, starts_at})`.
- **discounts**: `code null (null = automático), kind ('percent'|'fixed'|'free_shipping'), value, applies_to jsonb (todo | productos | colecciones), min_subtotal_amount, usage_limit, per_customer_limit, starts_at, ends_at, status`.
- **discount_redemptions**: `discount_id, order_id, customer_id`.
- **checkout_sessions**: `cart_id, provider, provider_session_id, amount_total, currency, pay_mode ('full'|'deposit'), status ('open'|'completed'|'expired'), shipping_selection jsonb, totals_snapshot jsonb, expires_at`.
- **inventory_reservations**: `checkout_session_id, variant_id, location_id, quantity, expires_at`.
- **booking_holds**: `checkout_session_id, variant_id, resource_id, starts_at, ends_at, expires_at`. Con **exclusion constraint** (`tstzrange` + `btree_gist`) para impedir doble reserva.

### 5.5 Pedidos
- **orders**: `number (secuencial legible por tienda, ej. #1001), channel ('web'|'admin'|'whatsapp'|'google'|'mercadolibre'|'api'|'agent'), customer_id, email, phone, currency, subtotal_amount, discount_amount, shipping_amount, tax_amount, total_amount, amount_paid, amount_refunded, status, payment_status, fulfillment_status, shipping_address jsonb (snapshot), billing_address jsonb, notes, placed_at, cancelled_at, cancel_reason, metadata`.
- **order_items**: `order_id, variant_id, product_type, title, variant_title, sku, unit_price_amount, quantity, discount_amount, total_amount, fulfillment_type ('shipment'|'digital'|'booking'|'none'), metadata`. **Todo es snapshot.**
- **payments**: `order_id, provider, provider_payment_id, method ('card'|'oxxo'|'spei'|'mercadopago'|'paypal'|'cash'|…), kind ('charge'|'deposit'|'balance'), amount, status ('pending'|'succeeded'|'failed'|'expired'), raw jsonb`.
- **refunds**: `payment_id, amount, reason, provider_refund_id, status, created_by`.
- **fulfillments**: `order_id, type ('shipment'|'digital'|'booking'), status, items jsonb`.
  - **shipments**: `fulfillment_id, carrier, service, tracking_number, tracking_url, label_url, rate_amount, status ('label_created'|'in_transit'|'delivered'|'exception'|'returned'), events jsonb`.
  - **digital_grants**: `fulfillment_id, digital_asset_id, customer_id, token_hash, downloads_used, expires_at`.
  - **bookings**: `fulfillment_id, variant_id, resource_id, customer_id, starts_at, ends_at, status ('confirmed'|'completed'|'no_show'|'cancelled'|'rescheduled'), meeting_url, calendar_event_ids jsonb`.
- **order_events**: línea de tiempo visible en el admin (`type, message, data, actor`).

### 5.6 Máquinas de estado (en `@sellbase/core`, espejadas en SQL con checks)

**orders.status**: `pending_payment → open → completed` · `→ cancelled` (desde pending_payment u open).
**payment_status**: `unpaid → partially_paid (anticipo) → paid → partially_refunded → refunded`.
**fulfillment_status**: `unfulfilled → partially_fulfilled → fulfilled`.
Un pedido pasa a `completed` cuando está `paid` y `fulfilled` (o en servicios, cuando todas las citas están `completed`).

**bookings.status**: `confirmed → completed | no_show | cancelled`; `rescheduled` crea una booking nueva enlazada.

Las transiciones inválidas lanzan error `INVALID_TRANSITION` con `hint`.

### 5.7 Eventos, webhooks y automatizaciones
- **events** (outbox): `type, entity, entity_id, payload jsonb, created_at, processed_at`. Se insertan en la **misma transacción** que el cambio de negocio.
- **webhook_endpoints**: `url, secret (Vault), event_types text[], status`. **webhook_deliveries**: `endpoint_id, event_id, attempt, status_code, next_retry_at`.
- **automations** (v1 fijas, v2 configurables): `trigger_event, conditions jsonb, actions jsonb, enabled`.
- Catálogo de eventos v1: `product.created|updated|archived`, `inventory.low`, `cart.abandoned`, `checkout.completed`, `order.created|paid|cancelled|completed`, `payment.succeeded|failed`, `refund.created`, `fulfillment.created`, `shipment.updated|delivered`, `digital.granted`, `booking.confirmed|reminder_due|cancelled|rescheduled`, `customer.created`.

### 5.8 Integraciones y notificaciones
- **integrations**: `provider ('stripe'|'mercadopago'|'resend'|'shipping_<x>'|'google_merchant'|'whatsapp'|'google_calendar'|…), kind ('payments'|'shipping'|'notify'|'channel'|'calendar'|'tax'|'invoicing'), status ('connected'|'error'|'disabled'), config jsonb (no secretos), secret_ref (id en Vault), connected_at, last_error`.
- **notification_templates**: `event_type, channel ('email'|'whatsapp'|'sms'), locale, subject, body (React Email key o MJML), enabled`.
- **notifications**: `event_id, channel, to, template, status, provider_message_id, error`.

---

## 6. Seguridad (RLS y accesos)

Helpers SQL (`security definer`, `search_path` fijo):
- `sellbase.current_store_id()`, `sellbase.is_staff(store_id)`, `sellbase.has_role(store_id, role)`.

Políticas:
| Tabla / vista | anon | cliente autenticado | staff |
|---|---|---|---|
| `storefront_products`, `storefront_collections`, `storefront_variants` (vistas) | leer solo `active` | igual | todo |
| products, variants, inventory… (tablas) | ✗ | ✗ | CRUD según rol |
| carts / cart_items | solo vía API con `cart.token` | propios | leer |
| orders, payments, fulfillments | ✗ | leer propios (`customers.auth_user_id = auth.uid()`) | CRUD según rol |
| digital_assets / bucket privado | ✗ | solo vía URL firmada de `digital_grants` | leer |
| integrations, api_tokens, audit_log | ✗ | ✗ | owner/admin |

Reglas extra:
- Escrituras de checkout/pedidos **solo** vía Edge Functions con `service_role`.
- Webhooks: verificación de firma del proveedor + tabla `processed_webhooks(provider, event_id)` para idempotencia.
- Rate limit en `sellbase-api` para endpoints públicos (carrito/checkout).
- Tokens de agente con **scopes**: `catalog:read|write`, `orders:read|write`, `refunds:write`, `customers:read`, `discounts:write`, `settings:write`, `integrations:write`. Tokens de agente **no** tienen `refunds:write` por defecto.
- **Cada política tiene test pgTAP**, incluidos los tests negativos (anon no puede leer pedidos, un cliente no ve pedidos de otro, un producto `draft` no aparece en el storefront).

---

## 7. API pública (`sellbase-api`, Edge Function con Hono)

- Base: `https://<project>.supabase.co/functions/v1/sellbase-api/v1`
- Auth: `Authorization: Bearer <api_token>` (admin/agente) · endpoints de storefront son públicos con `cart_token`.
- Formato: JSON, `snake_case`, paginación por cursor (`?limit=&cursor=`), `Idempotency-Key` en POST/PATCH.
- Errores: `{ "error": { "code": "OUT_OF_STOCK", "message": "…", "hint": "…", "details": {} } }`.
- Se genera **OpenAPI 3.1** desde los esquemas Zod; el SDK y las herramientas MCP se derivan del mismo contrato.

### Storefront (público)
- `GET /storefront/products` · `GET /storefront/products/:slug` · `GET /storefront/collections/:slug`
- `GET /storefront/availability?variant_id=&from=&to=` (slots de servicios)
- `POST /storefront/carts` · `GET /storefront/carts/:token` · `POST /storefront/carts/:token/items` · `PATCH|DELETE /storefront/carts/:token/items/:id`
- `POST /storefront/carts/:token/discounts` · `DELETE …/discounts/:code`
- `POST /storefront/carts/:token/shipping-rates` (cotiza con dirección)
- `POST /storefront/checkout` → `{ checkout_url | client_secret, checkout_session_id }`
- `GET /storefront/orders/:number?email=` (seguimiento para invitado, con token)
- `GET /storefront/downloads/:grant_token` → redirect a URL firmada

### Admin / agente (autenticado)
- Productos: `GET|POST /products`, `GET|PATCH|DELETE /products/:id`, `POST /products/import` (CSV/JSON/Shopify), `POST /products/:id/media` (archivo o URL)
- Variantes e inventario: `PATCH /variants/:id`, `POST /inventory/adjust`
- Colecciones: CRUD `/collections`
- Servicios: CRUD `/resources`, `/availability-rules`, `/availability-exceptions`
- Pedidos: `GET /orders`, `GET /orders/:id`, `POST /orders` (manual/admin), `POST /orders/:id/cancel`, `POST /orders/:id/refunds`, `POST /orders/:id/fulfillments`, `POST /orders/:id/notes`
- Envíos: `POST /shipments/:id/label`, `GET /shipments/:id/tracking`
- Citas: `GET /bookings`, `POST /bookings/:id/reschedule|cancel|complete|no-show`
- Clientes: `GET /customers`, `GET /customers/:id`
- Descuentos: CRUD `/discounts`
- Ajustes: `GET|PATCH /store`, `GET /integrations`, `POST /integrations/:provider/connect` → `{ connect_url }`, `POST /integrations/:provider/test`
- Webhooks: CRUD `/webhook-endpoints`
- Salud: `GET /doctor` → checklist de configuración con estado y `hint` por punto.
- Reportes: `GET /reports/summary?from=&to=` (ventas, pedidos, ticket promedio, top productos).

---

## 8. Checkout y pagos

### Flujo
1. El sitio crea un carrito (`POST /carts`), guarda `cart_token` en cookie/localStorage.
2. Al pagar: `POST /storefront/checkout` →
   - Recalcula totales en servidor (`@sellbase/core/pricing`), nunca confía en el cliente.
   - Valida stock → crea `inventory_reservations` (TTL 15 min) y `booking_holds` (TTL 10 min).
   - Crea `checkout_session` con el proveedor y devuelve URL/`client_secret`.
3. El proveedor manda webhook → `sellbase-webhooks`:
   - Verifica firma + idempotencia.
   - En **una transacción**: crea `order` + `order_items` (snapshot) + `payment`, confirma reservas (descuenta `on_hand`), convierte holds en `bookings`, registra `discount_redemptions`, marca carrito `converted`, inserta eventos.
4. Los eventos disparan entrega + notificaciones (§9, §10).
5. `pg_cron` libera reservas/holds vencidos y marca carritos `abandoned`.

**Pagos diferidos** (OXXO, SPEI): el pedido se crea como `pending_payment` al generar la referencia; las reservas se extienden hasta el vencimiento de la referencia; al confirmarse el pago pasa a `open` + `paid`.

**Anticipos** (servicios): `pay_mode = deposit` cobra `deposit_amount`; el saldo se cobra con un link de pago (`kind = balance`) o en sitio.

### Interfaz de adaptador de pagos (`packages/adapters/payments`)
```ts
interface PaymentsAdapter {
  id: 'stripe' | 'mercadopago' | string;
  supportedMethods(country: string, currency: string): PaymentMethod[];
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  verifyWebhook(req: Request, secret: string): Promise<ProviderEvent>;
  mapEvent(evt: ProviderEvent): NormalizedPaymentEvent | null;
  refund(input: RefundInput): Promise<RefundResult>;
  connect?: { getConnectUrl(storeId: string): Promise<string>; handleCallback(q: URLSearchParams): Promise<ConnectedAccount> };
}
```
**v1**: `stripe` (tarjeta, Apple/Google Pay, OXXO en MX, Link) y `mercadopago`. **Después**: Conekta, PayPal, SPEI directo, BNPL.

### Comisión de plataforma (monetización)
- Default de instalación: pagos vía **Stripe Connect / MercadoPago Marketplace** con `platform_fee_bps` (application fee) **visible y documentado** en `stores.platform_fee_bps` y en el admin.
- El usuario puede conectar sus **propias llaves directas** (sin comisión) desde Ajustes → Pagos. Al ser open source, puede cambiarlo; el objetivo es que el default sea tan cómodo que no quiera hacerlo.
- Jamás cobrar una comisión oculta. La transparencia es parte del producto.

### Impuestos
- v1: precios con impuesto incluido (MX: IVA incluido) configurable por tienda; línea de impuesto informativa.
- v1.5: adaptador `tax/stripe-tax` para EE.UU. (sales tax por estado).

---

## 9. Entrega (fulfillment)

Al emitirse `order.paid`, un job agrupa las líneas por `fulfillment_type`:

- **shipment**: si la tienda tiene `auto_label = true`, compra la guía con la tarifa elegida en checkout; si no, queda "por surtir" en el admin. Tracking vía webhook del proveedor o polling.
- **digital**: crea `digital_grants` y envía el link de descarga; la descarga genera una URL firmada del bucket privado; respeta límites y vencimiento.
- **booking**: la cita ya existe (del hold); se generan invitaciones `.ics` / eventos de calendario y se programan recordatorios (24 h y 2 h antes).

### Interfaz de adaptador de envíos
```ts
interface ShippingAdapter {
  id: string;
  quote(input: { from: Address; to: Address; parcels: Parcel[] }): Promise<Rate[]>;
  createLabel(input: { rateId: string; order: OrderRef }): Promise<Label>;
  track(trackingNumber: string, carrier: string): Promise<TrackingStatus>;
  verifyWebhook?(req: Request): Promise<TrackingEvent>;
}
```
**v1**: `manual` (tarifa fija / gratis desde X / recoger en tienda) + **un** agregador multicarrier por API (MX) + `shippo` o `easypost` (EE.UU.). Las cajas por defecto se calculan con `physical_specs`.

---

## 10. Notificaciones y marketing

- Adaptador `notify/resend` (email) en v1; `notify/whatsapp` (Cloud API de Meta) en v1.5.
- Plantillas React Email con marca de la tienda (logo, color) y locales `es`/`en`.
- **Transaccionales v1**: confirmación de pedido, referencia OXXO/SPEI, pago recibido, guía generada, entregado, descarga lista, cita confirmada, recordatorio de cita, cita cancelada/reagendada, reembolso, carrito abandonado (1 h y 24 h).
- **Notificaciones al dueño**: pedido nuevo, stock bajo, error de integración.
- **Marketing v2**: listas, segmentos por comportamiento, campañas, automatizaciones (post-compra, recompra, "volvió a stock", cumpleaños), baja en un clic, consentimiento registrado (`accepts_marketing`, `marketing_consent_at`).

---

## 11. Admin (`/admin`)

SPA React + shadcn/ui, **mobile-first**, en español e inglés, marca blanca (logo y colores de la tienda).

**Login**: Supabase Auth (magic link + contraseña + Google). Solo `staff_members`.

**Secciones**
1. **Inicio**: ventas de hoy/7/30 días, pedidos por surtir, citas de hoy, checklist de configuración (desde `/doctor`).
2. **Pedidos**: lista con filtros (estado, canal, fecha), detalle con línea de tiempo, acciones (surtir, generar guía, reembolsar, cancelar, nota, reenviar email), pedido manual.
3. **Productos**: lista, edición con editor de variantes, media drag & drop, inventario, tipo físico/digital/servicio con sus campos, importar CSV/Shopify, acciones masivas.
4. **Colecciones**.
5. **Agenda**: calendario de citas por recurso, disponibilidad, excepciones.
6. **Clientes**: lista, detalle con historial.
7. **Descuentos**.
8. **Marketing** (v2).
9. **Canales** (v1.5+): Google Merchant, WhatsApp, Mercado Libre.
10. **Ajustes**: tienda, equipo y roles, pagos, envíos, notificaciones/plantillas, impuestos, dominios/checkout, API tokens, webhooks, **Agentes IA** (tokens MCP, scopes, bitácora de acciones del agente), versión y actualizaciones.

**Requisitos UX**
- Tiempo a primera acción útil < 30 s tras login.
- Cada estado vacío explica qué hacer y ofrece "Pídeselo a tu IA" con el prompt sugerido copiable.
- Acciones de dinero con confirmación y resumen del impacto.
- Funciona bien a 375 px de ancho.

---

## 12. Storefront: SDK, hooks y componentes

- `@sellbase/sdk`: `createSellbase({ url, anonKey })` → `products.list()`, `cart.add()`, `checkout.start()`, etc. Tipado desde OpenAPI.
- `@sellbase/react`: `SellbaseProvider`, `useProducts`, `useProduct`, `useCollection`, `useCart`, `useAvailability`, `useCheckout`, `useOrderLookup`. Headless: sin estilos.
- `registry/` (copiados al repo con `npx sellbase add <componente>`): `product-grid`, `product-carousel`, `product-card`, `product-detail`, `variant-picker`, `cart-drawer`, `cart-page`, `checkout`, `booking-picker`, `order-status`, `download-page`, `discount-input`.
- Cada componente: accesible, responsive, Tailwind + variables CSS de tema, **comentarios en el código que explican a la IA cómo personalizarlo**, y datos 100% desde la API (nunca hardcodeados).
- SEO: helpers para `schema.org/Product` y `Offer`, sitemap de productos, metadatos OG.

---

## 13. MCP y experiencia de agente

### 13.1 Servidor
- `@sellbase/mcp`, transporte **stdio** en v1 (`npx sellbase mcp`), autenticado con un `api_token` de agente. v2: **remoto (Streamable HTTP) con OAuth 2.1** en Sellbase Cloud.
- **Pocas herramientas, bien nombradas, con descripciones que dicen cuándo usarlas.** Entradas y salidas validadas con Zod. Todas aceptan `dry_run` cuando mutan.
- Respuestas compactas; listas paginadas; errores con `hint`.

### 13.2 Herramientas v1
| Herramienta | Qué hace | Scope |
|---|---|---|
| `store_status` | Estado general + checklist de `/doctor` con siguientes pasos | read |
| `store_update_settings` | Nombre, moneda, zona horaria, marca, políticas | settings:write |
| `integration_connect` | Devuelve URL de conexión (Stripe, MP, Resend, envíos) o estado | integrations:write |
| `integration_test` | Prueba una integración y explica el error | integrations:write |
| `products_search` | Buscar/listar productos | catalog:read |
| `product_get` | Detalle con variantes, inventario y specs | catalog:read |
| `product_upsert` | Crear/editar producto completo (cualquier tipo) en una llamada | catalog:write |
| `products_import` | Importar CSV/JSON/URL de Shopify | catalog:write |
| `media_add` | Subir imagen desde URL o ruta local | catalog:write |
| `inventory_adjust` | Ajustar stock con motivo | catalog:write |
| `collection_upsert` | Crear/editar colección | catalog:write |
| `service_setup` | Recursos, horarios y reglas de un servicio | catalog:write |
| `orders_search` | Pedidos con filtros ("por surtir hoy") | orders:read |
| `order_get` | Detalle completo + línea de tiempo | orders:read |
| `order_action` | cancelar · surtir · generar guía · nota · reenviar notificación | orders:write |
| `order_refund` | Reembolso (requiere `confirm: true` + scope) | refunds:write |
| `bookings_search` / `booking_action` | Citas: ver, reagendar, cancelar, completar | orders:write |
| `customers_search` | Clientes e historial | customers:read |
| `discount_upsert` | Crear/editar descuentos | discounts:write |
| `report_summary` | Ventas y KPIs por periodo | orders:read |
| `storefront_scaffold` | Devuelve qué componentes instalar y el comando `npx sellbase add …` según la intención | read |
| `test_purchase` | Hace una compra sandbox de punta a punta y reporta cada paso | orders:write |
| `docs_search` | Busca en la documentación de Sellbase | read |

### 13.3 Archivos para el agente (los escribe `init` en el repo del usuario)
- `CLAUDE.md` (sección Sellbase): qué es, dónde está cada cosa, reglas (no tocar schema `sellbase`, usar `metadata`, no exponer service key), comandos.
- `.claude/skills/sellbase/`:
  - `setup-store/SKILL.md`: onboarding conversacional.
  - `add-storefront/SKILL.md`: cómo integrar componentes en el diseño existente.
  - `manage-catalog/SKILL.md`, `operate-orders/SKILL.md`, `configure-payments/SKILL.md`, `configure-shipping/SKILL.md`, `services-and-bookings/SKILL.md`, `upgrade/SKILL.md`.
- `.cursor/rules/sellbase.mdc` equivalente.
- `docs/llms.txt` y `llms-full.txt` en la documentación pública.

### 13.4 Métrica clave
**Tasa de éxito del agente**: % de corridas en las que un agente, con un prompt tipo "agrega una tienda de playeras con envío y pagos", llega a `test_purchase` exitoso sin intervención humana. Construir un **harness de evals** en `evals/` con 10+ escenarios (tienda física, curso digital, consultorio con citas, mixta) y correrlo en CI semanal. Meta v1: ≥ 90%.

---

## 14. CLI e instalación

### 14.1 `npx sellbase init`
1. Detecta framework (Next.js App Router / Vite React / otro), gestor de paquetes y si ya hay Supabase (`supabase/` o variables de entorno).
2. Conecta Supabase:
   - Opción A: OAuth con Supabase (Management API) para elegir o crear proyecto.
   - Opción B: usa el proyecto local/linkeado existente.
3. Aplica migraciones de `sellbase` + buckets + Edge Functions + jobs de `pg_cron`. Registra `schema_version`.
4. Crea la tienda (nombre, país, moneda) y el **usuario owner** (manda magic link al email del dueño).
5. Instala paquetes (`@sellbase/sdk`, `@sellbase/react`, `@sellbase/admin`) y monta `/admin` según el framework.
6. Escribe `.env` (solo `anon` en cliente), `CLAUDE.md`, skills y reglas.
7. Crea un **token de agente** con scopes por defecto y registra el MCP (`.mcp.json` para Claude Code; config de Cursor si existe).
8. Opcional: `--seed demo` carga productos de ejemplo por giro.
9. Corre `sellbase doctor` y muestra el siguiente paso: *"Abre tu agente y dile: 'Configura mi tienda con Sellbase'"*.

Flags: `--yes` (no interactivo, para agentes), `--framework`, `--project-ref`, `--currency`, `--country`, `--seed`.

### 14.2 Otros comandos
- `sellbase add <componente…>`: copia componentes del registry.
- `sellbase upgrade`: ver §14.3.
- `sellbase doctor`: checklist (migraciones al día, RLS activo, integraciones, webhooks alcanzables, dominio de emails verificado, compra de prueba) con `hint` por punto. Salida humana y `--json`.
- `sellbase token create|list|revoke`.
- `sellbase mcp`: arranca el servidor MCP.
- `sellbase seed <giro>`.

### 14.3 Actualizaciones
- Migraciones **deterministas y probadas** publicadas con cada versión (`supabase/migrations/NNNN_*.sql`) + notas en `CHANGELOG.md` con sección "Qué debe revisar tu agente".
- `sellbase upgrade`:
  1. Lee `schema_version`, calcula migraciones pendientes.
  2. Crea respaldo (branch de Supabase si está disponible, si no `pg_dump` del schema `sellbase`).
  3. **Dry-run** en transacción con rollback → reporta.
  4. Aplica, actualiza paquetes y archivos del registry **solo si no fueron modificados** (hash); si fueron modificados, genera un diff y lo deja para que el agente lo integre.
  5. Corre `doctor` + `test_purchase` sandbox. Si falla: rollback guiado.
- El agente del usuario orquesta el upgrade (skill `upgrade`) con sus tokens; nosotros notificamos (admin + email + MCP `store_status`).
- **Compatibilidad**: el admin lee `schema_version` y soporta la versión actual y la anterior (N y N-1); fuera de rango muestra "actualiza para usar X".
- **Parches de seguridad**: banner urgente en el admin y bloqueo suave de acciones sensibles hasta aplicar; con opt-in del usuario, Sellbase Cloud puede aplicarlos automáticamente.

---

## 15. Roadmap por fases

Cada fase termina con: tests verdes, `doctor` limpio, docs actualizadas, demo grabable.

### Fase 0: Cimientos (≈2–3 días)
- Monorepo, tooling, CI (lint, typecheck, unit, pgTAP, e2e), Supabase local, playground Next.js.
- `@sellbase/core`: Zod de entidades principales, máquinas de estado, `pricing` (subtotal, descuentos, envío, impuesto incluido) con tests exhaustivos.
**Aceptación**: `pnpm test` y `pnpm test:db` verdes en CI; cálculo de totales cubierto con 30+ casos.

### Fase 1: Demo funcional (≈1 semana)
- Migración `0001_init`: tienda, staff, productos físicos + digitales, variantes, inventario, media, colecciones, clientes, carritos, checkout, pedidos, pagos, fulfillments, eventos, audit. RLS + pgTAP.
- `sellbase-api` (storefront + admin básico), `sellbase-webhooks` (Stripe).
- Checkout Stripe (tarjeta) con reservas de inventario; pedido desde webhook.
- Entrega digital con URL firmada; envío **manual** (tarifa fija).
- Email de confirmación (Resend).
- Admin: login, productos, pedidos, ajustes de pagos.
- Componentes: `product-grid`, `product-detail`, `cart-drawer`, `checkout`.
- MCP con: `store_status`, `product_upsert`, `products_search`, `orders_search`, `order_get`, `test_purchase`.
- CLI `init` (solo Next.js + Supabase existente) y `doctor`.
**Aceptación**: en un proyecto Next.js limpio, `npx sellbase init --yes` + un prompt al agente produce una compra de prueba exitosa (pedido + email + descarga) en < 10 min. e2e Playwright de compra física y digital.

### Fase 2: MVP para primeros clientes (≈3–5 semanas)
- Servicios y citas: recursos, disponibilidad, holds con exclusion constraint, anticipos, recordatorios, `.ics`.
- MercadoPago + OXXO/SPEI (pagos diferidos) + reembolsos.
- Agregador de envíos MX: cotización en checkout, guía automática, tracking.
- Descuentos, carrito abandonado, todas las transaccionales.
- Admin completo (§11 sin marketing/canales), equipo y roles, tokens, webhooks.
- MCP completo (§13.2), skills, soporte Vite/Lovable en `init`, `upgrade` v1, `add`.
- Evals de agente (≥ 10 escenarios) en CI.
**Aceptación**: 3 tipos de tienda (física, digital, citas) funcionando de punta a punta en MX; tasa de éxito del agente ≥ 80%.

### Fase 3: EE.UU. + canales (≈4–6 semanas)
- Stripe Tax, Shippo/EasyPost, Apple/Google Pay, locales `en` completos.
- Google Merchant (feed + sincronización), catálogo de WhatsApp, WhatsApp transaccional.
- Stripe Connect / MP Marketplace con `platform_fee_bps` por defecto + conexión de llaves propias.
- Docs públicas + `llms.txt` + plantillas por giro.
**Aceptación**: tienda en EE.UU. con impuestos correctos; producto publicado en Google Merchant desde el admin; tasa de éxito del agente ≥ 90%.

### Fase 4: Escala y monetización
- Sellbase Cloud: MCP remoto con OAuth, tarifas de envío negociadas, actualizaciones asistidas y parches automáticos opt-in, versión hosteada.
- Email marketing (§10 v2), Mercado Libre, CFDI, multi-tienda para agencias, marca blanca, integraciones oficiales con builders (Lovable, Bolt, v0).

---

## 16. Calidad y pruebas

- **Unit** (`core`): pricing, descuentos, transiciones de estado, disponibilidad de slots (zonas horarias y cambio de horario incluidos).
- **pgTAP**: cada política RLS (positivos y negativos), constraints (sin doble reserva, stock no negativo con `deny`), triggers.
- **Integración**: webhooks con fixtures reales de Stripe/MP (incluidos duplicados y fuera de orden).
- **E2E (Playwright)**: compra física, digital, cita con anticipo, OXXO diferido, reembolso, carrito abandonado.
- **Evals de agente** (`evals/`): escenarios + verificador automático vía `test_purchase` y `doctor`.
- **Seguridad**: escaneo de secretos en CI, dependencia auditada, revisión manual de RLS antes de cada release.

---

## 17. Open source, licencia y monetización

- Licencia: **MIT** para todo el kit (maximiza adopción y recomendación por agentes).
- Repo público, `CONTRIBUTING.md`, `SECURITY.md`, issues con plantillas, changelog semántico.
- **Monetización** (nada de esto es obligatorio para usar el kit):
  1. Comisión de plataforma en pagos administrados (default transparente, desactivable).
  2. Margen en envíos con tarifas negociadas (Cloud).
  3. Sellbase Cloud: hosting administrado, MCP remoto, actualizaciones asistidas, monitoreo.
  4. Servicios por uso: canales, WhatsApp, timbrado CFDI, funciones de IA.
  5. Agencias/Enterprise: multi-tienda, marca blanca, SLA.

---

## 18. Métricas de éxito

- Tiempo de `init` a compra de prueba (meta < 10 min, mediana).
- Tasa de éxito del agente en evals (meta ≥ 90%).
- Instalaciones activas (≥ 1 pedido real en 30 días).
- GMV procesado y % con pagos administrados.
- Estrellas en GitHub / menciones por agentes (seguimiento cualitativo).

---

## 19. Preguntas abiertas (decidir antes o durante Fase 1)

1. Nombre definitivo y disponibilidad (dominio, npm, GitHub, marca). Se decide antes de publicar en npm. Mientras tanto, el nombre vive en **un solo lugar** (`packages/core/src/brand.ts` + scope del monorepo) para que renombrar sea un buscar-y-reemplazar.
2. Agregador de envíos MX para v1 y términos comerciales.
3. ✅ **Decidido**: admin como **paquete npm** (`@sellbase/admin`) montado en `/admin`, no copiado al repo. Se personaliza por configuración (tema, textos, logo), por `metadata`/campos personalizados y por puntos de extensión (slots de UI + páginas extra registradas por el usuario). Nunca editando el paquete.
4. ✅ **Decidido**: checkout **redirigido a Stripe Checkout en Fase 1**, **embebido en Fase 2**. El `PaymentsAdapter.createCheckout` devuelve desde el inicio `{ mode: 'redirect', url } | { mode: 'embedded', client_secret }` para que el cambio de Fase 2 no requiera refactor.
5. Porcentaje de `platform_fee_bps` por defecto y cómo mostrarlo.
6. Frameworks soportados por `init` más allá de Next.js y Vite.
