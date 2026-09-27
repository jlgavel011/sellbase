import { z } from 'zod';
import {
  address,
  amount,
  apiScope,
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
  tag: 'storefront' | 'catalog' | 'orders' | 'store' | 'integrations' | 'system';
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
});

export const totalsView = z.object({
  currency,
  subtotal_amount: amount,
  discount_amount: amount,
  shipping_amount: amount,
  tax_amount: amount,
  tax_mode: z.enum(['inclusive', 'exclusive']),
  total_amount: amount,
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
});

export const adminProductView = product.extend({
  variants: z.array(adminVariantView),
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

export const orderDetail = order.extend({
  items: z.array(orderItem),
  payments: z.array(payment),
  events: z.array(
    z.object({
      type: z.string(),
      message: z.string(),
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
  cartItemAdd: {
    id: 'cartItemAdd',
    method: 'POST',
    path: '/storefront/carts/:token/items',
    summary: 'Add a variant to the cart (adds to the quantity if already present)',
    tag: 'storefront',
    auth: publicAuth,
    params: cartTokenParam,
    body: z.object({ variant_id: id, quantity: z.number().int().min(1).max(999).default(1) }),
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
      payment_status: paymentStatus.optional(),
      fulfillment_status: fulfillmentStatus.optional(),
      from: timestamp.optional(),
      to: timestamp.optional(),
    }),
    response: paginated(orderListItem),
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

  // Store and integrations
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
    tag: 'integrations',
    auth: staff('integrations:write'),
    params: z.object({ provider: z.string().min(1) }),
    body: z.object({
      secret_key: z.string().min(1).optional(),
      webhook_secret: z.string().min(1).optional(),
      config: z.record(z.string(), z.unknown()).optional(),
    }),
    response: z.object({ integration: integrationView, connect_url: z.url().nullable() }),
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
