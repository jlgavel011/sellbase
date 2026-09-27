---
name: sellbase-manage-catalog
description: Create and update Sellbase products (physical and digital), images, stock and files. Use for any catalog change.
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
