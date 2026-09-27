# 0002 — Reglas de cálculo de totales

**Estado:** aceptada · Fase 0 · Código: `packages/core/src/pricing.ts`

1. **Descuentos en orden.** Se aplican en el orden recibido, cada uno sobre lo que queda después de los anteriores. Quien llama pasa primero los automáticos y al final el código que escribió el cliente. Decidir _cuáles_ descuentos aplican (vigencia, estado, límites de uso) no es trabajo de `pricing`; eso lo hace la capa que tiene acceso a la base.
2. **Reparto por línea.** Cada descuento se reparte entre las líneas elegibles proporcional a su monto restante (método del mayor residuo; empates a la línea más temprana). Así `order_items.discount_amount` siempre suma el descuento del pedido.
3. **Mínimo de compra.** `min_subtotal_amount` se compara contra el subtotal _antes de descuentos_ de las líneas elegibles (no de todo el carrito).
4. **Descuentos rechazados no lanzan error.** Se devuelven en `rejected_discounts` con `reason` y `hint`; la API decide si eso es un error para el usuario (p. ej. cuando acaba de escribir el código).
5. **Tope.** Un descuento fijo nunca deja una línea bajo cero y nunca toca el envío. Un porcentaje > 100 % se trata como 100 %.
6. **Envío gratis** descuenta el envío completo; varios juntos no suman más. `shipping_amount` se reporta bruto y el descuento va en `shipping_discount_amount` (incluido en `discount_amount`).
7. **Impuestos.** Modo `inclusive` (MX, IVA incluido: `tax = base × r / (1 + r)`) o `exclusive` (EE.UU.: se suma). Se calculan después de descuentos, sobre líneas + envío (configurable con `applies_to_shipping`). El impuesto se reparte por línea y envío con el mismo método, para CFDI en el futuro.
8. **Total** = subtotal − descuento + envío (+ impuesto si es `exclusive`).

## Estado de pedido con citas

`shouldCompleteOrder` considera cerradas las citas `completed`, `no_show` y `rescheduled` (la reagendada deja una cita nueva que también debe cerrarse). El spec dice "todas las citas `completed`"; sin incluir `no_show`, un pedido pagado cuyo cliente no llegó quedaría abierto para siempre.
