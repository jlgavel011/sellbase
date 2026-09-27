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
2. **2e. `sellbase init` + MCP completo + archivos para el agente**: el init deja el proyecto listo, con el MCP conectado a todas las herramientas y las skills y `CLAUDE.md`/reglas copiadas al proyecto del usuario.
3. **2f. Componentes del storefront**: el set completo del registry, pulido y probado.
4. **Antes de 2g, bloqueo de webhooks a redes privadas**: en producción los webhooks salientes rechazan destinos privados o internos. Eso incluye loopback, 10/8, 172.16/12, 192.168/16, link-local y metadata 169.254.169.254, CGNAT 100.64/10, IPv6 ULA y link-local, y nombres que resuelvan ahí, como `localhost` o `kong`. Se valida al crear o editar el endpoint y otra vez justo antes de cada envío, para cubrir cambios de DNS. No se siguen redirecciones. Solo se permiten destinos privados con la variable `SELLBASE_WEBHOOKS_ALLOW_PRIVATE=true`, pensada para el stack local; `sellbase init` no la pone en la nube. Tendrá tests y actualización del ADR 0010.
5. **2g. Instalación en un Supabase en la nube**: `sellbase init` contra un proyecto real (migraciones, functions, secretos, cron) y compra de prueba.
6. **2h. Evals del agente**: se construyen después. **Solo corren cuando el usuario lo pide**; nada automático ni semanal en CI.

Evals (cuando toque): `evals/` con 10+ escenarios (tienda física, curso digital, consultorio con citas, mixta, errores recuperables), agente real en un proyecto limpio, verificador vía `test_purchase` y `doctor`, métricas de éxito, tool calls y tiempo. Meta ≥ 80 %.

## Decisiones pendientes

- **Evals**: cómo corre el agente (Claude Agent SDK con API key, o Claude Code en modo headless) y el presupuesto por corrida. Se decide al llegar a 2h. Nunca programados.
