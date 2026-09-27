import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  BRAND,
  collectionUpsertInput,
  discountUpsertInput,
  fromZodError,
  manualOrderInput,
  productsBulkInput,
  isSellbaseError,
  productUpsertInput,
  storeUpdateInput,
  toErrorResponse,
  WEBHOOK_EVENTS,
} from '@sellbase/core';
import type { Sellbase } from '@sellbase/sdk';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';

/**
 * Sellbase MCP server (SPEC §13). Few tools, named for what an agent wants to do, each
 * description says when to use it. Mutations accept `dry_run`. Errors come back as
 * { code, message, hint } so the agent can recover on its own.
 */

const json = (data: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

function toolError(error: unknown): CallToolResult {
  const body =
    error instanceof z.ZodError ? toErrorResponse(fromZodError(error)) : toErrorResponse(error);
  if (!isSellbaseError(error) && !(error instanceof z.ZodError)) {
    body.error.message = error instanceof Error ? error.message : String(error);
  }
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(body.error, null, 2) }] };
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return json(await fn());
  } catch (error) {
    return toolError(error);
  }
}

async function fileAsBase64(path: string, maxBytes: number) {
  const bytes = await readFile(path);
  if (bytes.byteLength > maxBytes) {
    throw new Error(`${path} is ${bytes.byteLength} bytes; the limit is ${maxBytes}.`);
  }
  return { file_name: basename(path), content_base64: bytes.toString('base64') };
}

const money = 'Money is an integer in minor units: $199.90 MXN is 19990.';
const dryRun = z
  .boolean()
  .default(false)
  .describe('Validate and show what would happen without changing anything.');

export function createSellbaseMcpServer(sellbase: Sellbase, options: { version?: string } = {}) {
  const server = new McpServer(
    { name: BRAND.slug, version: options.version ?? '0.1.0' },
    {
      instructions: [
        `${BRAND.name} runs the store inside this project: catalog, checkout, orders, delivery and emails.`,
        'Start with store_status: it lists what is missing and the next step for each item.',
        money,
        'Orders are only created by payments. To check that selling works end to end, run test_purchase.',
        'Never ask the user for keys in chat if they can set them themselves; never print secrets back.',
      ].join('\n'),
    },
  );

  server.registerTool(
    'store_status',
    {
      title: 'Store status',
      description:
        'Use first, and whenever unsure what to do next. Returns the setup checklist (schema, payments, emails, catalog, webhooks) with a hint for each pending item, plus store basics.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => {
        const [store, doctor] = await Promise.all([
          sellbase.admin.store.get(),
          sellbase.admin.doctor(),
        ]);
        return {
          store: {
            name: store.name,
            currency: store.default_currency,
            country: store.country,
            locale: store.default_locale,
          },
          ready: doctor.ok,
          checks: doctor.checks.map(({ id, status, message, hint }) => ({
            id,
            status,
            message,
            ...(hint ? { hint } : {}),
          })),
        };
      }),
  );

  server.registerTool(
    'store_update_settings',
    {
      title: 'Update store settings',
      description: `Change the store name, contact email, currency, locale, timezone, logo, brand color, tax (settings.tax.rate_bps: 1600 = 16%, mode inclusive|exclusive) and manual shipping (settings.shipping: flat_rate_amount, free_over_amount, pickup.enabled). ${money}`,
      inputSchema: { changes: storeUpdateInput, dry_run: dryRun },
    },
    ({ changes, dry_run }) =>
      run(async () =>
        dry_run ? { dry_run: true, would_update: changes } : sellbase.admin.store.update(changes),
      ),
  );

  server.registerTool(
    'integration_connect',
    {
      title: 'Connect a provider',
      description:
        'Connect Stripe (payments) or Resend (email) with API keys, stored encrypted in Supabase Vault. Stripe: when the project is deployed (public https URL) the webhook endpoint is created in Stripe for you; locally run `stripe listen --forward-to <webhooks URL>` and pass its whsec_ as webhook_secret. Use test keys (sk_test_…) until the owner says to go live; live keys (sk_live_…/rk_live_…) need confirm: true after the owner confirms customers will pay real money. Follow next_steps in the response.',
      inputSchema: {
        provider: z.enum(['stripe', 'resend']),
        secret_key: z.string().min(1),
        webhook_secret: z.string().optional(),
        confirm: z
          .boolean()
          .optional()
          .describe('true only for live Stripe keys, after the owner approved going live.'),
      },
      annotations: { idempotentHint: true },
    },
    ({ provider, secret_key, webhook_secret, confirm }) =>
      run(async () => {
        const { integration, next_steps } = await sellbase.admin.integrations.connect(provider, {
          secret_key,
          ...(webhook_secret ? { webhook_secret } : {}),
          ...(confirm !== undefined ? { confirm } : {}),
        });
        return { integration, next_steps };
      }),
  );

  server.registerTool(
    'payments_live_check',
    {
      title: 'Verify real payments',
      description:
        'After connecting live Stripe keys: creates a Checkout for the smallest amount Stripe allows (10 MXN / 0.50 USD). The OWNER pays it with a real card; when the webhook arrives it is refunded automatically and store_status shows "Live payment check" as ok. Stripe keeps its small fee. Ask the owner before calling (confirm: true), give them the URL, then check store_status.',
      inputSchema: {
        success_url: z
          .url()
          .optional()
          .describe('Where to land after paying; defaults to settings.site_url.'),
        confirm: z.literal(true),
      },
    },
    (body) => run(() => sellbase.admin.integrations.liveCheck(body)),
  );

  server.registerTool(
    'integration_test',
    {
      title: 'Test a provider',
      description: 'Check that a connected provider works and explain any error.',
      inputSchema: { provider: z.enum(['stripe', 'resend']) },
      annotations: { readOnlyHint: true },
    },
    ({ provider }) => run(() => sellbase.admin.integrations.test(provider)),
  );

  server.registerTool(
    'products_search',
    {
      title: 'Search products',
      description:
        'List or search products (by title or SKU). Returns compact rows; use product_get for full detail.',
      inputSchema: {
        q: z.string().optional(),
        status: z.enum(['draft', 'active', 'archived']).optional(),
        type: z.enum(['physical', 'digital', 'service']).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        cursor: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (query) =>
      run(async () => {
        const page = await sellbase.admin.products.search(query);
        return {
          products: page.data.map((p) => ({
            id: p.id,
            title: p.title,
            slug: p.slug,
            type: p.type,
            status: p.status,
            variants: p.variants
              .filter((v) => v.status !== 'archived')
              .map((v) => ({
                id: v.id,
                title: v.title,
                sku: v.sku,
                price_amount: v.price_amount,
                currency: v.currency,
                stock: v.inventory ? v.inventory.on_hand - v.inventory.reserved : null,
                files: v.digital_assets.length,
              })),
            images: p.media.length,
          })),
          next_cursor: page.next_cursor,
        };
      }),
  );

  server.registerTool(
    'product_get',
    {
      title: 'Get product',
      description:
        'Full product: variants with price, stock, shipping specs and attached files, plus images.',
      inputSchema: { id: z.uuid() },
      annotations: { readOnlyHint: true },
    },
    ({ id }) => run(() => sellbase.admin.products.get(id)),
  );

  server.registerTool(
    'product_upsert',
    {
      title: 'Create or update product',
      description: `Create or update a whole product of any type in one call. Send id to update; variants with id are updated, without id are created, missing ones are archived. Every product needs at least one variant (use one titled "Default" when there are no options). Set status "active" to publish. Physical: variants[].physical and variants[].inventory.on_hand. Digital: afterwards attach the file with product_file_upload. ${money}`,
      inputSchema: { product: productUpsertInput, dry_run: dryRun },
    },
    ({ product, dry_run }) =>
      run(async () =>
        dry_run
          ? { dry_run: true, valid: true, would_upsert: product }
          : sellbase.admin.products.upsert(product),
      ),
  );

  server.registerTool(
    'media_add',
    {
      title: 'Add product image',
      description:
        'Add an image to a product from a public URL or a local file path (max 5 MB). The first image is the one shown in listings.',
      inputSchema: {
        product_id: z.uuid(),
        url: z.url().optional(),
        file_path: z.string().optional().describe('Absolute path to an image on this machine.'),
        alt: z.string().max(200).optional(),
      },
    },
    ({ product_id, url, file_path, alt }) =>
      run(async () => {
        const source = url ? { url } : file_path ? await fileAsBase64(file_path, 5_000_000) : null;
        if (!source) throw new Error('Pass url or file_path.');
        const product = await sellbase.admin.products.addMedia(product_id, {
          ...source,
          alt: alt ?? '',
        });
        return { id: product.id, images: product.media.map((m) => m.url) };
      }),
  );

  server.registerTool(
    'product_file_upload',
    {
      title: 'Attach file to digital product',
      description:
        'Attach the file buyers receive to a digital variant, from a local path (max 10 MB). Buyers get a private, expiring download link by email after paying.',
      inputSchema: {
        variant_id: z.uuid(),
        file_path: z.string().describe('Absolute path to the file on this machine.'),
        download_limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Max downloads per purchase; unlimited if omitted.'),
        link_ttl_hours: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Hours the link stays valid (default 72).'),
      },
    },
    ({ variant_id, file_path, download_limit, link_ttl_hours }) =>
      run(async () =>
        sellbase.admin.variants.uploadFile(variant_id, {
          ...(await fileAsBase64(file_path, 10_000_000)),
          ...(download_limit ? { download_limit } : {}),
          ...(link_ttl_hours ? { link_ttl_hours } : {}),
        }),
      ),
  );

  server.registerTool(
    'inventory_adjust',
    {
      title: 'Adjust stock',
      description:
        'Add or remove stock for a variant with a reason (e.g. +20 "restock", -1 "damaged"). Cannot go below units reserved by open checkouts.',
      inputSchema: {
        variant_id: z.uuid(),
        delta: z
          .number()
          .int()
          .refine((d) => d !== 0, 'delta cannot be 0'),
        reason: z.string().min(1).max(200),
        dry_run: dryRun,
      },
    },
    ({ variant_id, delta, reason, dry_run }) =>
      run(async () =>
        dry_run
          ? { dry_run: true, would_adjust: { variant_id, delta, reason } }
          : sellbase.admin.inventory.adjust({ variant_id, delta, reason }),
      ),
  );

  server.registerTool(
    'orders_search',
    {
      title: 'Search orders',
      description:
        'Find orders, e.g. to fulfill today: fulfillment_status "unfulfilled". q matches an order number (#1001) or a customer email.',
      inputSchema: {
        q: z.string().optional(),
        status: z.enum(['pending_payment', 'open', 'completed', 'cancelled']).optional(),
        payment_status: z
          .enum(['unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded'])
          .optional(),
        fulfillment_status: z.enum(['unfulfilled', 'partially_fulfilled', 'fulfilled']).optional(),
        channel: z
          .enum(['web', 'admin', 'whatsapp', 'google', 'mercadolibre', 'api', 'agent'])
          .optional(),
        from: z.iso.datetime({ offset: true }).optional(),
        to: z.iso.datetime({ offset: true }).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        cursor: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (query) => run(() => sellbase.admin.orders.search(query)),
  );

  server.registerTool(
    'order_get',
    {
      title: 'Get order',
      description:
        'Full order: items (snapshots), totals, payments, shipping address and timeline.',
      inputSchema: { id: z.uuid() },
      annotations: { readOnlyHint: true },
    },
    ({ id }) => run(() => sellbase.admin.orders.get(id)),
  );

  server.registerTool(
    'order_action',
    {
      title: 'Act on an order',
      description:
        'fulfill: mark items shipped with carrier/tracking (omit items to ship everything pending); cancel: cancel an unfulfilled or partially fulfilled order (restocks by default; needs confirm=true; refunding needs order_refund permissions); note: add an internal note; resend_notification: email the confirmation (or "order_shipped") again; payment_link: a link to pay the balance of a deposit order. Confirm cancellations with the owner first.',
      inputSchema: {
        order_id: z.uuid(),
        action: z.enum(['fulfill', 'cancel', 'note', 'resend_notification', 'payment_link']),
        items: z
          .array(z.object({ order_item_id: z.uuid(), quantity: z.number().int().positive() }))
          .optional(),
        carrier: z.string().optional(),
        tracking_number: z.string().optional(),
        tracking_url: z.url().optional(),
        reason: z.string().optional().describe('Required for cancel.'),
        refund: z
          .boolean()
          .optional()
          .describe('cancel only: also refund what was paid (needs refunds:write).'),
        restock: z.boolean().optional(),
        note: z.string().optional().describe('Required for note.'),
        template: z.enum(['order_confirmation', 'order_shipped']).optional(),
        notify_customer: z.boolean().optional(),
        confirm: z.boolean().optional().describe('Must be true to cancel.'),
        success_url: z
          .url()
          .optional()
          .describe('payment_link only: where the customer lands after paying the balance.'),
      },
    },
    (a) =>
      run(async () => {
        const notify =
          a.notify_customer === undefined ? {} : { notify_customer: a.notify_customer };
        switch (a.action) {
          case 'fulfill':
            return sellbase.admin.orders.fulfill(a.order_id, {
              ...(a.items ? { items: a.items } : {}),
              ...(a.carrier ? { carrier: a.carrier } : {}),
              ...(a.tracking_number ? { tracking_number: a.tracking_number } : {}),
              ...(a.tracking_url ? { tracking_url: a.tracking_url } : {}),
              ...notify,
            });
          case 'cancel':
            if (!a.reason || a.confirm !== true)
              throw new Error(
                'cancel needs reason and confirm=true (confirm with the owner first).',
              );
            return sellbase.admin.orders.cancel(a.order_id, {
              reason: a.reason,
              confirm: true,
              ...(a.refund !== undefined ? { refund: a.refund } : {}),
              ...(a.restock !== undefined ? { restock: a.restock } : {}),
              ...notify,
            });
          case 'note':
            if (!a.note) throw new Error('note needs `note`.');
            return sellbase.admin.orders.note(a.order_id, a.note);
          case 'resend_notification':
            return sellbase.admin.orders.notify(a.order_id, a.template ?? 'order_confirmation');
          case 'payment_link':
            if (!a.success_url)
              throw new Error(
                'payment_link needs success_url (where the customer lands after paying).',
              );
            return sellbase.admin.orders.paymentLink(a.order_id, { success_url: a.success_url });
        }
      }),
  );

  server.registerTool(
    'service_setup',
    {
      title: 'Set up who delivers a service and when',
      description:
        'Create or update a resource (a person, room or equipment) with weekly hours and the service products it delivers. Hours are local times in the store time zone unless `timezone` is given (weekday 0 = Sunday … 6 = Saturday). Optionally block days off with `closed`. Create the service product first with product_upsert (type "service", variants[].service.duration_min).',
      inputSchema: {
        resource_id: z.uuid().optional().describe('Update this resource; omit to create one.'),
        name: z.string().min(1),
        kind: z.enum(['staff', 'room', 'equipment']).default('staff'),
        timezone: z.string().optional(),
        hours: z
          .array(
            z.object({
              weekday: z.number().int().min(0).max(6),
              start_time: z.string(),
              end_time: z.string(),
            }),
          )
          .optional(),
        service_product_ids: z.array(z.uuid()).optional(),
        closed: z
          .array(
            z.object({
              starts_at: z.iso.datetime({ offset: true }),
              ends_at: z.iso.datetime({ offset: true }),
              note: z.string().optional(),
            }),
          )
          .optional(),
      },
    },
    (a) =>
      run(async () => {
        const resource = await sellbase.admin.resources.upsert({
          ...(a.resource_id ? { id: a.resource_id } : {}),
          name: a.name,
          kind: a.kind,
          ...(a.timezone ? { timezone: a.timezone } : {}),
          ...(a.hours ? { rules: a.hours } : {}),
          ...(a.service_product_ids ? { product_ids: a.service_product_ids } : {}),
        });
        let latest = resource;
        for (const block of a.closed ?? []) {
          latest = await sellbase.admin.resources.addException(resource.id, {
            starts_at: block.starts_at,
            ends_at: block.ends_at,
            kind: 'closed',
            ...(block.note ? { note: block.note } : {}),
          });
        }
        return latest;
      }),
  );

  server.registerTool(
    'availability_get',
    {
      title: 'Free times for a service',
      description:
        'Free start times for a service variant (next 14 days by default). Use it to verify the setup or to find a time to reschedule. Times are UTC instants; say them to the owner in `timezone`.',
      inputSchema: {
        variant_id: z.uuid(),
        from: z.iso.datetime({ offset: true }).optional(),
        to: z.iso.datetime({ offset: true }).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ variant_id, from, to }) =>
      run(async () => {
        const res = await sellbase.availability.get(variant_id, {
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        });
        return {
          timezone: res.timezone,
          resources: res.resources,
          slots: res.slots.slice(0, 50),
          total_slots: res.slots.length,
        };
      }),
  );

  server.registerTool(
    'bookings_search',
    {
      title: 'Search appointments',
      description:
        "Appointments in a date range (the agenda), e.g. today's for a resource. Defaults to the next 14 days.",
      inputSchema: {
        from: z.iso.datetime({ offset: true }).optional(),
        to: z.iso.datetime({ offset: true }).optional(),
        resource_id: z.uuid().optional(),
        status: z
          .enum(['confirmed', 'completed', 'no_show', 'cancelled', 'rescheduled'])
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (query) => run(() => sellbase.admin.bookings.search(query)),
  );

  server.registerTool(
    'booking_action',
    {
      title: 'Act on an appointment',
      description:
        'complete, no_show, cancel (needs reason and confirm=true; refund=true also refunds the booked line and needs refunds:write) or reschedule (needs starts_at from availability_get). The customer is emailed on cancel and reschedule.',
      inputSchema: {
        booking_id: z.uuid(),
        action: z.enum(['complete', 'no_show', 'cancel', 'reschedule']),
        starts_at: z.iso.datetime({ offset: true }).optional(),
        resource_id: z.uuid().optional(),
        reason: z.string().optional(),
        refund: z.boolean().optional(),
        notify_customer: z.boolean().optional(),
        confirm: z.boolean().optional(),
      },
    },
    (a) =>
      run(async () => {
        const notify =
          a.notify_customer === undefined ? {} : { notify_customer: a.notify_customer };
        switch (a.action) {
          case 'complete':
            return sellbase.admin.bookings.complete(a.booking_id);
          case 'no_show':
            return sellbase.admin.bookings.noShow(a.booking_id);
          case 'cancel':
            if (!a.reason || a.confirm !== true)
              throw new Error(
                'cancel needs reason and confirm=true (confirm with the owner first).',
              );
            return sellbase.admin.bookings.cancel(a.booking_id, {
              reason: a.reason,
              confirm: true,
              ...(a.refund !== undefined ? { refund: a.refund } : {}),
              ...notify,
            });
          case 'reschedule':
            if (!a.starts_at)
              throw new Error('reschedule needs starts_at (get one with availability_get).');
            return sellbase.admin.bookings.reschedule(a.booking_id, {
              starts_at: a.starts_at,
              ...(a.resource_id ? { resource_id: a.resource_id } : {}),
              ...notify,
            });
        }
      }),
  );

  server.registerTool(
    'order_refund',
    {
      title: 'Refund an order',
      description: `Refund all or part of an order through the payment provider. Moves real money in live mode: get explicit approval from the owner and pass confirm=true. Needs the refunds:write scope (agent tokens do not have it unless the owner granted it). ${money}`,
      inputSchema: {
        order_id: z.uuid(),
        amount: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Minor units; omit to refund everything left.'),
        reason: z.string().min(1),
        notify_customer: z.boolean().default(true),
        confirm: z.literal(true),
      },
      annotations: { destructiveHint: true },
    },
    ({ order_id, amount, reason, notify_customer, confirm }) =>
      run(() =>
        sellbase.admin.orders.refund(order_id, {
          reason,
          confirm,
          notify_customer,
          ...(amount ? { amount } : {}),
        }),
      ),
  );

  server.registerTool(
    'test_purchase',
    {
      title: 'Test purchase',
      description:
        'Buy one active physical and one active digital product in payment TEST mode and report each step (cart, checkout, payment, order, delivery, email, download). Stock is restored afterwards. Run it after setting up the store and after any change to payments or products.',
      inputSchema: {
        variant_ids: z.array(z.uuid()).max(5).optional(),
        email: z
          .email()
          .optional()
          .describe('Where the test confirmation goes (default test-purchase@example.com).'),
      },
    },
    ({ variant_ids, email }) =>
      run(() =>
        sellbase.admin.testPurchase({
          ...(variant_ids ? { variant_ids } : {}),
          ...(email ? { email } : {}),
        }),
      ),
  );

  server.registerTool(
    'products_import',
    {
      title: 'Import products from CSV',
      description:
        'Import or update many products from a CSV: our template (title,price,sku,stock,status,type,option1 name,option1 value,image), Spanish headers (nombre,precio,existencias…) or a Shopify export. Rows with the same handle become variants; existing products (same handle) are updated and variants match by SKU; variants missing from the file are archived. Services are not imported (use product_upsert). Run with dry_run: true first and show the owner the summary and any row errors.',
      inputSchema: {
        file_path: z.string().optional().describe('Absolute path to a .csv on this machine.'),
        csv: z.string().optional().describe('CSV text, when there is no file.'),
        dry_run: dryRun,
      },
    },
    ({ file_path, csv, dry_run }) =>
      run(async () => {
        const text = file_path ? await readFile(file_path, 'utf8') : csv;
        if (!text) throw new Error('Pass file_path or csv.');
        return sellbase.admin.products.import({ csv: text, dry_run });
      }),
  );

  server.registerTool(
    'products_bulk',
    {
      title: 'Bulk product changes',
      description: `Publish, unpublish (draft), archive or reprice many products at once. Prices: price.mode "percent" in basis points (-1000 = 10% off, 500 = 5% up), "amount" adds minor units (negative lowers), "set" sets the price. Price changes return a preview of old → new prices; only send confirm: true after the owner approves that preview. ${money}`,
      inputSchema: productsBulkInput.shape,
    },
    (input) => run(() => sellbase.admin.products.bulk(input)),
  );

  server.registerTool(
    'order_create',
    {
      title: 'Record a manual order',
      description: `Record a sale made outside the storefront (in person, WhatsApp, phone). payment.mode "paid" with method cash/spei/card/other when the money was already received: needs confirm: true after the owner checks the total. payment.mode "link" to get a Stripe payment link for the customer (the order waits as pending_payment and opens when paid). Stock is taken immediately; unit_price_amount overrides the price for this order only. Services must be booked from the storefront. ${money}`,
      inputSchema: { order: manualOrderInput, dry_run: dryRun },
    },
    ({ order, dry_run }) =>
      run(async () =>
        dry_run
          ? { dry_run: true, valid: true, would_create: order }
          : sellbase.admin.orders.create(order),
      ),
  );

  server.registerTool(
    'webhook_setup',
    {
      title: 'Outbound webhooks',
      description: `Send store events (orders, refunds, shipments, bookings, products) to another system such as an ERP, a sheet or an automation tool. action "list" shows endpoints and delivery health; "create" needs the webhooks:write scope (agent tokens do not have it unless the owner granted it) and confirm: true after the owner approved the URL and events, since customer and order data will be sent there; it returns the signing secret ONCE (give it to the owner to store in the receiving system, never print it again); "test" sends a signed webhook.test now; "delete" removes one. Receivers verify the ${BRAND.name}-Signature header: t=<unix>,v1=HMAC-SHA256(secret, "<t>.<body>"). Events: ${WEBHOOK_EVENTS.join(', ')}.`,
      inputSchema: {
        action: z.enum(['list', 'create', 'test', 'delete']),
        id: z.uuid().optional().describe('Endpoint id for test and delete.'),
        url: z.url().optional(),
        events: z
          .array(z.enum(WEBHOOK_EVENTS))
          .optional()
          .describe('Empty or omitted = every event.'),
        description: z.string().max(200).optional(),
        confirm: z
          .boolean()
          .optional()
          .describe('create only: true after the owner approved sending data to this URL.'),
      },
    },
    ({ action, id, url, events, description, confirm }) =>
      run(async () => {
        if (action === 'list') return sellbase.admin.webhooks.list();
        if (action === 'create') {
          if (!url) throw new Error('Pass url.');
          return sellbase.admin.webhooks.create({
            url,
            events: events ?? [],
            description: description ?? '',
            ...(confirm !== undefined ? { confirm } : {}),
          });
        }
        if (!id) throw new Error('Pass the endpoint id (see action "list").');
        return action === 'test'
          ? sellbase.admin.webhooks.test(id)
          : sellbase.admin.webhooks.delete(id);
      }),
  );

  server.registerTool(
    'collection_upsert',
    {
      title: 'Create or update collection',
      description:
        'Group products (e.g. "Lo más vendido", "Regalos"). Send id to update. product_ids replaces the products in that order; omit it to keep them. The storefront filters with ?collection=<slug>. Use delete: true with id to remove the collection (products are kept).',
      inputSchema: {
        collection: collectionUpsertInput.optional(),
        delete: z.object({ id: z.uuid() }).optional(),
        dry_run: dryRun,
      },
    },
    ({ collection, delete: del, dry_run }) =>
      run(async () => {
        if (del) {
          return dry_run
            ? { dry_run: true, would_delete: del.id }
            : sellbase.admin.collections.delete(del.id);
        }
        if (!collection) {
          const list = await sellbase.admin.collections.list();
          return { hint: 'Pass collection to create/update one.', collections: list.data };
        }
        return dry_run
          ? { dry_run: true, valid: true, would_upsert: collection }
          : sellbase.admin.collections.upsert(collection);
      }),
  );

  server.registerTool(
    'discount_upsert',
    {
      title: 'Create or update discount',
      description: `Discount codes and automatic discounts. kind "percent": value in basis points (1000 = 10%). kind "fixed": value in minor units. kind "free_shipping": value 0. code null = automatic (applies without a code). Codes are uppercase. Send id to update (every field is replaced). Call without discount to list the current ones. ${money}`,
      inputSchema: { discount: discountUpsertInput.optional(), dry_run: dryRun },
    },
    ({ discount, dry_run }) =>
      run(async () => {
        if (!discount) return sellbase.admin.discounts.list();
        return dry_run
          ? { dry_run: true, valid: true, would_upsert: discount }
          : sellbase.admin.discounts.upsert(discount);
      }),
  );

  server.registerTool(
    'customers_search',
    {
      title: 'Search customers',
      description:
        'Find customers by email, name or phone, with orders count and total spent. Pass id for one customer with addresses, orders and appointments.',
      inputSchema: {
        id: z.uuid().optional(),
        q: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        cursor: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ id, ...query }) =>
      run(() => (id ? sellbase.admin.customers.get(id) : sellbase.admin.customers.search(query))),
  );

  server.registerTool(
    'report_summary',
    {
      title: 'Sales summary',
      description:
        'Sales today, last 7 and 30 days (paid minus refunded), daily series, top products, orders waiting to ship and appointments today. Use it to answer "how is the store doing?".',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => run(() => sellbase.admin.reports.summary()),
  );

  return server;
}
