import { formatMoney, isSellbaseError, planCheckout, routes } from '@sellbase/core';
import type { Hono } from 'hono';
import { actorRef, randomToken } from '../auth.js';
import type { Deps } from '../deps.js';
import { fromDbError } from '../errors.js';
import { register, type AppOptions } from '../http.js';
import { refreshOrderStatus } from '../fulfillment.js';
import { runJobs } from '../jobs.js';
import { loadCartLines, loadStore } from '../pricing-context.js';
import { loadService, slotsFor, withBookings } from '../services.js';

interface Step {
  step: string;
  ok: boolean;
  detail: string;
  hint: string | null;
}

const TEST_ADDRESS = {
  first_name: 'Test',
  line1: 'Av. Reforma 222',
  city: 'Ciudad de México',
  state: 'CDMX',
  postal_code: '06600',
  country: 'MX',
};

/**
 * `test_purchase` (SPEC §13.2): a real purchase in the provider's test mode, driven
 * server-side so an agent can verify the whole store without a browser. It follows the
 * same path as a customer (cart → checkout → payment → order → delivery → email), then
 * restores stock and flags the order as a test.
 */
export function registerTestPurchase(app: Hono, deps: Deps, options: AppOptions) {
  const { sql } = deps;

  register(app, deps, options, routes.testPurchase, async ({ storeId, actor, body }) => {
    const steps: Step[] = [];
    const ok = (step: string, detail: string) => steps.push({ step, ok: true, detail, hint: null });
    const fail = (step: string, error: unknown, fallbackHint: string) => {
      const known = isSellbaseError(error) ? error : fromDbError(error);
      steps.push({
        step,
        ok: false,
        detail: known?.message ?? (error instanceof Error ? error.message : String(error)),
        hint: known?.hint || fallbackHint,
      });
    };
    const result = (
      order: { id: string; number: number; total_amount: number; currency: string } | null,
    ) => ({
      ok: steps.every((s) => s.ok),
      order_id: order?.id ?? null,
      order_number: order?.number ?? null,
      total_amount: order?.total_amount ?? null,
      currency: order?.currency ?? null,
      steps,
    });

    // Live keys: never run a purchase against real money.
    const livePayments = await deps.payments(storeId);
    if (livePayments?.mode?.() === 'live') {
      fail(
        'payments',
        new Error('Stripe is in live mode: test_purchase never charges real money.'),
        'Use payments_live_check to verify real payments (a minimum charge refunded automatically), or run test_purchase in a project connected with test keys.',
      );
      return result(null);
    }

    // 1. Catalog
    const store = await loadStore(sql, storeId);
    const variantIds = body.variant_ids?.length
      ? body.variant_ids
      : (
          await sql<{ id: string }[]>`
            select distinct on (sv.product_type) sv.id from (
              select v.id, p.type as product_type, v.position, p.created_at
                from sellbase.storefront_variants v join sellbase.products p on p.id = v.product_id
               where v.store_id = ${storeId} and v.available and v.currency = ${store.default_currency}
                 and p.type in ('physical', 'digital', 'service')
            ) sv order by sv.product_type, sv.created_at, sv.position`
        ).map((r) => r.id);
    if (variantIds.length === 0) {
      fail(
        'catalog',
        new Error('No active products with stock.'),
        'Create an active product with product_upsert (status "active", price and stock), then run test_purchase again.',
      );
      return result(null);
    }

    // 2. Payments
    const payments = await deps.payments(storeId);
    if (!payments?.sandboxCharge) {
      fail(
        'payments',
        new Error('No payment provider connected.'),
        'Connect Stripe with a test key: integration_connect provider "stripe" (sk_test_… and the webhook secret).',
      );
      return result(null);
    }
    ok('payments', `${payments.id} connected.`);

    // 3. Cart
    const token = randomToken(24);
    const [cart] = await sql<{ id: string }[]>`
      insert into sellbase.carts (store_id, token, currency, email)
      values (${storeId}, ${token}, ${store.default_currency}, ${body.email}) returning id`;
    if (!cart) throw new Error('cart insert returned no row');
    const skipped: string[] = [];
    for (const variantId of variantIds) {
      const service = await loadService(sql, storeId, variantId);
      if (service) {
        // Services: book the first free slot, as a customer would.
        const { slots } = await slotsFor(
          sql,
          service,
          deps.now(),
          new Date(deps.now().getTime() + 30 * 86_400_000),
          deps.now(),
        );
        const first = slots[0];
        if (!first) {
          skipped.push(
            `${service.title}: no free slots in the next 30 days (check the resource hours with GET /resources)`,
          );
          continue;
        }
        await sql`insert into sellbase.cart_items (store_id, cart_id, variant_id, quantity, booking_slot)
                  values (${storeId}, ${cart.id}, ${variantId}, 1, ${sql.json({ starts_at: first.starts_at.toISOString() } as never)})`;
      } else {
        await sql`insert into sellbase.cart_items (store_id, cart_id, variant_id, quantity)
                  select ${storeId}, ${cart.id}, id, 1 from sellbase.variants where id = ${variantId} and store_id = ${storeId}`;
      }
    }
    const lines = await loadCartLines(sql, cart.id);
    if (lines.length === 0) {
      steps.push({
        step: 'cart',
        ok: false,
        detail: skipped.join('; ') || 'Nothing could be added to the cart.',
        hint: 'Give the service resources with weekly hours, or pass other variant_ids.',
      });
      return result(null);
    }
    ok('cart', `Cart with ${lines.map((l) => l.title).join(', ')}.`);
    for (const note of skipped)
      steps.push({
        step: 'booking',
        ok: false,
        detail: note,
        hint: 'Set weekly hours for the resources with POST /resources.',
      });

    // 4. Shipping
    const needsShipping = lines.some((l) => l.product_type === 'physical' && l.requires_shipping);
    let shippingAmount = 0;
    let shippingSelection: Record<string, unknown> | null = null;
    if (needsShipping) {
      try {
        const subtotal = lines.reduce((sum, l) => sum + l.unit_price_amount * l.quantity, 0);
        const rates = await (
          await deps.shipping(storeId)
        ).quote({
          from: null,
          to: TEST_ADDRESS,
          parcels: [],
          currency: store.default_currency,
          subtotal_amount: subtotal,
        });
        const rate = rates.find((r) => r.requires_address) ?? rates[0];
        if (!rate) throw new Error('No shipping options.');
        shippingAmount = rate.amount;
        shippingSelection = rate as unknown as Record<string, unknown>;
        ok('shipping', `${rate.service}: ${formatMoney(rate.amount, store.default_currency)}.`);
      } catch (error) {
        fail(
          'shipping',
          error,
          'Configure shipping in the store settings (flat rate or free over an amount).',
        );
        return result(null);
      }
    }

    // 5. Checkout (server-side totals + stock reservation)
    let sessionId: string;
    let plan: ReturnType<typeof planCheckout>;
    try {
      plan = planCheckout({
        currency: store.default_currency,
        lines,
        shipping_amount: shippingAmount,
        tax: store.tax,
      });
      const booked = await withBookings(
        sql,
        storeId,
        plan.lines,
        lines.map((l) => l.booking_slot),
        deps.now(),
      );
      const [created] = await sql<{ id: string }[]>`
        select sellbase.create_checkout_session(${cart.id}, ${payments.id}, ${sql.json(booked.snapshot as never)},
          ${sql.json(plan.totals as never)}, ${body.email}, ${needsShipping ? sql.json(TEST_ADDRESS as never) : null},
          ${shippingSelection ? sql.json(shippingSelection as never) : null}, '{}'::uuid[],
          ${booked.hasBookings ? '35 minutes' : '15 minutes'}::interval) as id`;
      sessionId = created?.id ?? '';
      ok(
        'checkout',
        `Total ${formatMoney(plan.totals.total_amount, store.default_currency)}; stock reserved.`,
      );
    } catch (error) {
      fail('checkout', error, 'Fix the product stock or prices and retry.');
      return result(null);
    }

    // 6. Payment in test mode
    let payment;
    try {
      payment = await payments.sandboxCharge({
        amount: plan.totals.total_amount,
        currency: store.default_currency,
        metadata: { sellbase_checkout_session_id: sessionId, sellbase_test_purchase: 'true' },
        idempotency_key: `test-purchase-${sessionId}`,
      });
      ok(
        'payment',
        `Charged ${formatMoney(payment.amount, payment.currency)} in test mode (${payment.provider_payment_id}).`,
      );
    } catch (error) {
      await sql`select sellbase.release_checkout_session(${sessionId})`;
      fail('payment', error, 'Check the Stripe test key with integration_test.');
      return result(null);
    }

    // 7. Order (same function the payment webhook uses)
    // Two statements: a volatile function inside WHERE would run once per scanned row.
    const [placed] = await sql<{ id: string }[]>`
      select sellbase.place_order_from_checkout(${sessionId}, ${sql.json({ provider: payments.id, ...payment, raw: { test_purchase: true } } as never)}) as id`;
    const [order] = await sql<
      {
        id: string;
        number: number;
        total_amount: number;
        currency: string;
        payment_status: string;
      }[]
    >`
      select id, number, total_amount, currency::text as currency, payment_status from sellbase.orders where id = ${placed?.id ?? null}`;
    if (!order) throw new Error('order was not created');
    await sql`update sellbase.orders set metadata = metadata || '{"test_purchase": true}' where id = ${order.id}`;
    steps.push({
      step: 'order',
      ok: order.payment_status === 'paid',
      detail: `Order #${order.number} created (${order.payment_status}).`,
      hint:
        order.payment_status === 'paid'
          ? null
          : 'The charged amount did not match the order total; report this as a bug.',
    });

    // 8–9. Delivery and email run through the same outbox jobs as real orders.
    await runJobs(deps, { storeId });
    const grants = await sql<{ storage_path: string; file_name: string }[]>`
      select a.storage_path, a.file_name from sellbase.digital_grants g
        join sellbase.digital_assets a on a.id = g.digital_asset_id where g.order_id = ${order.id}`;
    const digitalLines = plan.lines.filter((l) => l.fulfillment_type === 'digital');
    if (digitalLines.length) {
      if (grants.length) ok('delivery', `${grants.length} download link(s) issued.`);
      else
        steps.push({
          step: 'delivery',
          ok: false,
          detail: 'Digital items were bought but no file is attached.',
          hint: 'Upload the file for each digital variant (POST /variants/:id/digital-assets).',
        });
    }
    if (needsShipping)
      ok('fulfillment', 'Physical items are waiting to be shipped (fulfill them from the admin).');
    const bookings = await sql<{ starts_at: Date; status: string; resource: string }[]>`
      select b.starts_at, b.status, r.name as resource from sellbase.bookings b join sellbase.resources r on r.id = b.resource_id
       where b.order_id = ${order.id} order by b.starts_at`;
    for (const b of bookings) {
      steps.push({
        step: 'booking',
        ok: b.status === 'confirmed',
        detail: `Appointment ${b.status} for ${b.starts_at.toISOString()} with ${b.resource}.`,
        hint: b.status === 'confirmed' ? null : 'Check the booking in the agenda.',
      });
    }

    const [notification] = await sql<
      { status: string; error: string | null; provider_message_id: string | null }[]
    >`
      select n.status, n.error, n.provider_message_id from sellbase.notifications n
        join sellbase.events e on e.id = n.event_id where e.entity_id = ${order.id} order by n.created_at desc limit 1`;
    if (notification?.status === 'sent') {
      const viaLog = notification.provider_message_id?.startsWith('log_');
      steps.push({
        step: 'email',
        ok: true,
        detail: viaLog
          ? 'Confirmation email generated (printed to logs: no email provider connected).'
          : 'Confirmation email sent.',
        hint: viaLog ? 'Connect Resend to deliver emails to customers.' : null,
      });
    } else {
      steps.push({
        step: 'email',
        ok: false,
        detail: notification?.error ?? 'No confirmation email was produced.',
        hint: 'Check the sellbase-jobs function logs and the email integration.',
      });
    }

    // 10. Download links resolve to the private file.
    for (const grant of grants) {
      try {
        await deps.storage.signedUrl('sellbase-digital', grant.storage_path, 60);
        ok('download', `${grant.file_name} can be downloaded.`);
      } catch (error) {
        fail('download', error, 'Upload the file again for this variant.');
      }
    }

    // Leave the catalog as it was: stock and slots go back, the order stays flagged as a test.
    // Test appointments are cancelled (freeing the slot) and their lines closed, so the
    // order can still be fulfilled and completed like a real one.
    await sql.begin(async (tx) => {
      await tx`update sellbase.bookings set status = 'cancelled', notes = 'Test purchase' where order_id = ${order.id} and status = 'confirmed'`;
      await tx`update sellbase.order_items set fulfilled_quantity = quantity where order_id = ${order.id} and fulfillment_type = 'booking'`;
      await tx`update sellbase.fulfillments set status = 'cancelled' where order_id = ${order.id} and type = 'booking'`;
      await refreshOrderStatus(tx, order.id);
    });
    const { actor_type, actor_id } = actorRef(actor);
    for (const line of plan.lines) {
      const [tracked] =
        await sql`select 1 from sellbase.inventory_levels where variant_id = ${line.variant_id}`;
      if (tracked) {
        await sql`select sellbase.adjust_inventory(${line.variant_id}, ${line.quantity}, 'test_purchase_restore', ${actor_type}, ${actor_id})`;
      }
    }
    await sql`
      insert into sellbase.order_events (store_id, order_id, type, message, actor_type, actor_id)
      values (${storeId}, ${order.id}, 'test_purchase', 'Test purchase: stock was restored.', ${actor_type}, ${actor_id})`;
    return result(order);
  });
}
