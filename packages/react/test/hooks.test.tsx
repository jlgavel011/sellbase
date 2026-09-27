import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSellbase, SellbaseProvider, useCart, useProducts } from '../src/index.js';

/** Minimal in-memory API: one product, carts keyed by token. */
function fakeApi() {
  const carts = new Map<
    string,
    { status: string; items: { id: string; variant_id: string; quantity: number }[] }
  >();
  let n = 0;
  const view = (token: string) => {
    const c = carts.get(token)!;
    const total = c.items.reduce((s, i) => s + i.quantity * 1000, 0);
    return {
      token,
      currency: 'MXN',
      status: c.status,
      email: null,
      discount_codes: [],
      rejected_discounts: [],
      requires_shipping: false,
      items: c.items.map((i) => ({
        ...i,
        product_id: 'p',
        product_slug: 'p',
        title: 'P',
        variant_title: null,
        sku: null,
        image_url: null,
        unit_price_amount: 1000,
        subtotal_amount: i.quantity * 1000,
        discount_amount: 0,
        total_amount: i.quantity * 1000,
        available: true,
      })),
      totals: {
        currency: 'MXN',
        subtotal_amount: total,
        discount_amount: 0,
        shipping_amount: 0,
        tax_amount: 0,
        tax_mode: 'inclusive',
        total_amount: total,
      },
    };
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetch = (async (input: string, init: RequestInit = {}) => {
    const path = new URL(input).pathname.replace('/sellbase-api/v1', '');
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (path === '/storefront/products')
      return json({ data: [{ id: 'p', slug: 'p', title: 'P' }], next_cursor: null });
    if (path === '/storefront/carts' && init.method === 'POST') {
      const token = `token-${++n}-xxxxxxxxxxxxxxxxxx`;
      carts.set(token, { status: 'open', items: [] });
      return json(view(token));
    }
    const m = /^\/storefront\/carts\/([^/]+)(\/items)?/.exec(path);
    if (m) {
      const token = decodeURIComponent(m[1]!);
      const cart = carts.get(token);
      if (!cart)
        return json(
          {
            error: {
              code: 'NOT_FOUND',
              message: 'Cart not found.',
              hint: 'Create a new cart',
              details: {},
            },
          },
          404,
        );
      if (m[2] && init.method === 'POST')
        cart.items.push({
          id: `i${cart.items.length}`,
          variant_id: body.variant_id,
          quantity: body.quantity,
        });
      return json(view(token));
    }
    return json({ error: { code: 'NOT_FOUND', message: 'no route', hint: '', details: {} } }, 404);
  }) as typeof globalThis.fetch;
  return { fetch, carts };
}

let api: ReturnType<typeof fakeApi>;
const wrapper = ({ children }: { children: ReactNode }) => (
  <SellbaseProvider
    client={createSellbase({ url: 'http://x.test/sellbase-api', fetch: api.fetch })}
  >
    {children}
  </SellbaseProvider>
);

beforeEach(() => {
  api = fakeApi();
  window.localStorage.clear();
});

describe('useProducts', () => {
  it('loads products', async () => {
    const { result } = renderHook(() => useProducts(), { wrapper });
    await waitFor(() => expect(result.current.data?.data).toHaveLength(1));
  });
});

describe('useCart', () => {
  it('creates the cart on the first add and remembers its token', async () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.cart).toBeNull();
    await act(() => result.current.addItem('v1', 2));
    expect(result.current.itemCount).toBe(2);
    expect(result.current.format(result.current.cart!.totals.total_amount)).toBe('$20.00');
    expect(window.localStorage.getItem('sellbase_cart_token')).toBe(result.current.token);
  });

  it('shares one cart between components (add in one, see it in another)', async () => {
    const { result } = renderHook(() => ({ detail: useCart(), drawer: useCart() }), { wrapper });
    await act(() => result.current.detail.addItem('v1', 3));
    await waitFor(() => expect(result.current.drawer.itemCount).toBe(3));
    expect(result.current.drawer.token).toBe(result.current.detail.token);
  });

  it('restores a saved cart and forgets it once converted', async () => {
    const first = renderHook(() => useCart(), { wrapper });
    await act(() => first.result.current.addItem('v1'));
    const token = first.result.current.token!;
    first.unmount();

    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.itemCount).toBe(1));

    api.carts.get(token)!.status = 'converted';
    const again = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(window.localStorage.getItem('sellbase_cart_token')).toBeNull());
    expect(again.result.current.cart).toBeNull();
  });

  it('starts over when the saved cart no longer exists', async () => {
    window.localStorage.setItem('sellbase_cart_token', 'missing-token-xxxxxxxxxxxx');
    renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(window.localStorage.getItem('sellbase_cart_token')).toBeNull());
  });
});
