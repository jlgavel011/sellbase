import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_SCOPES,
  discountInput,
  fromZodError,
  productUpsertInput,
  refundInput,
  toErrorResponse,
} from '../src/index.js';

describe('productUpsertInput', () => {
  it('accepts a minimal physical product', () => {
    const r = productUpsertInput.safeParse({
      type: 'physical',
      title: 'Playera negra',
      variants: [
        {
          price_amount: 34900,
          physical: { weight_g: 200, length_cm: 30, width_cm: 25, height_cm: 2 },
        },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.data?.status).toBe('draft');
    expect(r.data?.variants[0]?.title).toBe('Default');
  });

  it('requires service specs on services', () => {
    const r = productUpsertInput.safeParse({
      type: 'service',
      title: 'Consulta',
      variants: [{ price_amount: 80000 }],
    });
    expect(r.success).toBe(false);
    const err = r.error && fromZodError(r.error, 'product');
    expect(err?.hint).toContain('variants.0.service');
  });

  it('rejects physical specs on digital products', () => {
    const r = productUpsertInput.safeParse({
      type: 'digital',
      title: 'Ebook',
      variants: [
        { price_amount: 19900, physical: { weight_g: 1, length_cm: 1, width_cm: 1, height_cm: 1 } },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects decimal prices', () => {
    const r = productUpsertInput.safeParse({
      type: 'digital',
      title: 'Ebook',
      variants: [{ price_amount: 199.9 }],
    });
    expect(r.success).toBe(false);
  });
});

describe('discountInput', () => {
  it('expresses percent in basis points', () => {
    expect(
      discountInput.safeParse({ code: 'VERANO10', kind: 'percent', value: 1000 }).success,
    ).toBe(true);
    expect(discountInput.safeParse({ code: 'MAL', kind: 'percent', value: 10_001 }).success).toBe(
      false,
    );
  });

  it('validates date ranges and code format', () => {
    expect(
      discountInput.safeParse({
        code: 'X-1',
        kind: 'fixed',
        value: 100,
        starts_at: '2026-10-02T00:00:00Z',
        ends_at: '2026-10-01T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(discountInput.safeParse({ code: 'lower', kind: 'fixed', value: 100 }).success).toBe(
      false,
    );
  });
});

describe('refunds and scopes', () => {
  it('requires explicit confirmation for refunds', () => {
    expect(refundInput.safeParse({ amount: 100, reason: 'dañado' }).success).toBe(false);
    expect(refundInput.safeParse({ amount: 100, reason: 'dañado', confirm: true }).success).toBe(
      true,
    );
  });

  it('never grants refunds:write to agents by default', () => {
    expect(DEFAULT_AGENT_SCOPES).not.toContain('refunds:write');
    expect(DEFAULT_AGENT_SCOPES).toContain('catalog:write');
  });
});

describe('toErrorResponse', () => {
  it('hides internal errors behind INTERNAL_ERROR', () => {
    expect(toErrorResponse(new Error('db password is x')).error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(toErrorResponse(new Error('db password is x')))).not.toContain(
      'password',
    );
  });
});
