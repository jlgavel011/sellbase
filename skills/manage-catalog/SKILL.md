---
name: sellbase-manage-catalog
description: Create and update Sellbase products (physical and digital), images, stock, files, collections and discount codes. Use for any catalog or promotion change.
---

# Manage the catalog

- **One call per product**: `product_upsert` with the whole product. Prices in minor units (`price_amount: 34900` = $349.00). Every product needs ≥1 variant; use a single variant titled "Default" when there are no options.
- **Publish** with `status: "active"`; drafts are invisible in the storefront.
- **Options** (Talla, Color): `options: [{ name: "Talla", values: ["M", "L"] }]` and one variant per combination with `option_values: { "Talla": "M" }`.
- **Physical**: `variants[].physical` (weight_g and dimensions) and `variants[].inventory.on_hand`. Stock with policy `deny` never oversells.
- **Digital**: create the product, then `product_file_upload` with the variant id and a local file path. Buyers get an expiring link by email.
- **Images**: `media_add` with a URL or a local path; the first image is the one shown in listings.
- **Updates**: send `id` (and each variant `id`) to update in place. Variants left out are archived, not deleted; orders keep their snapshots.
- **Stock changes**: `inventory_adjust` with a reason.
- Use `dry_run: true` when unsure; check results with `product_get`.
- **Collections** ("Lo más vendido", "Regalos"): `collection_upsert` with `title` and `product_ids` in display order. The storefront filters with `?collection=<slug>`. Remove one with `delete: { id }`; products are kept.
- **Discounts**: `discount_upsert`. `kind: "percent"` uses basis points (`value: 1000` = 10%), `"fixed"` uses minor units, `"free_shipping"` uses `value: 0`. Codes are uppercase; `code: null` makes an automatic discount. Limit with `min_subtotal_amount`, `usage_limit`, `per_customer_limit`, `starts_at`/`ends_at`, or `applies_to: { type: "collections", collection_ids: [...] }`. Call it with no `discount` to list the current ones. Used discounts cannot be deleted, only paused (`status: "disabled"`).
