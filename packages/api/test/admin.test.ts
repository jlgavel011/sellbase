import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestStore, sql, type TestStore } from './helpers.js';

let s: TestStore;
let other: TestStore;

beforeAll(async () => {
  s = await createTestStore();
  other = await createTestStore();
});

afterAll(async () => {
  await sql.end();
});

describe('authentication and scopes', () => {
  it('requires a token and says how to get one', async () => {
    const res = await s.request('GET', '/products');
    expect(res.status).toBe(401);
    expect(res.body.error.hint).toContain('Authorization: Bearer');
  });

  it('rejects unknown tokens', async () => {
    const res = await s.request('GET', '/products', { token: 'sb_live_nope' });
    expect(res.status).toBe(401);
  });

  it('does not accept a token from another store', async () => {
    const foreign = await other.token();
    const res = await s.request('GET', '/products', { token: foreign });
    expect(res.status).toBe(401);
  });

  it('enforces token scopes', async () => {
    const readOnly = await s.token(['catalog:read']);
    const res = await s.request('POST', '/products', {
      token: readOnly,
      body: { type: 'digital', title: 'X', variants: [{ price_amount: 1 }] },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.details.required_scope).toBe('catalog:write');
  });

  it('keeps settings and integrations for owners and admins', async () => {
    const staff = await s.staff('staff');
    const denied = await s.request('PATCH', '/store', { token: staff, body: { name: 'Nope' } });
    expect(denied.status).toBe(403);
    const owner = await s.staff('owner');
    const ok = await s.request('PATCH', '/store', {
      token: owner,
      body: { name: 'Renamed', settings: { brand_color: '#112233' } },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ name: 'Renamed', settings: { brand_color: '#112233' } });
    expect(ok.body.settings.tax.rate_bps).toBe(1600); // merged, not replaced
  });

  it('rejects signed-in users who are not on the team', async () => {
    const outsider = await other.staff('owner');
    const res = await s.request('GET', '/store', { token: outsider });
    expect(res.status).toBe(401);
  });
});

describe('product_upsert', () => {
  let token: string;
  beforeAll(async () => {
    token = await s.token();
  });

  it('creates a product with options, variants, specs and stock in one call', async () => {
    const res = await s.request('POST', '/products', {
      token,
      body: {
        type: 'physical',
        title: 'Sudadera Árbol',
        status: 'active',
        options: [{ name: 'Talla', values: ['M', 'L'] }],
        variants: [
          {
            title: 'M',
            sku: 'SUD-M',
            option_values: { Talla: 'M' },
            price_amount: 59900,
            inventory: { on_hand: 10 },
            physical: { weight_g: 500, length_cm: 30, width_cm: 25, height_cm: 5 },
          },
          {
            title: 'L',
            sku: 'SUD-L',
            option_values: { Talla: 'L' },
            price_amount: 59900,
            inventory: { on_hand: 0, policy: 'continue' },
          },
        ],
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.slug).toBe('sudadera-arbol');
    expect(
      res.body.variants.map((v: { inventory: { on_hand: number } }) => v.inventory.on_hand),
    ).toEqual([10, 0]);
    expect(res.body.variants[0].physical).toMatchObject({ weight_g: 500, length_cm: 30 });

    const detail = await s.request('GET', '/storefront/products/sudadera-arbol');
    expect(detail.body.options).toEqual([{ name: 'Talla', values: ['M', 'L'] }]);
    expect(detail.body.variants.map((v: { available: boolean }) => v.available)).toEqual([
      true,
      true,
    ]); // L allows backorders
  });

  it('updates in place and archives variants that were left out', async () => {
    const list = await s.request('GET', '/products?q=SUD-M', { token });
    const product = list.body.data[0];
    const keep = product.variants.find((v: { sku: string }) => v.sku === 'SUD-M');
    const res = await s.request('POST', '/products', {
      token,
      body: {
        id: product.id,
        type: 'physical',
        title: 'Sudadera Árbol',
        status: 'active',
        variants: [
          { id: keep.id, title: 'M', sku: 'SUD-M', price_amount: 54900, inventory: { on_hand: 7 } },
        ],
      },
    });
    expect(res.body.variants.map((v: { status: string }) => v.status)).toEqual([
      'active',
      'archived',
    ]);
    expect(res.body.variants[0]).toMatchObject({ price_amount: 54900, inventory: { on_hand: 7 } });
    expect(res.body.slug).toBe('sudadera-arbol');
  });

  it('gives duplicate titles a unique slug', async () => {
    const res = await s.request('POST', '/products', {
      token,
      body: { type: 'digital', title: 'Sudadera Árbol', variants: [{ price_amount: 1 }] },
    });
    expect(res.body.slug).toBe('sudadera-arbol-2');
  });

  it('explains that services are not available yet', async () => {
    const res = await s.request('POST', '/products', {
      token,
      body: {
        type: 'service',
        title: 'Consulta',
        variants: [{ price_amount: 80000, service: { duration_min: 60, location_type: 'online' } }],
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.hint).toContain('physical or digital');
  });

  it('audits every change', async () => {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from sellbase.audit_log where store_id = ${s.storeId} and action like 'product.%'`;
    expect(row?.n).toBeGreaterThanOrEqual(3);
  });

  it('adjusts inventory with a reason', async () => {
    const list = await s.request('GET', '/products?q=SUD-M', { token });
    const variantId = list.body.data[0].variants[0].id;
    const res = await s.request('POST', '/inventory/adjust', {
      token,
      body: { variant_id: variantId, delta: -2, reason: 'merma' },
    });
    expect(res.body).toMatchObject({ on_hand: 5, reserved: 0, policy: 'deny' });
    const tooMuch = await s.request('POST', '/inventory/adjust', {
      token,
      body: { variant_id: variantId, delta: -50, reason: 'x' },
    });
    expect(tooMuch.status).toBe(409);
  });
});

describe('files', () => {
  it('uploads the file buyers receive for a digital product', async () => {
    const token = await s.token();
    const product = await s.request('POST', '/products', {
      token,
      body: { type: 'digital', title: 'Ebook Archivos', variants: [{ price_amount: 9900 }] },
    });
    const variantId = product.body.variants[0].id;
    const res = await s.request('POST', `/variants/${variantId}/digital-assets`, {
      token,
      body: {
        file_name: 'mi guía.pdf',
        content_base64: Buffer.from('%PDF-1.4 hola').toString('base64'),
        download_limit: 3,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ file_name: 'mi guía.pdf', size_bytes: 13 });
    expect(s.uploads.at(-1)).toMatchObject({ bucket: 'sellbase-digital', size: 13 });
    expect(s.uploads.at(-1)?.path).toMatch(/mi-gui.a\.pdf$|mi-guia\.pdf$/);
    const detail = await s.request('GET', `/products/${product.body.id}`, { token });
    expect(detail.body.variants[0].digital_assets).toHaveLength(1);
  });

  it('refuses files on physical products', async () => {
    const token = await s.token();
    const product = await s.request('POST', '/products', {
      token,
      body: { type: 'physical', title: 'Taza', variants: [{ price_amount: 100 }] },
    });
    const res = await s.request('POST', `/variants/${product.body.variants[0].id}/digital-assets`, {
      token,
      body: { file_name: 'x.pdf', content_base64: 'aGk=' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.hint).toContain('digital');
  });

  it('adds product images from a URL or an upload', async () => {
    const token = await s.token();
    const product = await s.request('POST', '/products', {
      token,
      body: {
        type: 'physical',
        title: 'Gorra',
        status: 'active',
        variants: [{ price_amount: 100 }],
      },
    });
    await s.request('POST', `/products/${product.body.id}/media`, {
      token,
      body: { url: 'https://img.test/gorra.jpg', alt: 'Gorra' },
    });
    const up = await s.request('POST', `/products/${product.body.id}/media`, {
      token,
      body: { file_name: 'lado.png', content_base64: Buffer.from('png').toString('base64') },
    });
    expect(up.body.media.map((m: { url: string }) => m.url)).toEqual([
      'https://img.test/gorra.jpg',
      expect.stringContaining('sellbase-media'),
    ]);
    const storefront = await s.request('GET', '/storefront/products/gorra');
    expect(storefront.body.image_url).toBe('https://img.test/gorra.jpg');
    const bad = await s.request('POST', `/products/${product.body.id}/media`, {
      token,
      body: { alt: 'nada' },
    });
    expect(bad.status).toBe(400);
  });
});

describe('idempotency', () => {
  it('replays the first response for the same key', async () => {
    const key = crypto.randomUUID();
    const a = await s.request('POST', '/storefront/carts', {
      body: {},
      headers: { 'idempotency-key': key },
    });
    const b = await s.request('POST', '/storefront/carts', {
      body: {},
      headers: { 'idempotency-key': key },
    });
    expect(b.body.token).toBe(a.body.token);
  });

  it('rejects reusing a key with a different body', async () => {
    const key = crypto.randomUUID();
    await s.request('POST', '/storefront/carts', { body: {}, headers: { 'idempotency-key': key } });
    const res = await s.request('POST', '/storefront/carts', {
      body: { currency: 'USD' },
      headers: { 'idempotency-key': key },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('system', () => {
  it('serves the OpenAPI document', async () => {
    const res = await s.request('GET', '/openapi.json');
    expect(res.body.openapi).toBe('3.1.0');
  });

  it('reports setup status with hints', async () => {
    const token = await s.token();
    const res = await s.request('GET', '/doctor', { token });
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.checks.map((c: { id: string }) => [c.id, c]));
    expect(byId.schema.status).toBe('ok');
    expect(byId.rls.status).toBe('ok');
    expect(byId.payments.status).toBe('fail');
    expect(byId.payments.hint).toContain('/integrations/stripe/connect');
  });

  it('answers unknown routes with a hint', async () => {
    const res = await s.request('GET', '/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.hint).toContain('openapi.json');
  });
});
