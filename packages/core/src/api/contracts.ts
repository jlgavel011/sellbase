import { z } from 'zod';
import {
  address,
  amount,
  bookingSlot,
  apiScope,
  staffRole,
  webhookEvent,
  collection,
  collectionUpsertInput,
  customer,
  discountStatus,
  discountUpsertInput,
  discountView,
  manualOrderInput,
  orderChannel,
  productsBulkInput,
  currency,
  email,
  fulfillmentStatus,
  id,
  inventoryPolicy,
  order,
  orderItem,
  orderStatus,
  payment,
  paymentStatus,
  product,
  productStatus,
  productType,
  productUpsertInput,
  slug,
  store,
  storeUpdateInput,
  timestamp,
  variant,
  type ApiScope,
} from '../schemas/index.js';

/**
 * API contract (SPEC §7). Each route declares its schemas once; the Hono server
 * validates with them, OpenAPI 3.1 is generated from them and MCP tools reuse them.
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** `public`: storefront, no token. Otherwise a staff session or an API token with `scope`. */
export type RouteAuth = { kind: 'public' } | { kind: 'staff'; scope: ApiScope | null };

type AnyObject = z.ZodObject<z.ZodRawShape>;

export interface RouteDef {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  tag:
    | 'storefront'
    | 'catalog'
    | 'orders'
    | 'customers'
    | 'discounts'
    | 'reports'
    | 'team'
    | 'webhooks'
    | 'store'
    | 'integrations'
    | 'system';
  auth: RouteAuth;
  params?: AnyObject;
  query?: AnyObject;
  body?: z.ZodType;
  response: z.ZodType;
  /** 302 redirect instead of JSON. */
  redirect?: boolean;
}

const publicAuth = { kind: 'public' } as const;
const staff = (scope: ApiScope | null) => ({ kind: 'staff', scope }) as const;

export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), next_cursor: z.string().nullable() });

const pageQuery = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
};

// ── Views ────────────────────────────────────────────────────────────────────

export const storefrontProductSummary = z.object({
  id,
  slug,
  type: productType,
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  image_url: z.string().nullable(),
  image_alt: z.string().nullable(),
  min_price_amount: amount.nullable(),
  max_price_amount: amount.nullable(),
  currency: currency.nullable(),
});

export const storefrontVariant = z.object({
  id,
  sku: z.string().nullable(),
  title: z.string(),
  option_values: z.record(z.string(), z.string()),
  price_amount: amount,
  compare_at_amount: amount.nullable(),
  currency,
  available: z.boolean(),
  available_quantity: z.number().int().nullable(),
  service: z
    .object({
      duration_min: z.number().int(),
      deposit_amount: amount.nullable(),
      location_type: z.enum(['in_person', 'online']),
    })
    .nullable(),
});

export const storefrontProductDetail = storefrontProductSummary.extend({
  seo: z.object({ title: z.string().optional(), description: z.string().optional() }),
  options: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
  variants: z.array(storefrontVariant),
  media: z.array(
    z.object({
      url: z.string(),
      alt: z.string(),
      kind: z.enum(['image', 'video']),
      variant_id: id.nullable(),
    }),
  ),
});

export const cartLineView = z.object({
  id,
  variant_id: id,
  product_id: id,
  product_slug: slug,
  title: z.string(),
  variant_title: z.string().nullable(),
  sku: z.string().nullable(),
  image_url: z.string().nullable(),
  unit_price_amount: amount,
  quantity: z.number().int().positive(),
  subtotal_amount: amount,
  discount_amount: amount,
  total_amount: amount,
  available: z.boolean(),
  booking: z
    .object({
      starts_at: timestamp,
      ends_at: timestamp,
      resource_id: id.nullable(),
      resource_name: z.string().nullable(),
      timezone: z.string(),
    })
    .nullable(),
});

export const totalsView = z.object({
  currency,
  subtotal_amount: amount,
  discount_amount: amount,
  shipping_amount: amount,
  tax_amount: amount,
  tax_mode: z.enum(['inclusive', 'exclusive']),
  total_amount: amount,
  /** Amount due now with pay_mode "deposit"; null when no deposit applies. */
  deposit_amount: amount.nullable(),
});

export const cartView = z.object({
  token: z.string(),
  currency,
  status: z.enum(['open', 'converted', 'abandoned', 'expired']),
  email: z.string().nullable(),
  items: z.array(cartLineView),
  discount_codes: z.array(z.string()),
  rejected_discounts: z.array(
    z.object({ code: z.string().nullable(), reason: z.string(), hint: z.string() }),
  ),
  requires_shipping: z.boolean(),
  totals: totalsView,
});
export type CartView = z.infer<typeof cartView>;

export const shippingRateView = z.object({
  id: z.string(),
  carrier: z.string(),
  service: z.string(),
  amount,
  currency,
  requires_address: z.boolean(),
  estimated_days: z.object({ min: z.number().int(), max: z.number().int() }).optional(),
});

export const checkoutStartBody = z.object({
  cart_token: z.string().min(20),
  email: email.describe('Where the order confirmation and download links are sent.'),
  shipping_address: address.optional().describe('Required when the cart has items to ship.'),
  shipping_rate_id: z
    .string()
    .optional()
    .describe('An id from POST /storefront/carts/:token/shipping-rates.'),
  success_url: z.url().describe('Where the provider sends the buyer after paying.'),
  cancel_url: z.url().describe('Where the provider sends the buyer if they go back.'),
  pay_mode: z
    .enum(['full', 'deposit'])
    .default('full')
    .describe(
      'deposit: pay only the deposit of each service now (totals.deposit_amount); the rest is collected later.',
    ),
});

export const checkoutStartResponse = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('redirect'),
    checkout_session_id: id,
    expires_at: timestamp,
    url: z.url(),
  }),
  z.object({
    mode: z.literal('embedded'),
    checkout_session_id: id,
    expires_at: timestamp,
    client_secret: z.string(),
  }),
]);
export type CheckoutStartResponse = z.infer<typeof checkoutStartResponse>;

export const adminVariantView = variant.extend({
  inventory: z
    .object({ on_hand: z.number().int(), reserved: z.number().int(), policy: inventoryPolicy })
    .nullable(),
  physical: z
    .object({
      weight_g: z.number().int(),
      length_cm: z.number(),
      width_cm: z.number(),
      height_cm: z.number(),
      requires_shipping: z.boolean(),
    })
    .nullable(),
  digital_assets: z.array(z.object({ id, file_name: z.string(), size_bytes: z.number().int() })),
  service: z
    .object({
      duration_min: z.number().int(),
      buffer_before_min: z.number().int(),
      buffer_after_min: z.number().int(),
      capacity: z.number().int(),
      deposit_amount: amount.nullable(),
      location_type: z.enum(['in_person', 'online']),
      online_meeting_url: z.string().nullable(),
      booking_window_days: z.number().int(),
      min_notice_min: z.number().int(),
      slot_interval_min: z.number().int().nullable(),
    })
    .nullable(),
});

export const adminProductView = product.extend({
  variants: z.array(adminVariantView),
  resource_ids: z.array(id),
  media: z.array(z.object({ id, url: z.string(), alt: z.string(), position: z.number().int() })),
});

export const orderListItem = order.pick({
  id: true,
  number: true,
  channel: true,
  email: true,
  currency: true,
  total_amount: true,
  status: true,
  payment_status: true,
  fulfillment_status: true,
  placed_at: true,
});

export const fulfillmentView = z.object({
  id,
  type: z.enum(['shipment', 'digital', 'booking']),
  status: z.enum(['pending', 'fulfilled', 'cancelled']),
  items: z.array(z.object({ order_item_id: id, quantity: z.number().int() })),
  shipment: z
    .object({
      carrier: z.string().nullable(),
      tracking_number: z.string().nullable(),
      tracking_url: z.string().nullable(),
      status: z.string(),
    })
    .nullable(),
  created_at: timestamp,
});

export const refundView = z.object({
  id,
  amount,
  reason: z.string(),
  status: z.enum(['pending', 'succeeded', 'failed']),
  created_at: timestamp,
});

export const orderDetail = order.extend({
  items: z.array(orderItem.extend({ fulfilled_quantity: z.number().int() })),
  payments: z.array(payment),
  fulfillments: z.array(fulfillmentView),
  refunds: z.array(refundView),
  events: z.array(
    z.object({
      type: z.string(),
      message: z.string(),
      data: z.record(z.string(), z.unknown()),
      actor_type: z.string(),
      created_at: timestamp,
    }),
  ),
});

export const doctorCheck = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['ok', 'warn', 'fail']),
  message: z.string(),
  hint: z.string().nullable(),
});
export const doctorResponse = z.object({ ok: z.boolean(), checks: z.array(doctorCheck) });
export type DoctorResponse = z.infer<typeof doctorResponse>;

export const integrationView = z.object({
  provider: z.string(),
  kind: z.string(),
  status: z.enum(['connected', 'error', 'disabled']),
  config: z.record(z.string(), z.unknown()),
  connected_at: timestamp.nullable(),
  last_error: z.string().nullable(),
});

const cartTokenParam = z.object({ token: z.string().min(20) });

export const resourceView = z.object({
  id,
  name: z.string(),
  kind: z.enum(['staff', 'room', 'equipment']),
  timezone: z.string(),
  email: z.string().nullable(),
  active: z.boolean(),
  rules: z.array(
    z.object({ weekday: z.number().int(), start_time: z.string(), end_time: z.string() }),
  ),
  exceptions: z.array(
    z.object({
      id,
      starts_at: timestamp,
      ends_at: timestamp,
      kind: z.enum(['closed', 'open']),
      note: z.string().nullable(),
    }),
  ),
  product_ids: z.array(id),
});

export const bookingView = z.object({
  id,
  status: z.enum([
    'held',
    'confirmed',
    'completed',
    'no_show',
    'cancelled',
    'rescheduled',
    'expired',
  ]),
  starts_at: timestamp,
  ends_at: timestamp,
  timezone: z.string(),
  resource: z.object({ id, name: z.string() }),
  product: z.object({ id, title: z.string() }).nullable(),
  variant_id: id.nullable(),
  order: z.object({ id, number: z.number().int() }).nullable(),
  email: z.string().nullable(),
  meeting_url: z.string().nullable(),
  rescheduled_from: id.nullable(),
  notes: z.string().nullable(),
});

export const collectionView = collection.extend({
  product_ids: z.array(id),
});

export const customerListItem = customer
  .pick({
    id: true,
    email: true,
    phone: true,
    first_name: true,
    last_name: true,
    accepts_marketing: true,
    created_at: true,
  })
  .extend({
    orders_count: z.number().int(),
    total_spent_amount: amount.describe('Paid minus refunded, store currency.'),
    last_order_at: timestamp.nullable(),
  });

export const customerDetail = customer.extend({
  orders_count: z.number().int(),
  total_spent_amount: amount,
  currency,
  addresses: z.array(
    z.object({
      id,
      label: z.string().nullable(),
      line1: z.string(),
      line2: z.string().nullable(),
      city: z.string(),
      state: z.string().nullable(),
      postal_code: z.string(),
      country: z.string(),
      phone: z.string().nullable(),
      is_default: z.boolean(),
    }),
  ),
  orders: z.array(orderListItem),
  bookings: z.array(bookingView),
});

const salesPeriod = z.object({
  amount: amount.describe('Paid minus refunded on orders placed in the period.'),
  orders: z.number().int(),
  average_order_amount: amount,
});

export const reportSummary = z.object({
  currency,
  timezone: z.string(),
  sales: z.object({ today: salesPeriod, last_7_days: salesPeriod, last_30_days: salesPeriod }),
  daily: z
    .array(z.object({ date: z.string(), amount, orders: z.number().int() }))
    .describe('Last 30 days, oldest first, dates in the store time zone.'),
  top_products: z.array(
    z.object({
      product_id: id.nullable(),
      title: z.string(),
      quantity: z.number().int(),
      amount,
    }),
  ),
  orders_to_fulfill: z.number().int(),
  bookings_today: z.number().int(),
});

export const teamMemberView = z.object({
  user_id: id,
  email: z.string(),
  role: staffRole,
  invited: z.boolean().describe('True until the person signs in for the first time.'),
  last_sign_in_at: timestamp.nullable(),
  created_at: timestamp,
});

export const apiTokenView = z.object({
  id,
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(apiScope),
  created_at: timestamp,
  last_used_at: timestamp.nullable(),
  expires_at: timestamp.nullable(),
  revoked_at: timestamp.nullable(),
  actions_30d: z.number().int().describe('Audit log entries in the last 30 days.'),
});

export const webhookEndpointView = z.object({
  id,
  url: z.string(),
  description: z.string(),
  events: z.array(z.string()),
  enabled: z.boolean(),
  secret_prefix: z.string(),
  created_at: timestamp,
  stats: z.object({
    pending: z.number().int(),
    failed: z.number().int(),
    last_delivery_at: timestamp.nullable(),
    last_status: z.enum(['pending', 'succeeded', 'failed']).nullable(),
  }),
});

export const webhookDeliveryView = z.object({
  id,
  event_type: z.string(),
  status: z.enum(['pending', 'succeeded', 'failed']),
  attempts: z.number().int(),
  last_status_code: z.number().int().nullable(),
  last_error: z.string().nullable(),
  next_attempt_at: timestamp,
  delivered_at: timestamp.nullable(),
  created_at: timestamp,
});

export const auditEntryView = z.object({
  id,
  actor_type: z.enum(['staff', 'token', 'system', 'webhook']),
  actor_id: z.string().nullable(),
  actor_name: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entity_id: id.nullable(),
  diff: z.record(z.string(), z.unknown()),
  created_at: timestamp,
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Use HH:MM (24h), e.g. 09:00');

// ── Routes ───────────────────────────────────────────────────────────────────

export const routes = {
  // Storefront (public)
  storefrontProductsList: {
    id: 'storefrontProductsList',
    method: 'GET',
    path: '/storefront/products',
    summary: 'List active products',
    tag: 'storefront',
    auth: publicAuth,
    query: z.object({
      ...pageQuery,
      collection: slug.optional(),
      q: z.string().max(100).optional(),
    }),
    response: paginated(storefrontProductSummary),
  },
  storefrontProductGet: {
    id: 'storefrontProductGet',
    method: 'GET',
    path: '/storefront/products/:slug',
    summary: 'Get an active product with variants and media',
    tag: 'storefront',
    auth: publicAuth,
    params: z.object({ slug }),
    response: storefrontProductDetail,
  },
  cartCreate: {
    id: 'cartCreate',
    method: 'POST',
    path: '/storefront/carts',
    summary: 'Create a cart; keep the returned token in a cookie or localStorage',
    tag: 'storefront',
    auth: publicAuth,
    body: z.object({ currency: currency.optional(), email: email.optional() }),
    response: cartView,
  },
  cartGet: {
    id: 'cartGet',
    method: 'GET',
    path: '/storefront/carts/:token',
    summary: 'Get a cart with server-computed totals',
    tag: 'storefront',
    auth: publicAuth,
    params: cartTokenParam,
    response: cartView,
  },
  availabilityGet: {
    id: 'availabilityGet',
    method: 'GET',
    path: '/storefront/availability',
    summary: 'Free start times for a service variant',
    description:
      'Times are instants (ISO 8601, UTC); show them in `timezone`. Defaults to the next 14 days; at most 62 days per request.',
    tag: 'storefront',
    auth: publicAuth,
    query: z.object({ variant_id: id, from: timestamp.optional(), to: timestamp.optional() }),
    response: z.object({
      timezone: z.string(),
      resources: z.array(z.object({ id, name: z.string() })),
      slots: z.array(
        z.object({
          starts_at: timestamp,
          ends_at: timestamp,
          resource_ids: z.array(id),
          remaining: z.number().int(),
        }),
      ),
    }),
  },
  cartItemAdd: {
    id: 'cartItemAdd',
    method: 'POST',
    path: '/storefront/carts/:token/items',
    summary: 'Add a variant to the cart (adds to the quantity if already present)',
    description:
      'Services need `booking_slot` with a start time from GET /storefront/availability; each booking is its own line with quantity 1.',
    tag: 'storefront',
    auth: publicAuth,
    params: cartTokenParam,
    body: z.object({
      variant_id: id,
      quantity: z.number().int().min(1).max(999).default(1),
      booking_slot: bookingSlot.optional(),
    }),
    response: cartView,
  },
  cartItemUpdate: {
    id: 'cartItemUpdate',
    method: 'PATCH',
    path: '/storefront/carts/:token/items/:item_id',
    summary: 'Set the quantity of a cart line',
    tag: 'storefront',
    auth: publicAuth,
    params: cartTokenParam.extend({ item_id: id }),
    body: z.object({ quantity: z.number().int().min(1).max(999) }),
    response: cartView,
  },
  cartItemRemove: {
    id: 'cartItemRemove',
    method: 'DELETE',
    path: '/storefront/carts/:token/items/:item_id',
    summary: 'Remove a cart line',
    tag: 'storefront',
    auth: publicAuth,
    params: cartTokenParam.extend({ item_id: id }),
    response: cartView,
  },
  cartDiscountApply: {
    id: 'cartDiscountApply',
    method: 'POST',
    path: '/storefront/carts/:token/discounts',
    summary: 'Apply a discount code',
    tag: 'storefront',
    auth: publicAuth,
    params: cartTokenParam,
    body: z.object({ code: z.string().min(1).max(40) }),
    response: cartView,
  },
  cartDiscountRemove: {
    id: 'cartDiscountRemove',
    method: 'DELETE',
    path: '/storefront/carts/:token/discounts/:code',
    summary: 'Remove a discount code',
    tag: 'storefront',
    auth: publicAuth,
    params: cartTokenParam.extend({ code: z.string().min(1).max(40) }),
    response: cartView,
  },
  cartShippingRates: {
    id: 'cartShippingRates',
    method: 'POST',
    path: '/storefront/carts/:token/shipping-rates',
    summary: 'Quote shipping options for the cart',
    tag: 'storefront',
    auth: publicAuth,
    params: cartTokenParam,
    body: z.object({ address: address.optional() }),
    response: z.object({ rates: z.array(shippingRateView) }),
  },
  checkoutStart: {
    id: 'checkoutStart',
    method: 'POST',
    path: '/storefront/checkout',
    summary: 'Start checkout: reserves stock and returns where to pay',
    description:
      'Totals are recomputed on the server. Stock is held for 15 minutes. The order is created only when the payment provider confirms payment.',
    tag: 'storefront',
    auth: publicAuth,
    body: checkoutStartBody,
    response: checkoutStartResponse,
  },
  downloadGet: {
    id: 'downloadGet',
    method: 'GET',
    path: '/storefront/downloads/:grant_token',
    summary: 'Redirect to a short-lived signed URL for a purchased file',
    tag: 'storefront',
    auth: publicAuth,
    params: z.object({ grant_token: z.string().min(20) }),
    response: z.null(),
    redirect: true,
  },

  // Catalog (staff / agent)
  productsList: {
    id: 'productsList',
    method: 'GET',
    path: '/products',
    summary: 'Search products',
    tag: 'catalog',
    auth: staff('catalog:read'),
    query: z.object({
      ...pageQuery,
      q: z.string().max(100).optional(),
      status: productStatus.optional(),
      type: productType.optional(),
    }),
    response: paginated(adminProductView),
  },
  productsImport: {
    id: 'productsImport',
    method: 'POST',
    path: '/products/import',
    summary: 'Import products from CSV (our template, Spanish headers or a Shopify export)',
    description:
      'Rows with the same handle are variants of one product. Existing products (same handle/slug) are updated; variants match by SKU. Use dry_run first to see what would change.',
    tag: 'catalog',
    auth: staff('catalog:write'),
    body: z.object({
      csv: z.string().min(1).max(5_000_000),
      dry_run: z.boolean().default(false),
    }),
    response: z.object({
      dry_run: z.boolean(),
      created: z.number().int(),
      updated: z.number().int(),
      products: z.array(
        z.object({
          id: id.nullable(),
          slug: z.string(),
          title: z.string(),
          action: z.enum(['create', 'update']),
          variants: z.number().int(),
        }),
      ),
      errors: z.array(z.object({ row: z.number().int(), message: z.string(), hint: z.string() })),
    }),
  },
  productsBulk: {
    id: 'productsBulk',
    method: 'POST',
    path: '/products/bulk',
    summary: 'Publish, unpublish, archive or reprice many products at once',
    description:
      'Price changes are a money action: without confirm=true the response is only a preview of old and new prices.',
    tag: 'catalog',
    auth: staff('catalog:write'),
    body: productsBulkInput,
    response: z.object({
      applied: z.boolean(),
      updated: z.number().int(),
      preview: z.array(
        z.object({
          product_id: id,
          variant_id: id,
          title: z.string(),
          from_amount: amount,
          to_amount: amount,
        }),
      ),
    }),
  },
  productGet: {
    id: 'productGet',
    method: 'GET',
    path: '/products/:id',
    summary: 'Get a product with variants, inventory and specs',
    tag: 'catalog',
    auth: staff('catalog:read'),
    params: z.object({ id }),
    response: adminProductView,
  },
  productUpsert: {
    id: 'productUpsert',
    method: 'POST',
    path: '/products',
    summary: 'Create or update a full product of any type in one call',
    description:
      'Send `id` to update. Variants with `id` are updated, without are created, missing ones are archived.',
    tag: 'catalog',
    auth: staff('catalog:write'),
    body: productUpsertInput,
    response: adminProductView,
  },
  productArchive: {
    id: 'productArchive',
    method: 'DELETE',
    path: '/products/:id',
    summary: 'Archive a product (orders keep their snapshots)',
    tag: 'catalog',
    auth: staff('catalog:write'),
    params: z.object({ id }),
    response: adminProductView,
  },
  productMediaAdd: {
    id: 'productMediaAdd',
    method: 'POST',
    path: '/products/:id/media',
    summary: 'Add an image to a product from a URL or an uploaded file',
    description:
      'Send `url` to reference an existing image, or `file_name` + `content_base64` (max 5 MB) to upload it to the public media bucket.',
    tag: 'catalog',
    auth: staff('catalog:write'),
    params: z.object({ id }),
    body: z
      .object({
        url: z.url().optional(),
        file_name: z.string().min(1).max(200).optional(),
        content_base64: z.string().max(7_000_000).optional(),
        alt: z.string().max(200).default(''),
        variant_id: id.optional(),
      })
      .refine((b) => Boolean(b.url) !== Boolean(b.file_name && b.content_base64), {
        message: 'Send either `url`, or `file_name` with `content_base64`.',
      }),
    response: adminProductView,
  },
  digitalAssetUpload: {
    id: 'digitalAssetUpload',
    method: 'POST',
    path: '/variants/:id/digital-assets',
    summary: 'Upload the file buyers receive for a digital variant',
    description:
      'The file is stored in a private bucket and only reachable through short-lived signed links issued after payment. Max 10 MB per call.',
    tag: 'catalog',
    auth: staff('catalog:write'),
    params: z.object({ id }),
    body: z.object({
      file_name: z.string().min(1).max(200),
      content_base64: z.string().min(1).max(14_000_000),
      download_limit: z.number().int().positive().nullable().default(null),
      link_ttl_hours: z
        .number()
        .int()
        .positive()
        .max(24 * 365)
        .default(72),
    }),
    response: z.object({ id, file_name: z.string(), size_bytes: z.number().int() }),
  },
  inventoryAdjust: {
    id: 'inventoryAdjust',
    method: 'POST',
    path: '/inventory/adjust',
    summary: 'Adjust stock by a delta with a reason',
    tag: 'catalog',
    auth: staff('catalog:write'),
    body: z.object({
      variant_id: id,
      delta: z
        .number()
        .int()
        .refine((d) => d !== 0, 'delta cannot be 0'),
      reason: z.string().min(1).max(200),
      policy: inventoryPolicy.optional(),
    }),
    response: z.object({
      variant_id: id,
      on_hand: z.number().int(),
      reserved: z.number().int(),
      policy: inventoryPolicy,
    }),
  },

  // Orders
  ordersList: {
    id: 'ordersList',
    method: 'GET',
    path: '/orders',
    summary: 'Search orders',
    tag: 'orders',
    auth: staff('orders:read'),
    query: z.object({
      ...pageQuery,
      q: z.string().max(100).optional().describe('Order number or customer email'),
      status: orderStatus.optional(),
      channel: orderChannel.optional(),
      payment_status: paymentStatus.optional(),
      fulfillment_status: fulfillmentStatus.optional(),
      from: timestamp.optional(),
      to: timestamp.optional(),
    }),
    response: paginated(orderListItem),
  },
  orderCreate: {
    id: 'orderCreate',
    method: 'POST',
    path: '/orders',
    summary: 'Record a manual order (sale outside the storefront)',
    description:
      'payment.mode "paid": money was received in cash, transfer or terminal; needs confirm=true. payment.mode "link": the order waits in pending_payment and the response has a Stripe payment link. Stock is taken now either way. Services must be booked from the storefront.',
    tag: 'orders',
    auth: staff('orders:write'),
    body: manualOrderInput,
    response: z.object({ order: orderDetail, payment_url: z.url().nullable() }),
  },
  orderGet: {
    id: 'orderGet',
    method: 'GET',
    path: '/orders/:id',
    summary: 'Get an order with items, payments and timeline',
    tag: 'orders',
    auth: staff('orders:read'),
    params: z.object({ id }),
    response: orderDetail,
  },

  testPurchase: {
    id: 'testPurchase',
    method: 'POST',
    path: '/test-purchase',
    summary: 'Run a real end-to-end purchase in test mode and report every step',
    description:
      'Uses the payment provider test mode (never live keys): cart, checkout with stock reservation, payment, order, digital delivery, confirmation email and download link. Stock is restored afterwards and the order is flagged as a test.',
    tag: 'orders',
    auth: staff('orders:write'),
    body: z.object({
      variant_ids: z
        .array(id)
        .max(5)
        .optional()
        .describe('Defaults to one active physical and one active digital variant.'),
      email: email.default('test-purchase@example.com'),
    }),
    response: z.object({
      ok: z.boolean(),
      order_id: id.nullable(),
      order_number: z.number().int().nullable(),
      total_amount: amount.nullable(),
      currency: currency.nullable(),
      steps: z.array(
        z.object({
          step: z.string(),
          ok: z.boolean(),
          detail: z.string(),
          hint: z.string().nullable(),
        }),
      ),
    }),
  },

  orderFulfill: {
    id: 'orderFulfill',
    method: 'POST',
    path: '/orders/:id/fulfillments',
    summary: 'Mark items as shipped (manual shipping) with carrier and tracking',
    description:
      'Omit `items` to ship everything still pending. The customer gets a "your order is on its way" email unless notify_customer is false.',
    tag: 'orders',
    auth: staff('orders:write'),
    params: z.object({ id }),
    body: z.object({
      items: z
        .array(z.object({ order_item_id: id, quantity: z.number().int().positive() }))
        .optional(),
      carrier: z.string().max(80).optional(),
      tracking_number: z.string().max(120).optional(),
      tracking_url: z.url().optional(),
      notify_customer: z.boolean().default(true),
    }),
    response: orderDetail,
  },
  orderCancel: {
    id: 'orderCancel',
    method: 'POST',
    path: '/orders/:id/cancel',
    summary: 'Cancel an order, optionally refunding it and restocking items',
    description:
      'Money action: requires confirm=true. refund=true also needs the refunds:write scope. Download links are revoked.',
    tag: 'orders',
    auth: staff('orders:write'),
    params: z.object({ id }),
    body: z.object({
      reason: z.string().min(1).max(500),
      restock: z.boolean().default(true),
      refund: z.boolean().default(false),
      notify_customer: z.boolean().default(true),
      confirm: z.literal(true).describe('Must be true. Confirm the impact with the owner first.'),
    }),
    response: orderDetail,
  },
  orderRefund: {
    id: 'orderRefund',
    method: 'POST',
    path: '/orders/:id/refunds',
    summary: 'Refund all or part of an order through the payment provider',
    description:
      'Money action: requires confirm=true and the refunds:write scope. Omit amount to refund everything still refundable.',
    tag: 'orders',
    auth: staff('refunds:write'),
    params: z.object({ id }),
    body: z.object({
      amount: amount.refine((v) => v > 0, 'Refund amount must be positive').optional(),
      reason: z.string().min(1).max(500),
      notify_customer: z.boolean().default(true),
      confirm: z
        .literal(true)
        .describe('Must be true. Refunds move real money; confirm with the owner first.'),
    }),
    response: orderDetail,
  },
  orderPaymentLink: {
    id: 'orderPaymentLink',
    method: 'POST',
    path: '/orders/:id/payment-link',
    summary: 'Create a payment link for the balance still owed on an order',
    description:
      'For orders paid with a deposit. Send the URL to the customer; when paid, the order becomes "paid".',
    tag: 'orders',
    auth: staff('orders:write'),
    params: z.object({ id }),
    body: z.object({
      amount: amount
        .refine((v) => v > 0, 'Amount must be positive')
        .optional()
        .describe('Defaults to the whole balance.'),
      success_url: z.url().optional(),
      cancel_url: z.url().optional(),
    }),
    response: z.object({ url: z.url(), amount, currency, expires_at: timestamp }),
  },
  orderNote: {
    id: 'orderNote',
    method: 'POST',
    path: '/orders/:id/notes',
    summary: 'Add an internal note to the order timeline',
    tag: 'orders',
    auth: staff('orders:write'),
    params: z.object({ id }),
    body: z.object({ note: z.string().min(1).max(2000) }),
    response: orderDetail,
  },
  orderNotify: {
    id: 'orderNotify',
    method: 'POST',
    path: '/orders/:id/notifications',
    summary: 'Send an order email again (confirmation or shipment)',
    tag: 'orders',
    auth: staff('orders:write'),
    params: z.object({ id }),
    body: z.object({
      template: z.enum(['order_confirmation', 'order_shipped']).default('order_confirmation'),
    }),
    response: z.object({ queued: z.boolean(), to: z.string() }),
  },

  resourcesList: {
    id: 'resourcesList',
    method: 'GET',
    path: '/resources',
    summary: 'People, rooms or equipment that deliver services, with their weekly hours',
    tag: 'catalog',
    auth: staff('catalog:read'),
    response: z.object({ data: z.array(resourceView) }),
  },
  resourceUpsert: {
    id: 'resourceUpsert',
    method: 'POST',
    path: '/resources',
    summary: 'Create or update a resource, its weekly hours and the services it delivers',
    description:
      'rules replace the weekly hours (weekday 0 = Sunday … 6 = Saturday, local times in `timezone`); product_ids replace the services it delivers.',
    tag: 'catalog',
    auth: staff('catalog:write'),
    body: z.object({
      id: id.optional(),
      name: z.string().min(1).max(120),
      kind: z.enum(['staff', 'room', 'equipment']).default('staff'),
      timezone: z.string().optional().describe('IANA zone; defaults to the store time zone.'),
      email: email.nullable().optional(),
      active: z.boolean().optional(),
      rules: z
        .array(
          z.object({ weekday: z.number().int().min(0).max(6), start_time: hhmm, end_time: hhmm }),
        )
        .optional(),
      product_ids: z.array(id).optional(),
    }),
    response: resourceView,
  },
  resourceExceptionAdd: {
    id: 'resourceExceptionAdd',
    method: 'POST',
    path: '/resources/:id/exceptions',
    summary: 'Block time off (closed) or add extra hours (open) for a resource',
    tag: 'catalog',
    auth: staff('catalog:write'),
    params: z.object({ id }),
    body: z.object({
      starts_at: timestamp,
      ends_at: timestamp,
      kind: z.enum(['closed', 'open']).default('closed'),
      note: z.string().max(200).optional(),
    }),
    response: resourceView,
  },
  resourceExceptionRemove: {
    id: 'resourceExceptionRemove',
    method: 'DELETE',
    path: '/resources/:id/exceptions/:exception_id',
    summary: 'Remove a time-off or extra-hours exception',
    tag: 'catalog',
    auth: staff('catalog:write'),
    params: z.object({ id, exception_id: id }),
    response: resourceView,
  },
  bookingsList: {
    id: 'bookingsList',
    method: 'GET',
    path: '/bookings',
    summary: 'Appointments in a date range (the agenda)',
    tag: 'orders',
    auth: staff('orders:read'),
    query: z.object({
      from: timestamp.optional(),
      to: timestamp.optional(),
      resource_id: id.optional(),
      status: z.enum(['confirmed', 'completed', 'no_show', 'cancelled', 'rescheduled']).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
    response: z.object({ data: z.array(bookingView) }),
  },
  bookingComplete: {
    id: 'bookingComplete',
    method: 'POST',
    path: '/bookings/:id/complete',
    summary: 'Mark an appointment as done',
    tag: 'orders',
    auth: staff('orders:write'),
    params: z.object({ id }),
    response: bookingView,
  },
  bookingNoShow: {
    id: 'bookingNoShow',
    method: 'POST',
    path: '/bookings/:id/no-show',
    summary: 'Mark that the customer did not come',
    tag: 'orders',
    auth: staff('orders:write'),
    params: z.object({ id }),
    response: bookingView,
  },
  bookingCancel: {
    id: 'bookingCancel',
    method: 'POST',
    path: '/bookings/:id/cancel',
    summary: 'Cancel an appointment, optionally refunding it',
    description:
      'refund=true refunds the booked line through the payment provider (needs refunds:write). Requires confirm=true.',
    tag: 'orders',
    auth: staff('orders:write'),
    params: z.object({ id }),
    body: z.object({
      reason: z.string().min(1).max(500),
      refund: z.boolean().default(false),
      notify_customer: z.boolean().default(true),
      confirm: z.literal(true),
    }),
    response: bookingView,
  },
  bookingReschedule: {
    id: 'bookingReschedule',
    method: 'POST',
    path: '/bookings/:id/reschedule',
    summary: 'Move an appointment to another free time',
    description: 'Creates a new confirmed booking linked to the old one (status "rescheduled").',
    tag: 'orders',
    auth: staff('orders:write'),
    params: z.object({ id }),
    body: z.object({
      starts_at: timestamp,
      resource_id: id.optional(),
      notify_customer: z.boolean().default(true),
    }),
    response: bookingView,
  },

  // Store and integrations
  collectionsList: {
    id: 'collectionsList',
    method: 'GET',
    path: '/collections',
    summary: 'List collections with their product ids',
    tag: 'catalog',
    auth: staff('catalog:read'),
    response: z.object({ data: z.array(collectionView) }),
  },
  collectionUpsert: {
    id: 'collectionUpsert',
    method: 'POST',
    path: '/collections',
    summary: 'Create or update a collection and set its products',
    tag: 'catalog',
    auth: staff('catalog:write'),
    body: collectionUpsertInput,
    response: collectionView,
  },
  collectionDelete: {
    id: 'collectionDelete',
    method: 'DELETE',
    path: '/collections/:id',
    summary: 'Delete a collection (products are kept)',
    tag: 'catalog',
    auth: staff('catalog:write'),
    params: z.object({ id }),
    response: z.object({ id, deleted: z.literal(true) }),
  },
  customersList: {
    id: 'customersList',
    method: 'GET',
    path: '/customers',
    summary: 'Search customers by email or name',
    tag: 'customers',
    auth: staff('customers:read'),
    query: z.object({ ...pageQuery, q: z.string().max(100).optional() }),
    response: paginated(customerListItem),
  },
  customerGet: {
    id: 'customerGet',
    method: 'GET',
    path: '/customers/:id',
    summary: 'Get a customer with addresses, orders and bookings',
    tag: 'customers',
    auth: staff('customers:read'),
    params: z.object({ id }),
    response: customerDetail,
  },
  discountsList: {
    id: 'discountsList',
    method: 'GET',
    path: '/discounts',
    summary: 'List discounts (codes and automatic)',
    tag: 'discounts',
    auth: staff(null),
    query: z.object({
      status: discountStatus.optional(),
      q: z.string().max(40).optional().describe('Part of the code'),
    }),
    response: z.object({ data: z.array(discountView) }),
  },
  discountUpsert: {
    id: 'discountUpsert',
    method: 'POST',
    path: '/discounts',
    summary: 'Create or update a discount',
    description:
      'percent: value in basis points (1000 = 10%). fixed: minor units. free_shipping: value 0. code null = automatic discount.',
    tag: 'discounts',
    auth: staff('discounts:write'),
    body: discountUpsertInput,
    response: discountView,
  },
  discountDelete: {
    id: 'discountDelete',
    method: 'DELETE',
    path: '/discounts/:id',
    summary: 'Delete an unused discount; used ones are disabled so orders keep their history',
    tag: 'discounts',
    auth: staff('discounts:write'),
    params: z.object({ id }),
    response: z.object({ id, deleted: z.boolean(), status: discountStatus }),
  },
  reportsSummary: {
    id: 'reportsSummary',
    method: 'GET',
    path: '/reports/summary',
    summary: 'Sales today / 7 / 30 days, daily series, top products and pending work',
    tag: 'reports',
    auth: staff('orders:read'),
    response: reportSummary,
  },
  teamList: {
    id: 'teamList',
    method: 'GET',
    path: '/team',
    summary: 'Team members and their roles',
    tag: 'team',
    auth: staff('settings:write'),
    response: z.object({ data: z.array(teamMemberView) }),
  },
  teamInvite: {
    id: 'teamInvite',
    method: 'POST',
    path: '/team',
    summary: 'Invite someone by email (they get a link to set a password)',
    description:
      'Existing users are added right away. Only owners can add owners. redirect_to must be an allowed redirect URL in Supabase Auth.',
    tag: 'team',
    auth: staff('settings:write'),
    body: z.object({
      email,
      role: staffRole.default('staff'),
      redirect_to: z
        .url()
        .optional()
        .describe('Where the invite link lands, e.g. https://mystore.com/admin'),
    }),
    response: teamMemberView,
  },
  teamUpdate: {
    id: 'teamUpdate',
    method: 'PATCH',
    path: '/team/:user_id',
    summary: 'Change the role of a team member',
    tag: 'team',
    auth: staff('settings:write'),
    params: z.object({ user_id: id }),
    body: z.object({ role: staffRole }),
    response: teamMemberView,
  },
  teamRemove: {
    id: 'teamRemove',
    method: 'DELETE',
    path: '/team/:user_id',
    summary: 'Remove someone from the team (the store always keeps one owner)',
    tag: 'team',
    auth: staff('settings:write'),
    params: z.object({ user_id: id }),
    response: z.object({ user_id: id, removed: z.literal(true) }),
  },
  tokensList: {
    id: 'tokensList',
    method: 'GET',
    path: '/tokens',
    summary: 'API tokens (for AI agents and integrations), without their secret',
    tag: 'team',
    auth: staff('settings:write'),
    response: z.object({ data: z.array(apiTokenView) }),
  },
  tokenCreate: {
    id: 'tokenCreate',
    method: 'POST',
    path: '/tokens',
    summary: 'Create an API token; the full token is shown only in this response',
    description:
      'Defaults to the agent scopes (everything except refunds:write and webhooks:write). A token can only create tokens with scopes it has.',
    tag: 'team',
    auth: staff('settings:write'),
    body: z.object({
      name: z.string().min(1).max(100),
      scopes: z.array(apiScope).min(1).optional(),
      expires_in_days: z.number().int().min(1).max(3650).optional(),
    }),
    response: apiTokenView.extend({ token: z.string() }),
  },
  tokenRevoke: {
    id: 'tokenRevoke',
    method: 'DELETE',
    path: '/tokens/:id',
    summary: 'Revoke an API token right away',
    tag: 'team',
    auth: staff('settings:write'),
    params: z.object({ id }),
    response: apiTokenView,
  },
  auditList: {
    id: 'auditList',
    method: 'GET',
    path: '/audit',
    summary: 'Activity log: who (staff, AI agents, webhooks) changed what',
    tag: 'team',
    auth: staff('settings:write'),
    query: z.object({
      ...pageQuery,
      actor_type: z.enum(['staff', 'token', 'system', 'webhook']).optional(),
      actor_id: z.string().max(100).optional().describe('A token id or a user id'),
      entity: z.string().max(40).optional(),
    }),
    response: paginated(auditEntryView),
  },
  webhooksList: {
    id: 'webhooksList',
    method: 'GET',
    path: '/webhooks',
    summary: 'Outbound webhook endpoints with delivery stats',
    tag: 'webhooks',
    auth: staff('webhooks:write'),
    response: z.object({ data: z.array(webhookEndpointView), events: z.array(z.string()) }),
  },
  webhookCreate: {
    id: 'webhookCreate',
    method: 'POST',
    path: '/webhooks',
    summary: 'Subscribe a URL to store events; the signing secret is shown only here',
    description:
      'Needs webhooks:write; API tokens must also send confirm=true. Each POST carries Sellbase-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">. Failed deliveries retry for about a day.',
    tag: 'webhooks',
    auth: staff('webhooks:write'),
    body: z.object({
      url: z.url(),
      events: z.array(webhookEvent).default([]).describe('Empty = every event.'),
      description: z.string().max(200).default(''),
      confirm: z
        .boolean()
        .optional()
        .describe('Required (true) for API tokens: the endpoint receives customer and order data.'),
    }),
    response: webhookEndpointView.extend({ secret: z.string() }),
  },
  webhookUpdate: {
    id: 'webhookUpdate',
    method: 'PATCH',
    path: '/webhooks/:id',
    summary: 'Change the URL, events or pause an endpoint',
    tag: 'webhooks',
    auth: staff('webhooks:write'),
    params: z.object({ id }),
    body: z.object({
      url: z.url().optional(),
      events: z.array(webhookEvent).optional(),
      description: z.string().max(200).optional(),
      enabled: z.boolean().optional(),
      confirm: z
        .boolean()
        .optional()
        .describe('Required (true) for API tokens: the endpoint receives customer and order data.'),
    }),
    response: webhookEndpointView,
  },
  webhookDelete: {
    id: 'webhookDelete',
    method: 'DELETE',
    path: '/webhooks/:id',
    summary: 'Delete an endpoint and its secret',
    tag: 'webhooks',
    auth: staff('webhooks:write'),
    params: z.object({ id }),
    response: z.object({ id, deleted: z.literal(true) }),
  },
  webhookTest: {
    id: 'webhookTest',
    method: 'POST',
    path: '/webhooks/:id/test',
    summary: 'Send a signed webhook.test event now and report the response',
    tag: 'webhooks',
    auth: staff('webhooks:write'),
    params: z.object({ id }),
    response: webhookDeliveryView,
  },
  webhookDeliveries: {
    id: 'webhookDeliveries',
    method: 'GET',
    path: '/webhooks/:id/deliveries',
    summary: 'Last 50 deliveries of an endpoint',
    tag: 'webhooks',
    auth: staff('webhooks:write'),
    params: z.object({ id }),
    response: z.object({ data: z.array(webhookDeliveryView) }),
  },
  storeGet: {
    id: 'storeGet',
    method: 'GET',
    path: '/store',
    summary: 'Get store settings',
    tag: 'store',
    auth: staff(null),
    response: store,
  },
  storeUpdate: {
    id: 'storeUpdate',
    method: 'PATCH',
    path: '/store',
    summary: 'Update store settings',
    tag: 'store',
    auth: staff('settings:write'),
    body: storeUpdateInput,
    response: store,
  },
  integrationsList: {
    id: 'integrationsList',
    method: 'GET',
    path: '/integrations',
    summary: 'List integrations and their status',
    tag: 'integrations',
    auth: staff('integrations:write'),
    response: z.object({ data: z.array(integrationView) }),
  },
  integrationConnect: {
    id: 'integrationConnect',
    method: 'POST',
    path: '/integrations/:provider/connect',
    summary: 'Connect a provider with API keys (stored in Vault) or get a connect URL',
    description:
      'Stripe: when the project has a public https URL and no webhook_secret is sent, the webhook endpoint is created in Stripe automatically and its secret stored in Vault. Locally, run `stripe listen --forward-to <webhooks URL>` and send its whsec_ as webhook_secret.',
    tag: 'integrations',
    auth: staff('integrations:write'),
    params: z.object({ provider: z.string().min(1) }),
    body: z.object({
      secret_key: z.string().min(1).optional(),
      webhook_secret: z.string().min(1).optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      confirm: z
        .boolean()
        .optional()
        .describe(
          'Required (true) for live keys (sk_live_/rk_live_): customers will pay real money.',
        ),
    }),
    response: z.object({
      integration: integrationView,
      connect_url: z.url().nullable(),
      next_steps: z.array(z.string()).describe('What is still missing, in order.'),
    }),
  },
  integrationTest: {
    id: 'integrationTest',
    method: 'POST',
    path: '/integrations/:provider/test',
    summary: 'Test a provider connection and explain any error',
    tag: 'integrations',
    auth: staff('integrations:write'),
    params: z.object({ provider: z.string().min(1) }),
    response: z.object({ ok: z.boolean(), message: z.string() }),
  },
  integrationLiveCheck: {
    id: 'integrationLiveCheck',
    method: 'POST',
    path: '/integrations/stripe/live-check',
    summary: 'Real-money check: a minimum charge the owner pays, refunded automatically',
    description:
      'Live keys only. Returns a Stripe Checkout URL for the smallest amount Stripe allows (10 MXN, 0.50 USD). When its webhook arrives the charge is refunded and the integration is marked verified. Stripe keeps its fee. Needs confirm=true.',
    tag: 'integrations',
    auth: staff('integrations:write'),
    body: z.object({
      success_url: z.url().optional(),
      confirm: z
        .literal(true)
        .describe('The owner agreed to pay the minimum amount with a real card.'),
    }),
    response: z.object({
      live_check_id: id,
      url: z.url(),
      amount,
      currency,
      expires_at: timestamp,
    }),
  },
  doctor: {
    id: 'doctor',
    method: 'GET',
    path: '/doctor',
    summary: 'Setup checklist with a hint for each pending item',
    tag: 'system',
    auth: staff(null),
    response: doctorResponse,
  },
} as const satisfies Record<string, RouteDef>;

export type RouteId = keyof typeof routes;
export const routeList: readonly RouteDef[] = Object.values(routes);

/** Valid scopes, re-exported for token UIs. */
export const API_SCOPES = apiScope.options;
