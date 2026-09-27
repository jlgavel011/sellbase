import { createSellbase } from '@sellbase/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestStore, sql, type TestStore } from './helpers.js';

/** The SDK wired to the real API in-process: types, paths and errors all line up. */
let s: TestStore;
let sb: ReturnType<typeof createSellbase>;

beforeAll(async () => {
  s = await createTestStore();
  const token = await s.token();
  sb = createSellbase({
    url: 'http://local.test/sellbase-api',
    token,
    fetch: (input, init) => Promise.resolve(s.api.request(String(input), init)),
  });
  await sb.admin.products.upsert({
    type: 'digital',
    title: 'Plantilla Notion',
    status: 'active',
    variants: [{ price_amount: 14900 }],
  });
});

afterAll(async () => {
  await sql.end();
});

describe('sdk against the api', () => {
  it('lists and fetches products', async () => {
    const { data } = await sb.products.list();
    expect(data.map((p) => p.slug)).toContain('plantilla-notion');
    const product = await sb.products.get('plantilla-notion');
    expect(product.variants[0]?.price_amount).toBe(14900);
  });

  it('runs a cart end to end', async () => {
    const cart = await sb.cart.create();
    const product = await sb.products.get('plantilla-notion');
    const added = await sb.cart.add(cart.token, product.variants[0]!.id, 2);
    expect(added.totals.total_amount).toBe(29800);
    const updated = await sb.cart.update(cart.token, added.items[0]!.id, 1);
    expect(updated.totals.total_amount).toBe(14900);
    const empty = await sb.cart.remove(cart.token, added.items[0]!.id);
    expect(empty.items).toEqual([]);
  });

  it('surfaces API errors with hints', async () => {
    const error = await sb.products
      .get('no-existe')
      .catch((e: { code: string; hint: string }) => e);
    expect(error).toMatchObject({ code: 'NOT_FOUND' });
    expect((error as { hint: string }).hint).toContain('GET /storefront/products');
  });

  it('exposes admin routes for agents', async () => {
    const doctor = await sb.admin.doctor();
    expect(doctor.checks.find((c) => c.id === 'catalog')?.status).toBe('ok');
  });
});
