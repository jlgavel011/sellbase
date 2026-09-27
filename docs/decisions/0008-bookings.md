# 0008 — Citas: apartados y citas en una sola tabla

**Estado:** aceptada · Fase 2 · Migración: `0004_services.sql` · Código: `packages/core/src/availability.ts`

## Decisión

- **Una tabla `bookings`** con estados `held` → `confirmed` → `completed | no_show | cancelled | rescheduled` (y `held` → `expired`). El spec (§5.4) separa `booking_holds` y `bookings`, pero en dos tablas una exclusion constraint no puede cubrir ambas.
- **Sin empalmes, garantizado por Postgres**: `exclude using gist (resource_id with =, seat with =, occupied with &&) where status in ('held','confirmed')`. `occupied` incluye los buffers.
- **Capacidad por asientos**: un recurso con capacidad N acepta N citas simultáneas, cada una en un asiento 1..N; `hold_booking` toma el primer asiento libre.
- **Horarios en la zona del recurso**: reglas semanales en hora local (IANA) y excepciones (`closed`/`open`) en instantes. `computeSlots` convierte con `Intl`, así que los cambios de horario acortan o alargan el día sin ofrecer horas inexistentes.
- **Duración del apartado**: el spec pide 10 min, pero Stripe Checkout exige sesiones de al menos 30 min. Un pago que llegue después de liberar el apartado dejaría al cliente pagando un horario ya tomado, así que los checkouts con citas duran 35 min (más que la sesión de Stripe, 31 min).
- **Pago tardío**: si aun así el apartado expiró, `confirm_session_bookings` retoma el horario si sigue libre; si no, la cita queda cancelada con un evento `booking.conflict` y aviso en el pedido para reagendar o reembolsar.
- **Recursos por producto** (`service_resources`); las especificaciones del servicio (duración, buffers, capacidad, anticipo) van por variante.
