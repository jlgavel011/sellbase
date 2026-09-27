import { describe, expect, it } from 'vitest';
import { excerpt, scaffoldStorefront, searchDocs } from '../src/docs.js';

describe('docs_search', () => {
  it('finds the live Stripe guide from a Spanish question', () => {
    const [first] = searchDocs('cómo cobrar de verdad con stripe live');
    expect(first?.source).toBe('docs/guides/stripe-live.md');
  });

  it('finds API routes and skills', () => {
    expect(searchDocs('refunds:write scope').some((d) => d.source.includes('api.md'))).toBe(true);
    expect(searchDocs('free_over_amount pickup')[0]?.source).toBe(
      'skills/configure-shipping/SKILL.md',
    );
    expect(searchDocs('zz')).toEqual([]);
  });

  it('keeps excerpts compact around the match', () => {
    const text = `${'a '.repeat(2000)}webhook ${'b '.repeat(2000)}`;
    const out = excerpt(text, 'webhook', 400);
    expect(out.length).toBeLessThan(420);
    expect(out).toContain('webhook');
  });
});

describe('storefront_scaffold', () => {
  it('suggests the booking flow for appointments', () => {
    const plan = scaffoldStorefront('agenda de citas para mi consultorio');
    expect(plan.components.map((c) => c.name)).toEqual(
      expect.arrayContaining(['theme', 'booking-picker', 'product-detail', 'checkout']),
    );
    expect(plan.components.map((c) => c.name)).not.toContain('cart-drawer');
    expect(plan.command).toMatch(/^npx sellbase add /);
  });

  it('defaults to a catalog with cart and checkout', () => {
    const plan = scaffoldStorefront('quiero vender playeras');
    expect(plan.command).toContain('cart-drawer');
    expect(plan.command).toContain('product-card'); // dependency of product-grid
    expect(plan.pages).toContain('/productos/[slug]');
  });
});
