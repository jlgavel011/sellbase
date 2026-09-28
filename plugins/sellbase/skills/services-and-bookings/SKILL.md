---
name: sellbase-services-and-bookings
description: Sell appointments with Sellbase (consultations, classes, sessions): services, who delivers them, weekly hours, deposits and the agenda. Use when the store sells time instead of (or besides) products.
---

# Services and bookings

1. **The service**: `product_upsert` with `type: "service"` and, per variant, `service: { duration_min, location_type: "in_person" | "online", online_meeting_url?, capacity? (group classes), deposit_amount? (minor units), buffer_before_min?, buffer_after_min?, min_notice_min?, booking_window_days? }`. Price in minor units as usual. Set `status: "active"`.
2. **Who and when**: `service_setup` with the resource name, its weekly `hours` (`weekday` 0 = Sunday … 6 = Saturday, `"09:00"`–`"18:00"`, local store time) and `service_product_ids`. Block vacations with `closed`.
3. **Check**: `availability_get` with the variant id must list times. If it is empty, the resource has no hours or is not assigned to the service.
4. **Storefront**: the product page shows `<BookingPicker>` automatically for services (from `product-detail`). Checkout offers "pay deposit / pay total" when the service has `deposit_amount`.
5. **Verify**: `test_purchase` with the service `variant_ids` books the first free time end to end (payment, confirmation email with a calendar invitation) and frees it again.

## Operating the agenda

- Today's appointments: `bookings_search` with today's range (store time zone).
- `booking_action`: `complete`, `no_show`, `reschedule` (pick `starts_at` from `availability_get`), `cancel` (reason, `confirm: true`; `refund: true` needs refunds permission). Customers are emailed on reschedule and cancel; reminders go out 24 h and 2 h before automatically.
- Deposits: the balance of a deposit order is collected with `order_action` `payment_link`; send the URL to the customer.
- Times are instants (UTC) in the API: always present them to the owner in the store time zone.
