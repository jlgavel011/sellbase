# 0006 — Stripe Checkout redirigido (Fase 1)

**Estado:** aceptada · Fase 1 · Código: `packages/adapters/src/payments/stripe.ts`

- **Sin SDK:** la API de Stripe se llama con `fetch` y la firma de los webhooks se verifica con WebCrypto (tolerancia de 5 min). El mismo código corre en Deno, Node y workers.
- **Solo tarjeta en Fase 1** (`payment_method_types=card`); Apple Pay, Google Pay y Link llegan con la tarjeta. OXXO/SPEI son pagos diferidos y entran en Fase 2, junto con el estado `pending_payment`. El adaptador ya mapea `checkout.pending` y `payment.failed`.
- **Montos exactos:** cada línea se manda como una partida con el total ya descontado (no precio unitario × cantidad), para que Stripe cobre exactamente lo que calculó `@sellbase/core`. El adaptador aborta si `amount_total` de Stripe no coincide.
- **Vigencia:** la reserva de stock dura 15 min (SPEC §8), pero Stripe exige que una sesión de Checkout dure al menos 30 min. La sesión de Stripe vence a los 31 min. Si el pago llega después de liberar la reserva, el pedido se crea igual (el cliente ya pagó) y un evento `inventory.oversold` avisa si faltó stock (ver `place_order_from_checkout`).
- **Idempotencia:** el id de la sesión de Sellbase viaja como `Idempotency-Key` hacia Stripe y en `metadata`/`client_reference_id` de vuelta.
