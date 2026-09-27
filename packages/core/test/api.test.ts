import { describe, expect, it } from 'vitest';
import { buildOpenApi, routeList, routes } from '../src/index.js';

describe('route contracts', () => {
  it('have unique ids and unique method+path pairs', () => {
    const ids = routeList.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = routeList.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('declare a params schema for exactly the path placeholders', () => {
    for (const r of routeList) {
      const placeholders = [...r.path.matchAll(/:([a-z_]+)/g)].map((m) => m[1]).sort();
      const declared = Object.keys(r.params?.shape ?? {}).sort();
      expect(declared, r.id).toEqual(placeholders);
    }
  });

  it('keep storefront routes public and everything else behind staff auth', () => {
    for (const r of routeList) {
      expect(r.auth.kind, r.id).toBe(r.path.startsWith('/storefront') ? 'public' : 'staff');
    }
  });

  it('validate request bodies with the shared schemas', () => {
    const body = routes.checkoutStart.body;
    expect(
      body.safeParse({
        cart_token: 'x'.repeat(24),
        email: 'A@B.com',
        success_url: 'https://a.dev/ok',
        cancel_url: 'https://a.dev/no',
      }).data?.email,
    ).toBe('a@b.com');
    expect(body.safeParse({ cart_token: 'short', email: 'a@b.com' }).success).toBe(false);
  });
});

describe('buildOpenApi', () => {
  const doc = buildOpenApi('0.1.0') as {
    openapi: string;
    paths: Record<
      string,
      Record<
        string,
        { operationId: string; parameters: { name: string; in: string }[]; security: unknown[] }
      >
    >;
  };

  it('emits OpenAPI 3.1 with every route', () => {
    expect(doc.openapi).toBe('3.1.0');
    const ops = Object.values(doc.paths).flatMap((p) => Object.values(p));
    expect(ops.map((o) => o.operationId).sort()).toEqual(routeList.map((r) => r.id).sort());
  });

  it('uses {param} paths and documents Idempotency-Key on mutations', () => {
    const op = doc.paths['/storefront/carts/{token}/items/{item_id}']?.patch;
    expect(op?.parameters.filter((p) => p.in === 'path').map((p) => p.name)).toEqual([
      'token',
      'item_id',
    ]);
    expect(op?.parameters.some((p) => p.name === 'Idempotency-Key')).toBe(true);
  });

  it('marks public and scoped operations', () => {
    expect(doc.paths['/storefront/checkout']?.post?.security).toEqual([]);
    expect(doc.paths['/products']?.post?.security).toEqual([{ bearerAuth: ['catalog:write'] }]);
  });

  it('is serializable JSON', () => {
    expect(() => JSON.parse(JSON.stringify(doc))).not.toThrow();
  });
});
