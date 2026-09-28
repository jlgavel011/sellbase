---
name: sellbase-configure-shipping
description: Set up shipping for a Sellbase store (flat rate, free shipping threshold, store pickup) and ship orders with tracking. Use when the owner asks about shipping costs, delivery options or sending an order.
---

# Configure shipping

Sellbase ships with **manual shipping**: the store decides the price, and ships with any carrier. A carrier aggregator (automatic labels and quotes) comes later.

## Options (`store_update_settings`)

All amounts are integers in minor units: $99.00 MXN is `9900`.

```json
{
  "settings": {
    "shipping": {
      "flat_rate_amount": 9900,
      "free_over_amount": 99900,
      "label": "Envío estándar",
      "estimated_days": { "min": 2, "max": 5 },
      "pickup": { "enabled": true, "label": "Recoger en tienda" }
    }
  }
}
```

- `flat_rate_amount`: price of a normal shipment.
- `free_over_amount`: subtotal from which shipping is free. Use `null` to never make it free.
- `pickup.enabled`: offers store pickup at no cost. The buyer then gives no address.
- Only **physical** products need shipping. Digital products and services never ask for an address.
- For weight-based pricing in the future, fill `variants[].physical` (`weight_g`, `length_cm`, `width_cm`, `height_cm`) with `product_upsert` from the start.

Check the result: `store_status`, then add a physical product to a cart. `GET /storefront/carts/:token/shipping-rates` lists the options the buyer will see.

## Shipping an order

1. `orders_search` with `fulfillment_status: "unfulfilled"` lists what to ship today.
2. `order_action` with `action: "fulfill"`, and `carrier`, `tracking_number` and `tracking_url` when there is a guide. The buyer gets the "tu pedido va en camino" email unless `notify_customer: false`.
3. For partial shipments, send `items` with the order item ids and quantities.

## Tax on shipping

If the store charges VAT on shipping (the default in Mexico), leave `settings.tax.applies_to_shipping: true`. With tax-inclusive prices, the shipping price already includes VAT.
