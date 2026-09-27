import { planCheckout, routes, sellbaseError } from '@sellbase/core';
import type { Hono } from 'hono';
import { randomToken, sha256Hex } from '../auth.js';
import type { Deps } from '../deps.js';
import { notFound } from '../errors.js';
import { register, type AppOptions } from '../http.js';
import {
  depositDue,
  assertCartOpen,
  assertCodeUsable,
  cartView,
  loadCart,
  loadCartLines,
  loadDiscounts,
  loadStore,
} from '../pricing-context.js';
import { decodeCursor, encodeCursor } from '../pagination.js';
import { loadService, resolveBooking, withBookings } from '../services.js';

const CHECKOUT_TTL_MINUTES = 15;
const BOOKING_TTL_MINUTES = 35;

/** The return page learns which checkout to ask about: ?sellbase_checkout=<id>. */
function withCheckoutParam(url: string, sessionId: string) {
  const u = new URL(url);
  u.searchParams.set('sellbase_checkout', sessionId);
  return u.toString();
}

/** b***@example.com: enough for the buyer to recognize it, not to harvest it. */
function maskEmail(email: string) {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}***@${domain}`;
}

export function registerStorefront(app: Hono, deps: Deps, options: AppOptions) {
  const { sql } = deps;

  // ── Catalog ────────────────────────────────────────────────────────────────
  register(app, deps, options, routes.storefrontProductsList, async ({ storeId, query }) => {
    const after = decodeCursor(query.cursor);
    const rows = await sql`
      select p.id, p.slug, p.type, p.title, p.description, p.tags, p.image_url, p.image_alt,
             p.min_price_amount, p.max_price_amount, p.currency::text as currency, p.created_at
        from sellbase.storefront_products p
       where p.store_id = ${storeId}
         ${query.q ? sql`and p.title ilike ${'%' + query.q + '%'}` : sql``}
         ${
           query.collection
             ? sql`and exists (
             select 1 from sellbase.collection_products cp join sellbase.collections c on c.id = cp.collection_id
              where cp.product_id = p.id and c.slug = ${query.collection} and c.store_id = ${storeId})`
             : sql``
         }
         ${after ? sql`and (p.created_at, p.id) < (${after.at}, ${after.id})` : sql``}
       order by p.created_at desc, p.id desc
       limit ${query.limit + 1}`;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map(({ created_at: _c, ...p }) => p) as never,
      next_cursor:
        rows.length > query.limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  });

  register(app, deps, options, routes.storefrontProductGet, async ({ storeId, params }) => {
    const [product] = await sql`
      select p.id, p.slug, p.type, p.title, p.description, p.tags, p.seo, p.image_url, p.image_alt,
             p.min_price_amount, p.max_price_amount, p.currency::text as currency
        from sellbase.storefront_products p
       where p.store_id = ${storeId} and p.slug = ${params.slug}`;
    if (!product)
      throw notFound('Product', params.slug, 'List products with GET /storefront/products.');
    const variants = await sql`
      select sv.id, sv.sku, sv.title, sv.option_values, sv.price_amount, sv.compare_at_amount, sv.currency::text as currency,
             sv.available, sv.available_quantity,
             case when ss.variant_id is null then null
                  else jsonb_build_object('duration_min', ss.duration_min, 'deposit_amount', ss.deposit_amount, 'location_type', ss.location_type) end as service
        from sellbase.storefront_variants sv left join sellbase.service_specs ss on ss.variant_id = sv.id
       where sv.product_id = ${product.id} order by sv.position, sv.id`;
    const options = await sql`
      select o.name, array_agg(v.value order by v.position) as values
        from sellbase.product_options o join sellbase.product_option_values v on v.option_id = o.id
       where o.product_id = ${product.id} group by o.id, o.name, o.position order by o.position`;
    const media = await sql`
      select url, alt, kind, variant_id from sellbase.product_media
       where product_id = ${product.id} order by position`;
    return { ...product, variants, options, media } as never;
  });

  // ── Carts ──────────────────────────────────────────────────────────────────
  register(app, deps, options, routes.cartCreate, async ({ storeId, body }) => {
    const store = await loadStore(sql, storeId);
    const token = randomToken(24);
    await sql`
      insert into sellbase.carts (store_id, token, currency, email)
      values (${storeId}, ${token}, ${body.currency ?? store.default_currency}, ${body.email ?? null})`;
    return cartView(sql, storeId, token, deps.now());
  });

  register(app, deps, options, routes.cartGet, ({ storeId, params }) =>
    cartView(sql, storeId, params.token, deps.now()),
  );

  register(app, deps, options, routes.cartItemAdd, async ({ storeId, params, body }) => {
    const cart = await loadCart(sql, storeId, params.token);
    assertCartOpen(cart);
    const [variant] = await sql<{ currency: string }[]>`
      select currency::text as currency from sellbase.storefront_variants
       where id = ${body.variant_id} and store_id = ${storeId}`;
    if (!variant) {
      throw notFound(
        'Variant',
        body.variant_id,
        'Get variant ids from GET /storefront/products/:slug.',
      );
    }
    if (variant.currency !== cart.currency) {
      throw sellbaseError(
        'CURRENCY_MISMATCH',
        `This product is priced in ${variant.currency} but the cart uses ${cart.currency}.`,
        `Create a cart in ${variant.currency} for this product.`,
      );
    }
    const service = await loadService(sql, storeId, body.variant_id);
    if (service) {
      if (!body.booking_slot) {
        throw sellbaseError(
          'VALIDATION_ERROR',
          `${service.title} is a service: choose a time.`,
          `Send booking_slot.starts_at from GET /storefront/availability?variant_id=${body.variant_id}.`,
        );
      }
      // Soft check now; the hold at checkout is the real guarantee.
      const booking = await resolveBooking(
        sql,
        service,
        new Date(body.booking_slot.starts_at),
        deps.now(),
        body.booking_slot.resource_id,
      );
      await sql`
        insert into sellbase.cart_items (store_id, cart_id, variant_id, quantity, booking_slot)
        values (${storeId}, ${cart.id}, ${body.variant_id}, 1,
                ${sql.json({ starts_at: booking.starts_at.toISOString(), ...(body.booking_slot.resource_id ? { resource_id: body.booking_slot.resource_id } : {}) } as never)})`;
    } else {
      if (body.booking_slot) {
        throw sellbaseError(
          'VALIDATION_ERROR',
          'booking_slot is only for services.',
          'Remove booking_slot for this product.',
        );
      }
      await sql`
        insert into sellbase.cart_items (store_id, cart_id, variant_id, quantity)
        values (${storeId}, ${cart.id}, ${body.variant_id}, ${body.quantity})
        on conflict (cart_id, variant_id) where booking_slot is null
        do update set quantity = least(sellbase.cart_items.quantity + excluded.quantity, 999)`;
    }
    await sql`update sellbase.carts set updated_at = now() where id = ${cart.id}`;
    return cartView(sql, storeId, params.token, deps.now());
  });

  register(app, deps, options, routes.cartItemUpdate, async ({ storeId, params, body }) => {
    const cart = await loadCart(sql, storeId, params.token);
    assertCartOpen(cart);
    const updated = await sql`
      update sellbase.cart_items set quantity = ${body.quantity}
       where id = ${params.item_id} and cart_id = ${cart.id} returning id`;
    if (updated.length === 0)
      throw notFound(
        'Cart item',
        params.item_id,
        'Get item ids from GET /storefront/carts/:token.',
      );
    return cartView(sql, storeId, params.token, deps.now());
  });

  register(app, deps, options, routes.cartItemRemove, async ({ storeId, params }) => {
    const cart = await loadCart(sql, storeId, params.token);
    assertCartOpen(cart);
    await sql`delete from sellbase.cart_items where id = ${params.item_id} and cart_id = ${cart.id}`;
    return cartView(sql, storeId, params.token, deps.now());
  });

  register(app, deps, options, routes.cartDiscountApply, async ({ storeId, params, body }) => {
    const cart = await loadCart(sql, storeId, params.token);
    assertCartOpen(cart);
    const code = body.code.trim().toUpperCase();
    await assertCodeUsable(sql, storeId, code, deps.now());
    await sql`
      update sellbase.carts set discount_codes = array(select distinct unnest(discount_codes || ${sql.array([code])}))
       where id = ${cart.id}`;
    const view = await cartView(sql, storeId, params.token, deps.now());
    const rejected = view.rejected_discounts.find((d) => d.code === code);
    if (rejected) {
      await sql`update sellbase.carts set discount_codes = array_remove(discount_codes, ${code}) where id = ${cart.id}`;
      throw sellbaseError(
        rejected.reason === 'DISCOUNT_MIN_SUBTOTAL_NOT_MET'
          ? 'DISCOUNT_MIN_SUBTOTAL_NOT_MET'
          : 'DISCOUNT_NOT_APPLICABLE',
        `Discount code "${code}" does not apply to this cart.`,
        rejected.hint,
        { code },
      );
    }
    return view;
  });

  register(app, deps, options, routes.cartDiscountRemove, async ({ storeId, params }) => {
    const cart = await loadCart(sql, storeId, params.token);
    assertCartOpen(cart);
    await sql`update sellbase.carts set discount_codes = array_remove(discount_codes, ${params.code.toUpperCase()}) where id = ${cart.id}`;
    return cartView(sql, storeId, params.token, deps.now());
  });

  register(app, deps, options, routes.cartShippingRates, async ({ storeId, params, body }) => {
    const view = await cartView(sql, storeId, params.token, deps.now());
    if (!view.requires_shipping) return { rates: [] };
    const shipping = await deps.shipping(storeId);
    const rates = await shipping.quote({
      from: null,
      to: body.address ?? null,
      parcels: [],
      currency: view.currency,
      subtotal_amount: view.totals.subtotal_amount - view.totals.discount_amount,
    });
    return { rates };
  });

  // ── Checkout ───────────────────────────────────────────────────────────────
  register(app, deps, options, routes.checkoutStart, async ({ storeId, body }) => {
    const store = await loadStore(sql, storeId);
    const cart = await loadCart(sql, storeId, body.cart_token);
    assertCartOpen(cart);
    const lines = await loadCartLines(sql, cart.id);
    const discounts = await loadDiscounts(sql, storeId, cart.discount_codes, deps.now());

    const needsShipping = lines.some((l) => l.product_type === 'physical' && l.requires_shipping);
    let shippingAmount = 0;
    let shippingSelection: Record<string, unknown> | null = null;
    if (needsShipping) {
      if (!body.shipping_rate_id) {
        throw sellbaseError(
          'VALIDATION_ERROR',
          'This cart has items to ship; choose a shipping option.',
          'Get options from POST /storefront/carts/:token/shipping-rates and send shipping_rate_id.',
        );
      }
      const preview = await cartView(sql, storeId, cart.token, deps.now());
      const rates = await (
        await deps.shipping(storeId)
      ).quote({
        from: null,
        to: body.shipping_address ?? null,
        parcels: [],
        currency: cart.currency,
        subtotal_amount: preview.totals.subtotal_amount - preview.totals.discount_amount,
      });
      const rate = rates.find((r) => r.id === body.shipping_rate_id);
      if (!rate) {
        throw sellbaseError(
          'VALIDATION_ERROR',
          `Shipping option "${body.shipping_rate_id}" is not available for this cart.`,
          'Request fresh options with POST /storefront/carts/:token/shipping-rates.',
          { available: rates.map((r) => r.id) },
        );
      }
      if (rate.requires_address && !body.shipping_address) {
        throw sellbaseError(
          'VALIDATION_ERROR',
          'A shipping address is required for this option.',
          'Send shipping_address.',
        );
      }
      shippingAmount = rate.amount;
      shippingSelection = rate as unknown as Record<string, unknown>;
    }

    const plan = planCheckout({
      currency: cart.currency,
      lines,
      discounts,
      shipping_amount: shippingAmount,
      tax: store.tax,
    });
    const unavailable = lines.find((l) => !l.tracked_available);
    if (unavailable) {
      throw sellbaseError(
        'OUT_OF_STOCK',
        `Only ${Math.max(unavailable.available_quantity ?? 0, 0)} left of "${unavailable.title}".`,
        'Lower the quantity or remove the item, then retry checkout.',
        { variant_id: unavailable.variant_id },
      );
    }

    const depositNow =
      body.pay_mode === 'deposit'
        ? depositDue(
            lines,
            plan.lines.map((l) => l.total_amount),
          )
        : null;
    if (body.pay_mode === 'deposit' && depositNow === null) {
      throw sellbaseError(
        'VALIDATION_ERROR',
        'This cart has no deposit option.',
        'Deposits apply only to services with deposit_amount; use pay_mode "full".',
      );
    }
    const payments = await deps.payments(storeId);
    if (!payments) {
      throw sellbaseError(
        'VALIDATION_ERROR',
        'The store cannot take payments yet.',
        'The store owner must connect a payment provider: POST /integrations/stripe/connect.',
      );
    }

    // Services: resolve each chosen time into a resource and occupied range to hold.
    const { snapshot, hasBookings } = await withBookings(
      sql,
      storeId,
      plan.lines,
      lines.map((l) => l.booking_slot),
      deps.now(),
    );
    // Bookings are held longer than Stripe's minimum session (ADR 0008).
    const ttlMinutes = hasBookings ? BOOKING_TTL_MINUTES : CHECKOUT_TTL_MINUTES;

    const appliedIds = plan.totals.applied_discounts.map((d) => d.id);
    // Two statements on purpose: a volatile function in WHERE would run once per scanned row.
    const [created] = await sql<{ id: string }[]>`
      select sellbase.create_checkout_session(
         ${cart.id}, ${payments.id}, ${sql.json(snapshot as never)}, ${sql.json(plan.totals as never)},
         ${body.email}, ${body.shipping_address ? sql.json(body.shipping_address as never) : null},
         ${shippingSelection ? sql.json(shippingSelection as never) : null},
         ${sql.array(appliedIds)}::uuid[], ${`${ttlMinutes} minutes`}::interval) as id`;
    const [session] = await sql<{ id: string; expires_at: Date }[]>`
      select id, expires_at from sellbase.checkout_sessions where id = ${created?.id ?? null}`;
    if (!session) throw new Error('checkout session was not created');
    // Deposit: the session charges less than the order total, which stays in totals_snapshot.
    const charge =
      depositNow === null
        ? plan.totals.total_amount
        : depositNow +
          (plan.totals.total_amount - plan.lines.reduce((n, l) => n + l.total_amount, 0));
    if (depositNow !== null) {
      await sql`update sellbase.checkout_sessions set amount_total = ${charge}, pay_mode = 'deposit' where id = ${session.id}`;
    }
    await sql`update sellbase.carts set email = ${body.email} where id = ${cart.id}`;

    try {
      const result = await payments.createCheckout({
        checkout_session_id: session.id,
        store_id: storeId,
        currency: cart.currency,
        amount_total: charge,
        email: body.email,
        lines: plan.lines.map((l, i) => ({
          title:
            depositNow !== null && l.product_type === 'service'
              ? `Anticipo · ${l.title}`
              : l.variant_title
                ? `${l.title} — ${l.variant_title}`
                : l.title,
          quantity: l.quantity,
          total_amount:
            depositNow !== null && l.product_type === 'service' && lines[i]?.deposit_amount
              ? Math.min(lines[i]?.deposit_amount ?? 0, l.total_amount)
              : l.total_amount,
          ...(l.image_url ? { image_url: l.image_url } : {}),
        })),
        shipping_amount: plan.totals.shipping_amount - plan.totals.shipping_discount_amount,
        success_url: withCheckoutParam(body.success_url, session.id),
        cancel_url: body.cancel_url,
        expires_at: session.expires_at,
        locale: store.default_locale,
        idempotency_key: session.id,
      });
      await sql`update sellbase.checkout_sessions set provider_session_id = ${result.provider_session_id} where id = ${session.id}`;
      const base = {
        checkout_session_id: session.id,
        expires_at: session.expires_at.toISOString(),
      };
      return result.mode === 'redirect'
        ? { mode: 'redirect' as const, url: result.url, ...base }
        : { mode: 'embedded' as const, client_secret: result.client_secret, ...base };
    } catch (error) {
      await sql`select sellbase.release_checkout_session(${session.id})`;
      throw error;
    }
  });

  // ── Downloads ──────────────────────────────────────────────────────────────
  register(app, deps, options, routes.checkoutStatus, async ({ storeId, params }) => {
    const [row] = await sql<{ status: string; number: number | null; email: string | null }[]>`
      select cs.status, o.number, o.email::text as email
        from sellbase.checkout_sessions cs
        left join sellbase.orders o on o.id = cs.order_id
       where cs.id = ${params.id} and cs.store_id = ${storeId}`;
    if (!row)
      throw notFound('Checkout', params.id, 'Use the sellbase_checkout value from the return URL.');
    return {
      checkout_session_id: params.id,
      status:
        row.status === 'completed'
          ? ('paid' as const)
          : row.status === 'expired'
            ? ('expired' as const)
            : ('pending' as const),
      order:
        row.number !== null && row.email
          ? { number: row.number, email: maskEmail(row.email) }
          : null,
    };
  });

  register(app, deps, options, routes.downloadGet, async ({ storeId, params }) => {
    const hash = await sha256Hex(params.grant_token);
    const [grant] = await sql<
      { id: string; storage_path: string; expired: boolean; exhausted: boolean }[]
    >`
      select g.id, a.storage_path, g.expires_at <= now() as expired,
             (g.download_limit is not null and g.downloads_used >= g.download_limit) as exhausted
        from sellbase.digital_grants g join sellbase.digital_assets a on a.id = g.digital_asset_id
       where g.token_hash = ${hash} and g.store_id = ${storeId}`;
    const help = 'Contact the store to get a new download link.';
    if (!grant) throw sellbaseError('NOT_FOUND', 'This download link is not valid.', help);
    if (grant.expired) throw sellbaseError('FORBIDDEN', 'This download link has expired.', help);
    if (grant.exhausted)
      throw sellbaseError('FORBIDDEN', 'This download link reached its download limit.', help);
    await sql`update sellbase.digital_grants set downloads_used = downloads_used + 1 where id = ${grant.id}`;
    return { redirect: await deps.storage.signedUrl('sellbase-digital', grant.storage_path, 300) };
  });
}
