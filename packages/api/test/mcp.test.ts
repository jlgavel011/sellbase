import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSellbaseMcpServer } from '@sellbase/mcp';
import { createSellbase } from '@sellbase/sdk';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestStore, sql, type TestStore } from './helpers.js';

/** An agent's session over MCP, against the real API and database. */
let s: TestStore;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { text: string }[];
  };
  return { isError: Boolean(res.isError), data: JSON.parse(res.content[0]?.text ?? 'null') };
}

beforeAll(async () => {
  s = await createTestStore();
  const sellbase = createSellbase({
    url: 'http://local.test/sellbase-api',
    token: await s.token(),
    fetch: (input, init) => Promise.resolve(s.api.request(String(input), init)),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createSellbaseMcpServer(sellbase).connect(serverTransport);
  client = new Client({ name: 'test-agent', version: '1.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await sql.end();
});

describe('mcp', () => {
  it('lists the Phase 1 tools with descriptions', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'store_status',
        'product_upsert',
        'products_search',
        'orders_search',
        'order_get',
        'test_purchase',
      ]),
    );
    expect(tools.every((t) => (t.description ?? '').length > 30)).toBe(true);
  });

  it('sets up a store and sells, like an agent would', async () => {
    const status = await call('store_status');
    expect(status.data.checks.find((c: { id: string }) => c.id === 'catalog').status).toBe('warn');

    const dry = await call('product_upsert', {
      product: { type: 'physical', title: 'Taza', variants: [{ price_amount: 15900 }] },
      dry_run: true,
    });
    expect(dry.data.dry_run).toBe(true);
    expect((await call('products_search')).data.products).toHaveLength(0);

    const mug = await call('product_upsert', {
      product: {
        type: 'physical',
        title: 'Taza Sellbase',
        status: 'active',
        variants: [
          {
            price_amount: 15900,
            inventory: { on_hand: 10 },
            physical: { weight_g: 350, length_cm: 10, width_cm: 10, height_cm: 12 },
          },
        ],
      },
    });
    expect(mug.isError, JSON.stringify(mug.data)).toBe(false);

    const guide = await call('product_upsert', {
      product: {
        type: 'digital',
        title: 'Guía de ventas',
        status: 'active',
        variants: [{ price_amount: 9900 }],
      },
    });
    const dir = await mkdtemp(join(tmpdir(), 'sellbase-mcp-'));
    const pdf = join(dir, 'guia.pdf');
    await writeFile(pdf, '%PDF-1.4 guía');
    const upload = await call('product_file_upload', {
      variant_id: guide.data.variants[0].id,
      file_path: pdf,
      download_limit: 3,
    });
    expect(upload.data).toMatchObject({ file_name: 'guia.pdf' });

    const image = await call('media_add', {
      product_id: mug.data.id,
      url: 'https://img.test/taza.jpg',
    });
    expect(image.data.images).toEqual(['https://img.test/taza.jpg']);

    const purchase = await call('test_purchase');
    expect(purchase.data.ok, JSON.stringify(purchase.data.steps, null, 2)).toBe(true);

    const orders = await call('orders_search', { fulfillment_status: 'partially_fulfilled' });
    expect(orders.data.data[0].number).toBe(purchase.data.order_number);
    const order = await call('order_get', { id: purchase.data.order_id });
    expect(order.data.items.map((i: { title: string }) => i.title).sort()).toEqual([
      'Guía de ventas',
      'Taza Sellbase',
    ]);
  });

  it('fulfills and notes orders, and cannot refund without the scope', async () => {
    const [{ id }] = (await call('orders_search', { limit: 1 })).data.data;
    const shipped = await call('order_action', {
      order_id: id,
      action: 'fulfill',
      carrier: 'DHL',
      tracking_number: 'DHL9',
    });
    expect(shipped.isError, JSON.stringify(shipped.data)).toBe(false);
    expect(shipped.data.fulfillment_status).toBe('fulfilled');
    const noted = await call('order_action', {
      order_id: id,
      action: 'note',
      note: 'Entregado en recepción',
    });
    expect(noted.data.notes).toContain('Entregado en recepción');
    const refund = await call('order_refund', { order_id: id, reason: 'prueba', confirm: true });
    expect(refund.isError).toBe(true);
    expect(refund.data.code).toBe('FORBIDDEN');
    expect(refund.data.hint).toContain('refunds:write');
  });

  it('sets up a bookable service and sells an appointment', async () => {
    const product = await call('product_upsert', {
      product: {
        type: 'service',
        title: 'Consulta nutrición',
        status: 'active',
        variants: [
          {
            price_amount: 60000,
            service: {
              duration_min: 45,
              location_type: 'online',
              online_meeting_url: 'https://meet.test/n',
              deposit_amount: 20000,
              min_notice_min: 0,
            },
          },
        ],
      },
    });
    expect(product.isError, JSON.stringify(product.data)).toBe(false);
    const resource = await call('service_setup', {
      name: 'Dra. Paula',
      hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        start_time: '08:00',
        end_time: '20:00',
      })),
      service_product_ids: [product.data.id],
    });
    expect(resource.data.rules).toHaveLength(7);
    const slots = await call('availability_get', { variant_id: product.data.variants[0].id });
    expect(slots.data.total_slots).toBeGreaterThan(0);
    const purchase = await call('test_purchase', { variant_ids: [product.data.variants[0].id] });
    expect(purchase.data.ok, JSON.stringify(purchase.data.steps, null, 2)).toBe(true);
    const agenda = await call('bookings_search', {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(
      agenda.data.data.some(
        (b: { product: { title: string } | null }) => b.product?.title === 'Consulta nutrición',
      ),
    ).toBe(true);
  });

  it('runs merchandising and reports tools', async () => {
    const mug = (await call('products_search', { q: 'Taza' })).data.products[0];
    const collection = await call('collection_upsert', {
      collection: { title: 'Regalos', product_ids: [mug.id] },
    });
    expect(collection.isError, JSON.stringify(collection.data)).toBe(false);
    expect(collection.data).toMatchObject({ slug: 'regalos', product_ids: [mug.id] });

    const discount = await call('discount_upsert', {
      discount: { code: 'REGALO10', kind: 'percent', value: 1000 },
    });
    expect(discount.data).toMatchObject({ code: 'REGALO10', value: 1000 });
    const bad = (await client.callTool({
      name: 'discount_upsert',
      arguments: { discount: { code: 'regalo', kind: 'percent', value: 10 } },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(bad.isError).toBe(true);
    expect(bad.content[0]?.text).toContain('Uppercase');
    expect((await call('discount_upsert')).data.data).toHaveLength(1);

    const customers = await call('customers_search', { q: '@' });
    expect(customers.isError).toBe(false);
    const report = await call('report_summary');
    expect(report.data.daily).toHaveLength(30);

    const removed = await call('collection_upsert', { delete: { id: collection.data.id } });
    expect(removed.data.deleted).toBe(true);
  });

  it('imports a CSV file, reprices with a preview and records a manual sale', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sellbase-csv-'));
    const file = join(dir, 'productos.csv');
    await writeFile(file, 'nombre,precio,existencias,estado\nLlavero,50,20,activo\n');
    const dry = await call('products_import', { file_path: file, dry_run: true });
    expect(dry.data).toMatchObject({ dry_run: true, created: 1 });
    const imported = await call('products_import', { file_path: file });
    const id = imported.data.products[0].id;

    const preview = await call('products_bulk', {
      product_ids: [id],
      action: 'price',
      price: { mode: 'set', value: 6000 },
    });
    expect(preview.data).toMatchObject({ applied: false, preview: [{ to_amount: 6000 }] });
    await call('products_bulk', {
      product_ids: [id],
      action: 'price',
      price: { mode: 'set', value: 6000 },
      confirm: true,
    });

    const product = await call('product_get', { id });
    const sale = await call('order_create', {
      order: {
        email: 'mostrador@test.dev',
        items: [{ variant_id: product.data.variants[0].id, quantity: 2 }],
        payment: { mode: 'paid', method: 'cash' },
        confirm: true,
      },
    });
    expect(sale.isError, JSON.stringify(sale.data)).toBe(false);
    expect(sale.data.order).toMatchObject({ total_amount: 12000, channel: 'agent' });
  });

  it('sets up and tests an outbound webhook', async () => {
    const created = await call('webhook_setup', {
      action: 'create',
      url: 'https://hooks.test/erp',
      events: ['order.paid'],
    });
    expect(created.isError, JSON.stringify(created.data)).toBe(false);
    expect(created.data.secret).toMatch(/^whsec_/);
    const test = await call('webhook_setup', { action: 'test', id: created.data.id });
    expect(test.data).toMatchObject({ status: 'succeeded', event_type: 'webhook.test' });
    const missing = await call('webhook_setup', { action: 'test' });
    expect(missing.isError).toBe(true);
  });

  it('returns API errors with a hint the agent can act on', async () => {
    const res = await call('product_upsert', {
      product: {
        type: 'service',
        title: 'Consulta',
        variants: [{ price_amount: 1000, service: { duration_min: 60, location_type: 'online' } }],
        resource_ids: [crypto.randomUUID()],
      },
    });
    expect(res.isError).toBe(true);
    expect(res.data.code).toBe('VALIDATION_ERROR');
    expect(res.data.hint).toContain('POST /resources');
  });

  it('rejects input that breaks the tool schema, naming the field', async () => {
    const res = (await client.callTool({
      name: 'product_upsert',
      arguments: {
        product: { type: 'service', title: 'Consulta', variants: [{ price_amount: 1000 }] },
      },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('service specs');
  });

  it('reports missing local files clearly', async () => {
    const res = await call('product_file_upload', {
      variant_id: crypto.randomUUID(),
      file_path: '/nope/missing.pdf',
    });
    expect(res.isError).toBe(true);
    expect(res.data.message).toContain('ENOENT');
  });
});
