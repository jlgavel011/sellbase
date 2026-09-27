import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  BRAND,
  fromZodError,
  isSellbaseError,
  productUpsertInput,
  storeUpdateInput,
  toErrorResponse,
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
        'Connect Stripe (payments) or Resend (email) with API keys. Keys are stored encrypted in Supabase Vault. For Stripe also pass webhook_secret (whsec_…) so paid orders arrive. Use test keys (sk_test_…) until the owner says to go live.',
      inputSchema: {
        provider: z.enum(['stripe', 'resend']),
        secret_key: z.string().min(1),
        webhook_secret: z.string().optional(),
      },
      annotations: { idempotentHint: true },
    },
    ({ provider, secret_key, webhook_secret }) =>
      run(async () => {
        const { integration } = await sellbase.admin.integrations.connect(provider, {
          secret_key,
          ...(webhook_secret ? { webhook_secret } : {}),
        });
        return integration;
      }),
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
        'fulfill: mark items shipped with carrier/tracking (omit items to ship everything pending); cancel: cancel an unfulfilled or partially fulfilled order (restocks by default; needs confirm=true; refunding needs order_refund permissions); note: add an internal note; resend_notification: email the confirmation (or "order_shipped") again. Confirm cancellations with the owner first.',
      inputSchema: {
        order_id: z.uuid(),
        action: z.enum(['fulfill', 'cancel', 'note', 'resend_notification']),
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

  return server;
}
