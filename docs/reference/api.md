# Sellbase API reference

Generated from the route contracts (`packages/core/src/api/contracts.ts`). Base URL: `<SUPABASE_URL>/functions/v1/sellbase-api/v1`. Full schemas: `GET /openapi.json`.

Auth: public routes need no token; the rest need `Authorization: Bearer <staff session or sb_live_… token>` with the scope shown. Money is an integer in minor units. Errors have `code`, `message` and `hint`.

## storefront

- **GET /storefront/products** (public): List active products.
- **GET /storefront/products/:slug** (public): Get an active product with variants and media.
- **POST /storefront/carts** (public): Create a cart; keep the returned token in a cookie or localStorage.
- **GET /storefront/carts/:token** (public): Get a cart with server-computed totals.
- **GET /storefront/availability** (public): Free start times for a service variant. Times are instants (ISO 8601, UTC); show them in `timezone`. Defaults to the next 14 days; at most 62 days per request.
- **POST /storefront/carts/:token/items** (public): Add a variant to the cart (adds to the quantity if already present). Services need `booking_slot` with a start time from GET /storefront/availability; each booking is its own line with quantity 1.
- **PATCH /storefront/carts/:token/items/:item_id** (public): Set the quantity of a cart line.
- **DELETE /storefront/carts/:token/items/:item_id** (public): Remove a cart line.
- **POST /storefront/carts/:token/discounts** (public): Apply a discount code.
- **DELETE /storefront/carts/:token/discounts/:code** (public): Remove a discount code.
- **POST /storefront/carts/:token/shipping-rates** (public): Quote shipping options for the cart.
- **POST /storefront/checkout** (public): Start checkout: reserves stock and returns where to pay. Totals are recomputed on the server. Stock is held for 15 minutes. The order is created only when the payment provider confirms payment.
- **GET /storefront/checkout/:id** (public): Status of a checkout, for the page the buyer returns to after paying. The success_url gets ?sellbase_checkout=<id>. The buyer may arrive before or after the payment webhook: show "confirming payment" while status is pending and poll every few seconds.
- **GET /storefront/collections** (public): Collections with at least one active product, for navigation.
- **GET /storefront/collections/:slug** (public): One collection; list its products with GET /storefront/products?collection=<slug>.
- **POST /storefront/orders/lookup** (public): A buyer checks their order with its number and email. Any mismatch answers NOT_FOUND (it never tells which part was wrong). Limited to 10 attempts per minute per IP.
- **GET /storefront/downloads/:grant_token/info** (public): What a download link gives, and whether it still works.
- **GET /storefront/store** (public): Store name, logo, currency and the consent checkout requires.
- **GET /storefront/downloads/:grant_token** (public): Redirect to a short-lived signed URL for a purchased file.

## catalog

- **GET /products** (scope: catalog:read): Search products.
- **POST /products/import** (scope: catalog:write): Import products from CSV (our template, Spanish headers or a Shopify export). Rows with the same handle are variants of one product. Existing products (same handle/slug) are updated; variants match by SKU. Use dry_run first to see what would change.
- **POST /products/bulk** (scope: catalog:write): Publish, unpublish, archive or reprice many products at once. Price changes are a money action: without confirm=true the response is only a preview of old and new prices.
- **GET /products/:id** (scope: catalog:read): Get a product with variants, inventory and specs.
- **POST /products** (scope: catalog:write): Create or update a full product of any type in one call. Send `id` to update. Variants with `id` are updated, without are created, missing ones are archived.
- **DELETE /products/:id** (scope: catalog:write): Archive a product (orders keep their snapshots).
- **POST /products/:id/media** (scope: catalog:write): Add an image to a product from a URL or an uploaded file. Send `url` to reference an existing image, or `file_name` + `content_base64` (max 5 MB) to upload it to the public media bucket.
- **PATCH /products/:id/media** (scope: catalog:write): Reorder product images and edit their alt text. The images listed come first, in this order; the first one is the main image. Omitted images keep their relative order after them.
- **DELETE /products/:id/media/:media_id** (scope: catalog:write): Remove an image from a product (uploaded files are deleted too).
- **POST /variants/:id/digital-assets** (scope: catalog:write): Upload the file buyers receive for a digital variant. The file is stored in a private bucket and only reachable through short-lived signed links issued after payment. Max 10 MB per call.
- **GET /inventory** (scope: catalog:read): Stock per variant, with low and out of stock filters.
- **POST /inventory/adjust** (scope: catalog:write): Adjust stock by a delta with a reason.
- **GET /resources** (scope: catalog:read): People, rooms or equipment that deliver services, with their weekly hours.
- **POST /resources** (scope: catalog:write): Create or update a resource, its weekly hours and the services it delivers. rules replace the weekly hours (weekday 0 = Sunday … 6 = Saturday, local times in `timezone`); product_ids replace the services it delivers.
- **POST /resources/:id/exceptions** (scope: catalog:write): Block time off (closed) or add extra hours (open) for a resource.
- **DELETE /resources/:id/exceptions/:exception_id** (scope: catalog:write): Remove a time-off or extra-hours exception.
- **GET /collections** (scope: catalog:read): List collections with their product ids.
- **POST /collections** (scope: catalog:write): Create or update a collection and set its products.
- **DELETE /collections/:id** (scope: catalog:write): Delete a collection (products are kept).

## orders

- **GET /orders** (scope: orders:read): Search orders.
- **POST /orders** (scope: orders:write): Record a manual order (sale outside the storefront). payment.mode "paid": money was received in cash, transfer or terminal; needs confirm=true. payment.mode "link": the order waits in pending_payment and the response has a Stripe payment link. Stock is taken now either way. Services must be booked from the storefront.
- **GET /orders/:id** (scope: orders:read): Get an order with items, payments and timeline.
- **POST /test-purchase** (scope: orders:write): Run a real end-to-end purchase in test mode and report every step. Uses the payment provider test mode (never live keys): cart, checkout with stock reservation, payment, order, digital delivery, confirmation email and download link. Stock is restored afterwards and the order is flagged as a test.
- **POST /orders/:id/fulfillments** (scope: orders:write): Mark items as shipped (manual shipping) with carrier and tracking. Omit `items` to ship everything still pending. The customer gets a "your order is on its way" email unless notify_customer is false.
- **POST /orders/:id/cancel** (scope: orders:write): Cancel an order, optionally refunding it and restocking items. Money action: requires confirm=true. refund=true also needs the refunds:write scope. Download links are revoked.
- **POST /orders/:id/refunds** (scope: refunds:write): Refund all or part of an order through the payment provider. Money action: requires confirm=true and the refunds:write scope. Omit amount to refund everything still refundable.
- **POST /orders/:id/payment-link** (scope: orders:write): Create a payment link for the balance still owed on an order. For orders paid with a deposit. Send the URL to the customer; when paid, the order becomes "paid".
- **POST /orders/:id/notes** (scope: orders:write): Add an internal note to the order timeline.
- **POST /orders/:id/notifications** (scope: orders:write): Send an order email again (confirmation or shipment).
- **GET /checkouts/abandoned** (scope: orders:read): Checkouts started with an email but not paid (abandoned carts). One row per cart (its latest checkout). "recovered" means the cart was bought afterwards.
- **POST /checkouts/:id/recovery-email** (scope: orders:write): Email the buyer a link that restores their cart. Needs settings.site_url (the storefront) so the link can open the cart. Sends at most once per checkout unless resend is true.
- **GET /bookings** (scope: orders:read): Appointments in a date range (the agenda).
- **POST /bookings/:id/complete** (scope: orders:write): Mark an appointment as done.
- **POST /bookings/:id/no-show** (scope: orders:write): Mark that the customer did not come.
- **POST /bookings/:id/cancel** (scope: orders:write): Cancel an appointment, optionally refunding it. refund=true refunds the booked line through the payment provider (needs refunds:write). Requires confirm=true.
- **POST /bookings/:id/reschedule** (scope: orders:write): Move an appointment to another free time. Creates a new confirmed booking linked to the old one (status "rescheduled").

## customers

- **GET /customers** (scope: customers:read): Search customers by email or name.
- **GET /customers/:id** (scope: customers:read): Get a customer with addresses, orders and bookings.

## discounts

- **GET /discounts** (scope: any staff or token): List discounts (codes and automatic).
- **POST /discounts** (scope: discounts:write): Create or update a discount. percent: value in basis points (1000 = 10%). fixed: minor units. free_shipping: value 0. code null = automatic discount.
- **DELETE /discounts/:id** (scope: discounts:write): Delete an unused discount; used ones are disabled so orders keep their history.

## reports

- **GET /reports/summary** (scope: orders:read): Sales today / 7 / 30 days, daily series, top products and pending work.

## team

- **GET /team** (scope: settings:write): Team members and their roles.
- **POST /team** (scope: settings:write): Invite someone by email (they get a link to set a password). Existing users are added right away. Only owners can add owners. redirect_to must be an allowed redirect URL in Supabase Auth.
- **PATCH /team/:user_id** (scope: settings:write): Change the role of a team member.
- **DELETE /team/:user_id** (scope: settings:write): Remove someone from the team (the store always keeps one owner).
- **GET /tokens** (scope: settings:write): API tokens (for AI agents and integrations), without their secret.
- **POST /tokens** (scope: settings:write): Create an API token; the full token is shown only in this response. Defaults to the agent scopes (everything except refunds:write and webhooks:write). A token can only create tokens with scopes it has.
- **DELETE /tokens/:id** (scope: settings:write): Revoke an API token right away.
- **GET /audit** (scope: settings:write): Activity log: who (staff, AI agents, webhooks) changed what.

## webhooks

- **GET /webhooks** (scope: webhooks:write): Outbound webhook endpoints with delivery stats.
- **POST /webhooks** (scope: webhooks:write): Subscribe a URL to store events; the signing secret is shown only here. Needs webhooks:write; API tokens must also send confirm=true. Each POST carries Sellbase-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">. Failed deliveries retry for about a day.
- **PATCH /webhooks/:id** (scope: webhooks:write): Change the URL, events or pause an endpoint.
- **DELETE /webhooks/:id** (scope: webhooks:write): Delete an endpoint and its secret.
- **POST /webhooks/:id/test** (scope: webhooks:write): Send a signed webhook.test event now and report the response.
- **GET /webhooks/:id/deliveries** (scope: webhooks:write): Last 50 deliveries of an endpoint.

## store

- **GET /store** (scope: any staff or token): Get store settings.
- **PATCH /store** (scope: settings:write): Update store settings.
- **POST /store/logo** (scope: settings:write): Upload the store logo (PNG, JPG, WebP or SVG, max 2 MB). Used by the admin, emails and GET /storefront/store.

## integrations

- **GET /integrations** (scope: integrations:write): List integrations and their status.
- **POST /integrations/:provider/connect** (scope: integrations:write): Connect a provider with API keys (stored in Vault) or get a connect URL. Stripe: when the project has a public https URL and no webhook_secret is sent, the webhook endpoint is created in Stripe automatically and its secret stored in Vault. Locally, run `stripe listen --forward-to <webhooks URL>` and send its whsec_ as webhook_secret.
- **POST /integrations/:provider/test** (scope: integrations:write): Test a provider connection and explain any error.
- **POST /notifications/test** (scope: settings:write): Send a sample order email to check the email provider.
- **POST /integrations/stripe/live-check** (scope: integrations:write): Real-money check: a minimum charge the owner pays, refunded automatically. Live keys only. Returns a Stripe Checkout URL for the smallest amount Stripe allows (10 MXN, 0.50 USD). When its webhook arrives the charge is refunded and the integration is marked verified. Stripe keeps its fee. Needs confirm=true.

## system

- **GET /doctor** (scope: any staff or token): Setup checklist with a hint for each pending item.
