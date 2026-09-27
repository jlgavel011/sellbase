import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestStore, sql, type TestStore } from './helpers.js';

let s: TestStore;
let token: string;

beforeAll(async () => {
  s = await createTestStore();
  token = await s.token();
});

afterAll(async () => {
  await sql.end();
});

describe('test_purchase', () => {
  it('explains what is missing when the catalog is empty', async () => {
    const res = await s.request('POST', '/test-purchase', { token, body: {} });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.steps[0]).toMatchObject({ step: 'catalog', ok: false });
    expect(res.body.steps[0].hint).toContain('product_upsert');
  });

  it('runs a full purchase, delivers files, emails and restores stock', async () => {
    const tee = await s.request('POST', '/products', {
      token,
      body: {
        type: 'physical',
        title: 'Playera Test',
        status: 'active',
        variants: [{ price_amount: 34900, inventory: { on_hand: 3 } }],
      },
    });
    const ebook = await s.request('POST', '/products', {
      token,
      body: {
        type: 'digital',
        title: 'Ebook Test',
        status: 'active',
        variants: [{ price_amount: 19900 }],
      },
    });
    await s.request('POST', `/variants/${ebook.body.variants[0].id}/digital-assets`, {
      token,
      body: { file_name: 'e.pdf', content_base64: 'JVBERg==' },
    });

    const res = await s.request('POST', '/test-purchase', { token, body: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ok, JSON.stringify(res.body.steps, null, 2)).toBe(true);
    expect(res.body.steps.map((st: { step: string }) => st.step)).toEqual(
      expect.arrayContaining([
        'payments',
        'cart',
        'shipping',
        'checkout',
        'payment',
        'order',
        'delivery',
        'fulfillment',
        'email',
        'download',
      ]),
    );
    expect(res.body.total_amount).toBe(34900 + 19900 + 9900);
    expect(s.emails.at(-1)?.to).toBe('test-purchase@example.com');

    const product = await s.request('GET', `/products/${tee.body.id}`, { token });
    expect(product.body.variants[0].inventory).toMatchObject({ on_hand: 3, reserved: 0 });
    const order = await s.request('GET', `/orders/${res.body.order_id}`, { token });
    expect(order.body.metadata).toMatchObject({ test_purchase: true });
  });

  it('requires the orders:write scope', async () => {
    const readOnly = await s.token(['orders:read']);
    const res = await s.request('POST', '/test-purchase', { token: readOnly, body: {} });
    expect(res.status).toBe(403);
  });
});
