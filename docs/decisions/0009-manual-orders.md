# 0009 — Pedidos manuales, importación CSV y cambios masivos

**Estado:** aceptada · Fase 2c · Código: `packages/api/src/handlers/manual-order.ts`, `catalog-bulk.ts`, `packages/core/src/csv.ts`, migración `0006_manual_orders.sql`

## Pedidos manuales (`POST /orders`)

La regla "los pedidos nacen del webhook de pago" protege contra pedidos inventados desde el navegador. Una venta en mostrador o por WhatsApp no pasa por la tienda, así que se registra con una excepción acotada:

- Solo staff o un token con `orders:write`, nunca el storefront. Cada pedido queda en `audit_log` (`order.create_manual`) con quién lo registró.
- **Cobrado** (`payment.mode: "paid"`): el dinero ya se recibió en efectivo, transferencia o terminal. Exige `confirm: true`, porque cuenta en ventas. El pago se guarda con `provider = 'manual'` y sin `provider_payment_id`, así que un reembolso por Stripe no aplica y la API lo explica.
- **Con link** (`payment.mode: "link"`): el pedido nace en `pending_payment` y se genera un link de Stripe por el total. Cuando se paga, `record_order_payment` (0006) abre el pedido y emite `order.paid` sin la marca `balance`, así que el cliente recibe su confirmación (y descargas) en ese momento.
- Los totales los calcula `calculateTotals` en el servidor (impuestos de la tienda, códigos y descuentos automáticos). El precio unitario se puede ajustar por pedido y queda como snapshot.
- El stock se descuenta al registrar, en ambos modos; con política `deny` nunca queda negativo (`OUT_OF_STOCK`). Si un pedido con link no se paga, se cancela con reposición.
- Los servicios no se aceptan: necesitan un horario reservado y eso vive en el storefront.
- Canal: `admin` para staff y `agent` para tokens, o el que se indique (`whatsapp`, `api`).

## Importación CSV (`POST /products/import`)

- El parser vive en `@sellbase/core` (sin dependencias): RFC 4180, BOM, `;` o `,`, encabezados nuestros, en español o de Shopify.
- Las filas con el mismo handle son variantes de un producto. Un producto existente (mismo slug) se actualiza y sus variantes se emparejan por SKU. Las variantes que no vienen en el archivo se archivan, igual que en `product_upsert`.
- En Shopify, "Type" es una categoría, así que solo se toma como tipo si dice physical, digital o service. Si no, el producto se importa como físico.
- `dry_run` devuelve lo que se crearía o actualizaría y los errores por fila con `hint`. Las filas malas no detienen el resto.

## Cambios masivos (`POST /products/bulk`)

- Publicar, borrador y archivar se aplican de inmediato: son reversibles.
- Cambiar precio es acción de dinero. Sin `confirm: true` solo regresa la vista previa (antes y después por variante). Con `confirm: true` aplica todo en una transacción y deja `variant.bulk_price` en `audit_log` con el precio anterior y el nuevo.
