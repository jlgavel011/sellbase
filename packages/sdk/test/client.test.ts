import { describe, expect, it } from 'vitest';
import { createSellbase, isSellbaseError } from '../src/index.js';

function recorder(response: { status: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(response.body), { status: response.status });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

describe('createSellbase', () => {
  it('builds paths, queries and headers from the route contracts', async () => {
    const r = recorder({ status: 200, body: { data: [], next_cursor: null } });
    const sb = createSellbase({
      url: 'https://p.supabase.co/functions/v1/sellbase-api/',
      anonKey: 'anon',
      fetch: r.fetch,
    });
    await sb.products.list({ q: 'play era', limit: 5 });
    expect(r.calls[0]?.url).toBe(
      'https://p.supabase.co/functions/v1/sellbase-api/v1/storefront/products?q=play+era&limit=5',
    );
    expect((r.calls[0]?.init.headers as Record<string, string>).apikey).toBe('anon');
  });

  it('encodes path params and sends an idempotency key on mutations', async () => {
    const r = recorder({ status: 200, body: {} });
    const sb = createSellbase({ url: 'https://x.test/sellbase-api', fetch: r.fetch });
    await sb.cart.update('tok/en', 'item-1', 3);
    const { url, init } = r.calls[0]!;
    expect(url).toBe('https://x.test/sellbase-api/v1/storefront/carts/tok%2Fen/items/item-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ quantity: 3 });
    expect((init.headers as Record<string, string>)['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sends the admin token', async () => {
    const r = recorder({ status: 200, body: {} });
    const sb = createSellbase({
      url: 'https://x.test/sellbase-api',
      token: async () => 'sb_live_abc',
      fetch: r.fetch,
    });
    await sb.admin.doctor();
    expect((r.calls[0]?.init.headers as Record<string, string>).authorization).toBe(
      'Bearer sb_live_abc',
    );
  });

  it('turns API errors into SellbaseErrors with the hint', async () => {
    const r = recorder({
      status: 409,
      body: {
        error: {
          code: 'OUT_OF_STOCK',
          message: 'Only 1 left',
          hint: 'Lower the quantity',
          details: { available: 1 },
        },
      },
    });
    const sb = createSellbase({ url: 'https://x.test/sellbase-api', fetch: r.fetch });
    const error = await sb.checkout
      .start({
        cart_token: 'x'.repeat(24),
        email: 'a@b.co',
        success_url: 'https://a.co',
        cancel_url: 'https://a.co',
      })
      .catch((e: unknown) => e);
    expect(isSellbaseError(error) && error.code).toBe('OUT_OF_STOCK');
    expect(isSellbaseError(error) && error.hint).toBe('Lower the quantity');
    expect(isSellbaseError(error) && error.details).toEqual({ available: 1, status: 409 });
  });

  it('reports non-JSON failures clearly', async () => {
    const fetch = (async () =>
      new Response('<html>bad gateway</html>', { status: 502 })) as typeof globalThis.fetch;
    const error = await createSellbase({ url: 'https://x.test/sellbase-api', fetch })
      .products.list()
      .catch((e: unknown) => e);
    expect(isSellbaseError(error) && error.hint).toContain('Sellbase URL');
  });
});
