import type { z } from 'zod';
import type { routes } from '@sellbase/core';
import { createClient, type RouteResponse, type SellbaseClientOptions } from './client.js';

export {
  createClient,
  type RouteArgs,
  type RouteId,
  type RouteResponse,
  type SellbaseClient,
  type SellbaseClientOptions,
} from './client.js';
export {
  formatMoney,
  isSellbaseError,
  type SellbaseError,
  type CartView,
  type CheckoutStartResponse,
  type Address,
} from '@sellbase/core';

type Body<K extends keyof typeof routes> = (typeof routes)[K] extends { body: z.ZodType }
  ? z.input<(typeof routes)[K]['body']>
  : never;
type Query<K extends keyof typeof routes> = (typeof routes)[K] extends { query: z.ZodType }
  ? z.input<(typeof routes)[K]['query']>
  : never;

export type StorefrontProduct = RouteResponse<'storefrontProductGet'>;
export type StorefrontProductSummary = RouteResponse<'storefrontProductsList'>['data'][number];
export type ShippingRate = RouteResponse<'cartShippingRates'>['rates'][number];
export type CheckoutInput = Body<'checkoutStart'>;

/**
 * Friendly client for storefronts and agents. Every method maps to one API route; money
 * is always an integer in minor units (use formatMoney to display it).
 *
 *   const sellbase = createSellbase({ url: process.env.NEXT_PUBLIC_SELLBASE_URL! });
 *   const { data } = await sellbase.products.list();
 */
export function createSellbase(options: SellbaseClientOptions) {
  const { request, baseUrl } = createClient(options);

  return {
    baseUrl,
    request,
    products: {
      list: (query: Query<'storefrontProductsList'> = {}) =>
        request('storefrontProductsList', { query }),
      get: (slug: string) => request('storefrontProductGet', { params: { slug } }),
    },
    cart: {
      create: (body: Body<'cartCreate'> = {}) => request('cartCreate', { body }),
      get: (token: string) => request('cartGet', { params: { token } }),
      add: (token: string, variantId: string, quantity = 1) =>
        request('cartItemAdd', { params: { token }, body: { variant_id: variantId, quantity } }),
      update: (token: string, itemId: string, quantity: number) =>
        request('cartItemUpdate', { params: { token, item_id: itemId }, body: { quantity } }),
      remove: (token: string, itemId: string) =>
        request('cartItemRemove', { params: { token, item_id: itemId } }),
      applyDiscount: (token: string, code: string) =>
        request('cartDiscountApply', { params: { token }, body: { code } }),
      removeDiscount: (token: string, code: string) =>
        request('cartDiscountRemove', { params: { token, code } }),
      shippingRates: (token: string, address?: Body<'cartShippingRates'>['address']) =>
        request('cartShippingRates', { params: { token }, body: address ? { address } : {} }),
    },
    checkout: {
      /** Reserves stock and returns where to pay. Redirect the buyer to `url`. */
      start: (input: CheckoutInput, idempotencyKey?: string) =>
        request('checkoutStart', { body: input, ...(idempotencyKey ? { idempotencyKey } : {}) }),
    },
    downloads: {
      url: (grantToken: string) =>
        `${baseUrl}/storefront/downloads/${encodeURIComponent(grantToken)}`,
    },
    admin: {
      products: {
        search: (query: Query<'productsList'> = {}) => request('productsList', { query }),
        get: (id: string) => request('productGet', { params: { id } }),
        upsert: (body: Body<'productUpsert'>) => request('productUpsert', { body }),
        archive: (id: string) => request('productArchive', { params: { id } }),
      },
      inventory: {
        adjust: (body: Body<'inventoryAdjust'>) => request('inventoryAdjust', { body }),
      },
      orders: {
        search: (query: Query<'ordersList'> = {}) => request('ordersList', { query }),
        get: (id: string) => request('orderGet', { params: { id } }),
      },
      store: {
        get: () => request('storeGet', {}),
        update: (body: Body<'storeUpdate'>) => request('storeUpdate', { body }),
      },
      integrations: {
        list: () => request('integrationsList', {}),
        connect: (provider: string, body: Body<'integrationConnect'>) =>
          request('integrationConnect', { params: { provider }, body }),
        test: (provider: string) => request('integrationTest', { params: { provider } }),
      },
      doctor: () => request('doctor', {}),
    },
  };
}

export type Sellbase = ReturnType<typeof createSellbase>;
