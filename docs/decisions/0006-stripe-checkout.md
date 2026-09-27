# 0006 — Stripe Checkout redirigido (Fase 1)

**Estado:** aceptada · Fase 1 · Código: `packages/adapters/src/payments/stripe.ts`

- **Sin SDK:** la API de Stripe se llama con `fetch` y la firma de los webhooks se verifica con WebCrypto (tolerancia de 5 min). El mismo código corre en Deno, Node y workers.
- **Solo tarjeta en Fase 1** (`payment_method_types=card`); Apple Pay, Google Pay y Link llegan con la tarjeta. OXXO/SPEI son pagos diferidos y entran en Fase 2, junto con el estado `pending_payment`. El adaptador ya mapea `checkout.pending` y `payment.failed`.
- **Montos exactos:** cada línea se manda como una partida con el total ya descontado (no precio unitario × cantidad), para que Stripe cobre exactamente lo que calculó `@sellbase/core`. El adaptador aborta si `amount_total` de Stripe no coincide.
- **Vigencia:** la reserva de stock dura 15 min (SPEC §8), pero Stripe exige que una sesión de Checkout dure al menos 30 min. La sesión de Stripe vence a los 31 min. Si el pago llega después de liberar la reserva, el pedido se crea igual (el cliente ya pagó) y un evento `inventory.oversold` avisa si faltó stock (ver `place_order_from_checkout`).
- **Idempotencia:** el id de la sesión de Sellbase viaja como `Idempotency-Key` hacia Stripe y en `metadata`/`client_reference_id` de vuelta.
- **Página de regreso (Fase 2):** el `success_url` lleva `?sellbase_checkout=<id>` y `GET /storefront/checkout/:id` responde `pending` / `paid` / `expired`, con el número de pedido y el correo enmascarado. El comprador puede volver antes o después del webhook: la página muestra "confirmando pago" y consulta de nuevo. El pedido nunca nace de esa página.
- **Pago rechazado:** un `async_payment_failed` libera en ese momento el stock y los horarios apartados. Una tarjeta rechazada en Checkout no manda webhook: la sesión sigue abierta para reintentar y se libera al expirar, por webhook o por el cron.
