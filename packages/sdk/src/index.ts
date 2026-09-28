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
  toMinorUnits,
  toDecimalString,
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
export type StorefrontCollection = RouteResponse<'storefrontCollectionGet'>;
export type OrderSummary = RouteResponse<'orderLookup'>;
export type CheckoutStatus = RouteResponse<'checkoutStatus'>;
export type DownloadInfo = RouteResponse<'downloadInfo'>;
export type StorefrontStore = RouteResponse<'storefrontStore'>;
export type AdminProduct = RouteResponse<'productGet'>;
export type InventoryItem = RouteResponse<'inventoryList'>['data'][number];
export type AbandonedCheckout = RouteResponse<'abandonedCheckoutsList'>['data'][number];
export { catalogSitemap, productJsonLd, productMetadata, sitemapXml } from './seo.js';

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
    store: {
      /** Name, logo, currency and the checkbox checkout requires (if any). */
      get: () => request('storefrontStore', {}),
    },
    availability: {
      /** Free start times for a service variant (instants; show them in `timezone`). */
      get: (variantId: string, range: { from?: string; to?: string } = {}) =>
        request('availabilityGet', { query: { variant_id: variantId, ...range } }),
    },
    products: {
      list: (query: Query<'storefrontProductsList'> = {}) =>
        request('storefrontProductsList', { query }),
      get: (slug: string) => request('storefrontProductGet', { params: { slug } }),
    },
    collections: {
      /** Collections with active products, for navigation. */
      list: () => request('storefrontCollectionsList', {}),
      get: (slug: string) => request('storefrontCollectionGet', { params: { slug } }),
    },
    orders: {
      /** A buyer looks up their order with its number and email (rate limited). */
      lookup: (number: number, email: string) =>
        request('orderLookup', { body: { number, email } }),
    },
    cart: {
      create: (body: Body<'cartCreate'> = {}) => request('cartCreate', { body }),
      get: (token: string) => request('cartGet', { params: { token } }),
      add: (
        token: string,
        variantId: string,
        quantity = 1,
        bookingSlot?: { starts_at: string; resource_id?: string },
      ) =>
        request('cartItemAdd', {
          params: { token },
          body: {
            variant_id: variantId,
            quantity,
            ...(bookingSlot ? { booking_slot: bookingSlot } : {}),
          },
        }),
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
      /**
       * For the return page: pass the `sellbase_checkout` query value. "pending" means the
       * payment webhook has not arrived yet; poll every few seconds.
       */
      status: (checkoutSessionId: string) =>
        request('checkoutStatus', { params: { id: checkoutSessionId } }),
    },
    downloads: {
      url: (grantToken: string) =>
        `${baseUrl}/storefront/downloads/${encodeURIComponent(grantToken)}`,
      /** What the link gives and whether it still works (does not count a download). */
      info: (grantToken: string) =>
        request('downloadInfo', { params: { grant_token: grantToken } }),
    },
    admin: {
      products: {
        search: (query: Query<'productsList'> = {}) => request('productsList', { query }),
        /** CSV (our template, Spanish headers or a Shopify export). Try dry_run first. */
        import: (body: Body<'productsImport'>) => request('productsImport', { body }),
        /** Status or price for many products; price changes preview unless confirm is true. */
        bulk: (body: Body<'productsBulk'>) => request('productsBulk', { body }),
        get: (id: string) => request('productGet', { params: { id } }),
        upsert: (body: Body<'productUpsert'>) => request('productUpsert', { body }),
        archive: (id: string) => request('productArchive', { params: { id } }),
        addMedia: (id: string, body: Body<'productMediaAdd'>) =>
          request('productMediaAdd', { params: { id }, body }),
        /** New image order (first = main image) and alt texts. */
        updateMedia: (id: string, media: Body<'productMediaUpdate'>['media']) =>
          request('productMediaUpdate', { params: { id }, body: { media } }),
        removeMedia: (id: string, mediaId: string) =>
          request('productMediaDelete', { params: { id, media_id: mediaId } }),
      },
      variants: {
        /** Attach the file buyers receive (base64, max 10 MB) to a digital variant. */
        uploadFile: (variantId: string, body: Body<'digitalAssetUpload'>) =>
          request('digitalAssetUpload', { params: { id: variantId }, body }),
      },
      resources: {
        list: () => request('resourcesList', {}),
        upsert: (body: Body<'resourceUpsert'>) => request('resourceUpsert', { body }),
        addException: (id: string, body: Body<'resourceExceptionAdd'>) =>
          request('resourceExceptionAdd', { params: { id }, body }),
        removeException: (id: string, exceptionId: string) =>
          request('resourceExceptionRemove', { params: { id, exception_id: exceptionId } }),
      },
      bookings: {
        search: (query: Query<'bookingsList'> = {}) => request('bookingsList', { query }),
        complete: (id: string) => request('bookingComplete', { params: { id } }),
        noShow: (id: string) => request('bookingNoShow', { params: { id } }),
        cancel: (id: string, body: Body<'bookingCancel'>) =>
          request('bookingCancel', { params: { id }, body }),
        reschedule: (id: string, body: Body<'bookingReschedule'>) =>
          request('bookingReschedule', { params: { id }, body }),
      },
      inventory: {
        list: (query: Query<'inventoryList'> = {}) => request('inventoryList', { query }),
        adjust: (body: Body<'inventoryAdjust'>) => request('inventoryAdjust', { body }),
      },
      orders: {
        search: (query: Query<'ordersList'> = {}) => request('ordersList', { query }),
        get: (id: string) => request('orderGet', { params: { id } }),
        /** Manual order: paid outside the store (confirm: true) or with a payment link. */
        create: (body: Body<'orderCreate'>) => request('orderCreate', { body }),
        fulfill: (id: string, body: Body<'orderFulfill'> = {}) =>
          request('orderFulfill', { params: { id }, body }),
        cancel: (id: string, body: Body<'orderCancel'>) =>
          request('orderCancel', { params: { id }, body }),
        refund: (id: string, body: Body<'orderRefund'>, idempotencyKey?: string) =>
          request('orderRefund', {
            params: { id },
            body,
            ...(idempotencyKey ? { idempotencyKey } : {}),
          }),
        note: (id: string, note: string) =>
          request('orderNote', { params: { id }, body: { note } }),
        /** Payment link for the balance of a deposit order. */
        paymentLink: (id: string, body: Body<'orderPaymentLink'> = {}) =>
          request('orderPaymentLink', { params: { id }, body }),
        notify: (id: string, template: Body<'orderNotify'>['template'] = 'order_confirmation') =>
          request('orderNotify', { params: { id }, body: { template } }),
      },
      checkouts: {
        /** Abandoned carts: checkouts with an email that were not paid. */
        abandoned: (query: Query<'abandonedCheckoutsList'> = {}) =>
          request('abandonedCheckoutsList', { query }),
        sendRecovery: (id: string, resend = false) =>
          request('abandonedCheckoutRecover', { params: { id }, body: { resend } }),
      },
      collections: {
        list: () => request('collectionsList', {}),
        upsert: (body: Body<'collectionUpsert'>) => request('collectionUpsert', { body }),
        delete: (id: string) => request('collectionDelete', { params: { id } }),
      },
      customers: {
        search: (query: Query<'customersList'> = {}) => request('customersList', { query }),
        get: (id: string) => request('customerGet', { params: { id } }),
      },
      discounts: {
        list: (query: Query<'discountsList'> = {}) => request('discountsList', { query }),
        upsert: (body: Body<'discountUpsert'>) => request('discountUpsert', { body }),
        /** Deletes an unused discount; a used one is disabled instead. */
        delete: (id: string) => request('discountDelete', { params: { id } }),
      },
      reports: {
        summary: () => request('reportsSummary', {}),
      },
      team: {
        list: () => request('teamList', {}),
        invite: (body: Body<'teamInvite'>) => request('teamInvite', { body }),
        setRole: (userId: string, role: Body<'teamUpdate'>['role']) =>
          request('teamUpdate', { params: { user_id: userId }, body: { role } }),
        remove: (userId: string) => request('teamRemove', { params: { user_id: userId } }),
      },
      tokens: {
        list: () => request('tokensList', {}),
        /** The plain token is only in this response; store it right away. */
        create: (body: Body<'tokenCreate'>) => request('tokenCreate', { body }),
        revoke: (id: string) => request('tokenRevoke', { params: { id } }),
      },
      /** Who changed what: staff, AI agents (tokens), webhooks and the system. */
      audit: (query: Query<'auditList'> = {}) => request('auditList', { query }),
      webhooks: {
        list: () => request('webhooksList', {}),
        /** The signing secret is only in this response. */
        create: (body: Body<'webhookCreate'>) => request('webhookCreate', { body }),
        update: (id: string, body: Body<'webhookUpdate'>) =>
          request('webhookUpdate', { params: { id }, body }),
        delete: (id: string) => request('webhookDelete', { params: { id } }),
        test: (id: string) => request('webhookTest', { params: { id } }),
        deliveries: (id: string) => request('webhookDeliveries', { params: { id } }),
      },
      store: {
        get: () => request('storeGet', {}),
        update: (body: Body<'storeUpdate'>) => request('storeUpdate', { body }),
        uploadLogo: (body: Body<'storeLogoUpload'>) => request('storeLogoUpload', { body }),
      },
      integrations: {
        list: () => request('integrationsList', {}),
        connect: (provider: string, body: Body<'integrationConnect'>) =>
          request('integrationConnect', { params: { provider }, body }),
        test: (provider: string) => request('integrationTest', { params: { provider } }),
        /** Sends a sample order email to `to` through the connected email provider. */
        testEmail: (to: string) => request('notificationsTest', { body: { to } }),
        /** Live keys only: a minimum real charge the owner pays; refunded automatically. */
        liveCheck: (body: Body<'integrationLiveCheck'>) =>
          request('integrationLiveCheck', { body }),
      },
      doctor: () => request('doctor', {}),
      /** Real purchase in payment test mode; reports every step. */
      testPurchase: (body: Body<'testPurchase'> = {}) => request('testPurchase', { body }),
    },
  };
}

export type Sellbase = ReturnType<typeof createSellbase>;
