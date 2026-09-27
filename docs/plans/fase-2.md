# Plan — Fase 2 (priorizada)

Referencia: SPEC §15 (Fase 2), §5.2, §5.5, §9, §11, §13, §16.

## Prioridades acordadas (2026-09-27)

1. **Servicios y citas**
2. **Admin completo** (§11 sin marketing ni canales)
3. **Evals del agente**

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

### 2c. Admin completo

- Inicio con métricas (ventas de hoy/7/30 días, pedidos por surtir, citas de hoy) sobre `GET /reports/summary`.
- Pedidos: filtros por estado, canal y fecha; pedido manual.
- Productos: importar CSV y acciones masivas (publicar, archivar, precio).
- Colecciones, Clientes (detalle con historial) y Descuentos: CRUD en API, admin y MCP (`collection_upsert`, `customers_search`, `discount_upsert`).
- Ajustes: equipo y roles (invitar por email), API tokens (crear/revocar, scopes), webhooks salientes (endpoints, firma, reintentos) y **Agentes IA** (bitácora de acciones de tokens desde `audit_log`).

### 2d. Evals del agente

- `evals/` con 10+ escenarios (tienda física, curso digital, consultorio con citas, mixta, errores recuperables).
- Runner: un agente real con el MCP de Sellbase en un proyecto limpio (`sellbase init`), con verificador automático vía `test_purchase` y `doctor`.
- Métricas: tasa de éxito, tool calls y tiempo; reporte comparable entre corridas; CI semanal.
- Meta de Fase 2: ≥ 80 % de éxito.

## Decisiones pendientes

- **Evals**: cómo corre el agente (Claude Agent SDK con API key, o Claude Code en modo headless) y el presupuesto por corrida. Se decide al llegar a 2d.
