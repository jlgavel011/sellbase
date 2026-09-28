import type {
  CartView,
  CheckoutStatus,
  DownloadInfo,
  OrderSummary,
  ShippingRate,
  StorefrontCollection,
  StorefrontProduct,
  StorefrontProductSummary,
} from '@sellbase/sdk';
import { getConfig } from './config.js';

/**
 * A tiny HTTP client for the public storefront routes (no validation library in the
 * bundle; the server validates everything). Errors carry `code`, `message` and `hint`.
 */
export class SellbaseApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public hint: string,
    public status: number,
  ) {
    super(message);
    this.name = 'SellbaseError';
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { url, anonKey } = getConfig();
  if (!url) {
    throw new SellbaseApiError(
      'VALIDATION_ERROR',
      'Sellbase is not configured.',
      'Load sellbase/config.js before sellbase.js, or call Sellbase.configure({ url, anonKey }).',
      0,
    );
  }
  const base = url.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (anonKey) headers.apikey = anonKey;
  if (method !== 'GET') headers['idempotency-key'] = crypto.randomUUID();
  const res = await fetch(base + path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => null)) as
    (T & { error?: { code?: string; message?: string; hint?: string } }) | null;
  if (!res.ok) {
    const e = json?.error;
    throw new SellbaseApiError(
      e?.code ?? 'INTERNAL_ERROR',
      e?.message ?? `Request failed (${res.status}).`,
      e?.hint ?? '',
      res.status,
    );
  }
  return json as T;
}

const enc = encodeURIComponent;

export const api = {
  products: (query: { collection?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (query.collection) q.set('collection', query.collection);
    if (query.limit) q.set('limit', String(query.limit));
    const s = q.toString();
    return call<{ data: StorefrontProductSummary[] }>(
      'GET',
      `/storefront/products${s ? `?${s}` : ''}`,
    );
  },
  product: (slug: string) => call<StorefrontProduct>('GET', `/storefront/products/${enc(slug)}`),
  collection: (slug: string) =>
    call<StorefrontCollection>('GET', `/storefront/collections/${enc(slug)}`),
  availability: (variantId: string) =>
    call<{
      timezone: string;
      resources: { id: string; name: string }[];
      slots: { starts_at: string; ends_at: string; resource_ids: string[] }[];
    }>('GET', `/storefront/availability?variant_id=${enc(variantId)}`),
  createCart: () => call<CartView>('POST', '/storefront/carts', {}),
  cart: (token: string) => call<CartView>('GET', `/storefront/carts/${enc(token)}`),
  addItem: (token: string, variantId: string, quantity: number, slot?: { starts_at: string }) =>
    call<CartView>('POST', `/storefront/carts/${enc(token)}/items`, {
      variant_id: variantId,
      quantity,
      ...(slot ? { booking_slot: slot } : {}),
    }),
  updateItem: (token: string, itemId: string, quantity: number) =>
    call<CartView>('PATCH', `/storefront/carts/${enc(token)}/items/${enc(itemId)}`, { quantity }),
  removeItem: (token: string, itemId: string) =>
    call<CartView>('DELETE', `/storefront/carts/${enc(token)}/items/${enc(itemId)}`),
  applyDiscount: (token: string, code: string) =>
    call<CartView>('POST', `/storefront/carts/${enc(token)}/discounts`, { code }),
  removeDiscount: (token: string, code: string) =>
    call<CartView>('DELETE', `/storefront/carts/${enc(token)}/discounts/${enc(code)}`),
  shippingRates: (token: string, address?: Record<string, string>) =>
    call<{ rates: ShippingRate[] }>(
      'POST',
      `/storefront/carts/${enc(token)}/shipping-rates`,
      address ? { address } : {},
    ),
  checkout: (body: Record<string, unknown>) =>
    call<{ mode: 'redirect'; url: string; checkout_session_id: string } | { mode: 'embedded' }>(
      'POST',
      '/storefront/checkout',
      body,
    ),
  checkoutStatus: (id: string) => call<CheckoutStatus>('GET', `/storefront/checkout/${enc(id)}`),
  lookup: (number: number, email: string) =>
    call<OrderSummary>('POST', '/storefront/orders/lookup', { number, email }),
  download: (token: string) =>
    call<DownloadInfo>('GET', `/storefront/downloads/${enc(token)}/info`),
};
