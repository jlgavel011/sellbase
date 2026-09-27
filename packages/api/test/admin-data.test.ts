import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestStore, sql, type TestStore } from './helpers.js';

let s: TestStore;
let token: string;
let productId: string;

async function seedOrder(opts: {
  number: number;
  email: string;
  paid: number;
  refunded?: number;
  status?: string;
  placedAt?: Date;
  shipment?: boolean;
  test?: boolean;
}) {
  const [customer] = await sql<{ id: string }[]>`
    insert into sellbase.customers (store_id, email) values (${s.storeId}, ${opts.email})
    on conflict (store_id, email) do update set email = excluded.email returning id`;
  const [order] = await sql<{ id: string }[]>`
    insert into sellbase.orders (store_id, number, customer_id, email, currency, subtotal_amount, total_amount,
                                 amount_paid, amount_refunded, status, payment_status, placed_at, metadata)
    values (${s.storeId}, ${opts.number}, ${customer?.id ?? null}, ${opts.email}, 'MXN', ${opts.paid}, ${opts.paid},
            ${opts.paid}, ${opts.refunded ?? 0}, ${opts.status ?? 'open'}, 'paid', ${opts.placedAt ?? new Date()},
            ${sql.json((opts.test ? { test_purchase: true } : {}) as never)})
    returning id`;
  const [variant] = await sql<{ id: string }[]>`
    select id from sellbase.variants where product_id = ${productId} limit 1`;
  await sql`
    insert into sellbase.order_items (store_id, order_id, variant_id, product_type, title, unit_price_amount,
                                      quantity, total_amount, fulfillment_type)
    values (${s.storeId}, ${order?.id ?? ''}, ${variant?.id ?? null}, 'physical', 'Taza', ${opts.paid}, 1, ${opts.paid},
            ${opts.shipment === false ? 'digital' : 'shipment'})`;
  return { orderId: order?.id ?? '', customerId: customer?.id ?? '' };
}

beforeAll(async () => {
  s = await createTestStore();
  token = await s.token();
  const product = await s.request('POST', '/products', {
    token,
    body: {
      type: 'physical',
      title: 'Taza',
      status: 'active',
      variants: [{ price_amount: 15000 }],
    },
  });
  productId = product.body.id;
});

afterAll(async () => {
  await sql.end();
});

describe('collections', () => {
  it('creates, lists, reorders and deletes a collection', async () => {
    const created = await s.request('POST', '/collections', {
      token,
      body: { title: 'Lo más vendido', product_ids: [productId] },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body).toMatchObject({ slug: 'lo-mas-vendido', product_ids: [productId] });

    const storefront = await s.request('GET', '/storefront/products?collection=lo-mas-vendido');
    expect(storefront.body.data.map((p: { id: string }) => p.id)).toEqual([productId]);

    const updated = await s.request('POST', '/collections', {
      token,
      body: { id: created.body.id, title: 'Favoritos', product_ids: [] },
    });
    expect(updated.body).toMatchObject({
      title: 'Favoritos',
      slug: 'lo-mas-vendido',
      product_ids: [],
    });

    const list = await s.request('GET', '/collections', { token });
    expect(list.body.data).toHaveLength(1);

    const del = await s.request('DELETE', `/collections/${created.body.id}`, { token });
    expect(del.body).toEqual({ id: created.body.id, deleted: true });
    const [log] = await sql`
      select action from sellbase.audit_log where entity_id = ${created.body.id} order by created_at desc limit 1`;
    expect(log?.action).toBe('collection.delete');
  });

  it('rejects products from another store', async () => {
    const res = await s.request('POST', '/collections', {
      token,
      body: { title: 'Ajena', product_ids: [randomUUID()] },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.hint).toContain('GET /products');
  });
});

describe('discounts', () => {
  it('creates a code, applies it in a cart and updates it', async () => {
    const res = await s.request('POST', '/discounts', {
      token,
      body: { code: 'BIENVENIDA', kind: 'percent', value: 1000 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ code: 'BIENVENIDA', usage_count: 0, status: 'active' });

    const product = await s.request('GET', `/products/${productId}`, { token });
    const cart = await s.request('POST', '/storefront/carts', { body: {} });
    await s.request('POST', `/storefront/carts/${cart.body.token}/items`, {
      body: { variant_id: product.body.variants[0].id, quantity: 1 },
    });
    const applied = await s.request('POST', `/storefront/carts/${cart.body.token}/discounts`, {
      body: { code: 'bienvenida' },
    });
    expect(applied.body.totals.discount_amount).toBe(1500);

    const updated = await s.request('POST', '/discounts', {
      token,
      body: { id: res.body.id, code: 'BIENVENIDA', kind: 'fixed', value: 5000, status: 'disabled' },
    });
    expect(updated.body).toMatchObject({ kind: 'fixed', value: 5000, status: 'disabled' });

    const active = await s.request('GET', '/discounts?status=active', { token });
    expect(active.body.data.find((d: { id: string }) => d.id === res.body.id)).toBeUndefined();
  });

  it('explains bad values and duplicate codes', async () => {
    const bad = await s.request('POST', '/discounts', {
      token,
      body: { code: 'MUCHO', kind: 'percent', value: 20000 },
    });
    expect(bad.status).toBe(400);
    await s.request('POST', '/discounts', {
      token,
      body: { code: 'DUP', kind: 'fixed', value: 100 },
    });
    const dup = await s.request('POST', '/discounts', {
      token,
      body: { code: 'DUP', kind: 'fixed', value: 100 },
    });
    expect(dup.status).toBe(400);
    expect(dup.body.error.hint).toContain('code');
  });

  it('deletes unused discounts and disables used ones', async () => {
    const unused = await s.request('POST', '/discounts', {
      token,
      body: { code: 'NOUSADO', kind: 'free_shipping', value: 0 },
    });
    const del = await s.request('DELETE', `/discounts/${unused.body.id}`, { token });
    expect(del.body).toMatchObject({ deleted: true });

    const used = await s.request('POST', '/discounts', {
      token,
      body: { code: 'USADO', kind: 'fixed', value: 100 },
    });
    await sql`update sellbase.discounts set usage_count = 1 where id = ${used.body.id}`;
    const kept = await s.request('DELETE', `/discounts/${used.body.id}`, { token });
    expect(kept.body).toMatchObject({ deleted: false, status: 'disabled' });
  });

  it('needs discounts:write', async () => {
    const readOnly = await s.token(['catalog:read']);
    const res = await s.request('POST', '/discounts', {
      token: readOnly,
      body: { code: 'NOPE', kind: 'fixed', value: 100 },
    });
    expect(res.status).toBe(403);
  });
});

describe('customers and reports', () => {
  const email = `cliente-${randomUUID()}@test.dev`;
  let customerId: string;

  beforeAll(async () => {
    const now = new Date();
    const a = await seedOrder({ number: 5001, email, paid: 20000 });
    customerId = a.customerId;
    await seedOrder({ number: 5002, email, paid: 10000, refunded: 4000, shipment: false });
    await seedOrder({
      number: 5003,
      email: `otro-${randomUUID()}@test.dev`,
      paid: 30000,
      placedAt: new Date(now.getTime() - 10 * 86_400_000),
    });
    await seedOrder({ number: 5004, email, paid: 99999, status: 'cancelled', refunded: 99999 });
    await seedOrder({ number: 5005, email, paid: 77777, test: true });
  });

  it('lists customers with totals and searches them', async () => {
    const res = await s.request('GET', `/customers?q=${encodeURIComponent(email.slice(0, 20))}`, {
      token,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ email, orders_count: 2, total_spent_amount: 26000 });
  });

  it('returns the customer history', async () => {
    const res = await s.request('GET', `/customers/${customerId}`, { token });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      email,
      orders_count: 2,
      total_spent_amount: 26000,
      currency: 'MXN',
    });
    expect(res.body.orders.map((o: { number: number }) => o.number).sort()).toEqual([
      5001, 5002, 5004, 5005,
    ]);
  });

  it('summarizes sales, top products and pending work', async () => {
    const res = await s.request('GET', '/reports/summary', { token });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.sales.today).toMatchObject({
      amount: 26000,
      orders: 2,
      average_order_amount: 13000,
    });
    expect(res.body.sales.last_30_days).toMatchObject({ amount: 56000, orders: 3 });
    expect(res.body.daily).toHaveLength(30);
    expect(res.body.top_products[0]).toMatchObject({ product_id: productId, title: 'Taza' });
    expect(res.body.orders_to_fulfill).toBe(2);
    expect(res.body.bookings_today).toBe(0);
  });

  it('keeps customers private to tokens without customers:read', async () => {
    const limited = await s.token(['catalog:read']);
    const res = await s.request('GET', '/customers', { token: limited });
    expect(res.status).toBe(403);
  });
});
