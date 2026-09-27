import { describe, expect, it } from 'vitest';
import { calculateTotals, isSellbaseError, type PricingInput } from '../src/index.js';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const C1 = '33333333-3333-4333-8333-333333333333';

const line = (id: string, unit_price_amount: number, quantity = 1, extra: object = {}) => ({
  id,
  unit_price_amount,
  quantity,
  ...extra,
});

const base = (overrides: Partial<PricingInput> = {}): PricingInput => ({
  currency: 'MXN',
  lines: [],
  ...overrides,
});

function expectError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (err) {
    expect(isSellbaseError(err)).toBe(true);
    if (isSellbaseError(err)) {
      expect(err.code).toBe(code);
      expect(err.hint.length).toBeGreaterThan(0);
    }
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('calculateTotals — basics', () => {
  it('returns zeros for an empty cart', () => {
    const t = calculateTotals(base());
    expect(t).toMatchObject({
      subtotal_amount: 0,
      discount_amount: 0,
      tax_amount: 0,
      total_amount: 0,
    });
    expect(t.lines).toEqual([]);
  });

  it('prices a single line', () => {
    const t = calculateTotals(base({ lines: [line('a', 19990)] }));
    expect(t.subtotal_amount).toBe(19990);
    expect(t.total_amount).toBe(19990);
  });

  it('multiplies by quantity', () => {
    const t = calculateTotals(base({ lines: [line('a', 19990, 3)] }));
    expect(t.lines[0]?.subtotal_amount).toBe(59970);
    expect(t.total_amount).toBe(59970);
  });

  it('sums several lines', () => {
    const t = calculateTotals(base({ lines: [line('a', 10000, 2), line('b', 5050)] }));
    expect(t.subtotal_amount).toBe(25050);
  });

  it('adds shipping to the total', () => {
    const t = calculateTotals(base({ lines: [line('a', 10000)], shipping_amount: 9900 }));
    expect(t.shipping_amount).toBe(9900);
    expect(t.total_amount).toBe(19900);
  });

  it('keeps zero-priced items (gifts) at zero', () => {
    const t = calculateTotals(base({ lines: [line('gift', 0), line('a', 1000)] }));
    expect(t.lines.map((l) => l.total_amount)).toEqual([0, 1000]);
  });

  it('echoes the currency and preserves line ids and order', () => {
    const t = calculateTotals(base({ currency: 'USD', lines: [line('x', 1), line('y', 2)] }));
    expect(t.currency).toBe('USD');
    expect(t.lines.map((l) => l.id)).toEqual(['x', 'y']);
  });

  it('works with zero-decimal currencies (JPY)', () => {
    const t = calculateTotals(base({ currency: 'JPY', lines: [line('a', 1500, 2)] }));
    expect(t.total_amount).toBe(3000);
  });

  it('does not mutate its input', () => {
    const input = base({
      lines: [line('a', 1000)],
      discounts: [{ id: 'd', kind: 'percent', value: 1000 }],
    });
    const copy = structuredClone(input);
    calculateTotals(input);
    expect(input).toEqual(copy);
  });
});

describe('calculateTotals — tax', () => {
  it('extracts included 16% IVA exactly', () => {
    const t = calculateTotals(
      base({ lines: [line('a', 11600)], tax: { mode: 'inclusive', rate_bps: 1600 } }),
    );
    expect(t.tax_amount).toBe(1600);
    expect(t.total_amount).toBe(11600);
  });

  it('rounds included tax half-up', () => {
    const t = calculateTotals(
      base({ lines: [line('a', 10000)], tax: { mode: 'inclusive', rate_bps: 1600 } }),
    );
    expect(t.tax_amount).toBe(1379); // 1379.31
    expect(t.total_amount).toBe(10000);
  });

  it('includes shipping in the taxable base by default', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 11600)],
        shipping_amount: 11600,
        tax: { mode: 'inclusive', rate_bps: 1600 },
      }),
    );
    expect(t.tax_amount).toBe(3200);
    expect(t.shipping_tax_amount).toBe(1600);
  });

  it('can exclude shipping from tax', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 11600)],
        shipping_amount: 11600,
        tax: { mode: 'inclusive', rate_bps: 1600, applies_to_shipping: false },
      }),
    );
    expect(t.tax_amount).toBe(1600);
    expect(t.shipping_tax_amount).toBe(0);
  });

  it('adds exclusive tax on top', () => {
    const t = calculateTotals(
      base({ lines: [line('a', 10000)], tax: { mode: 'exclusive', rate_bps: 825 } }),
    );
    expect(t.tax_amount).toBe(825);
    expect(t.total_amount).toBe(10825);
  });

  it('rounds exclusive tax down below .5', () => {
    const t = calculateTotals(
      base({ lines: [line('a', 999)], tax: { mode: 'exclusive', rate_bps: 825 } }),
    );
    expect(t.tax_amount).toBe(82); // 82.4175
    expect(t.total_amount).toBe(1081);
  });

  it('rounds exclusive tax up at exactly .5', () => {
    const t = calculateTotals(
      base({ lines: [line('a', 200)], tax: { mode: 'exclusive', rate_bps: 25 } }),
    );
    expect(t.tax_amount).toBe(1);
    expect(t.total_amount).toBe(201);
  });

  it('charges no tax at rate 0', () => {
    const t = calculateTotals(
      base({ lines: [line('a', 10000)], tax: { mode: 'exclusive', rate_bps: 0 } }),
    );
    expect(t.tax_amount).toBe(0);
    expect(t.total_amount).toBe(10000);
  });

  it('computes tax after discounts', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 11600)],
        discounts: [{ id: 'd', kind: 'percent', value: 1000 }],
        tax: { mode: 'inclusive', rate_bps: 1600 },
      }),
    );
    expect(t.total_amount).toBe(10440);
    expect(t.tax_amount).toBe(1440);
  });

  it('computes exclusive tax on discounted lines plus shipping', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 10000)],
        discounts: [{ id: 'd', kind: 'fixed', value: 2000 }],
        shipping_amount: 1000,
        tax: { mode: 'exclusive', rate_bps: 1000 },
      }),
    );
    expect(t.tax_amount).toBe(900);
    expect(t.total_amount).toBe(9900);
  });

  it('splits tax across lines and shipping so the parts add up', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 3333), line('b', 3333), line('c', 3334, 3)],
        shipping_amount: 1799,
        tax: { mode: 'inclusive', rate_bps: 1600 },
      }),
    );
    const parts = t.lines.reduce((acc, l) => acc + l.tax_amount, 0) + t.shipping_tax_amount;
    expect(parts).toBe(t.tax_amount);
  });
});

describe('calculateTotals — discounts', () => {
  it('applies a percent discount', () => {
    const t = calculateTotals(
      base({ lines: [line('a', 19990)], discounts: [{ id: 'd', kind: 'percent', value: 1000 }] }),
    );
    expect(t.discount_amount).toBe(1999);
    expect(t.total_amount).toBe(17991);
  });

  it('rounds percent discounts half-up', () => {
    const t = calculateTotals(
      base({ lines: [line('a', 1995)], discounts: [{ id: 'd', kind: 'percent', value: 1000 }] }),
    );
    expect(t.discount_amount).toBe(200); // 199.5
    expect(t.total_amount).toBe(1795);
  });

  it('applies a fixed discount', () => {
    const t = calculateTotals(
      base({ lines: [line('a', 19990)], discounts: [{ id: 'd', kind: 'fixed', value: 5000 }] }),
    );
    expect(t.total_amount).toBe(14990);
  });

  it('caps a fixed discount at the merchandise subtotal and never discounts shipping', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 3000)],
        shipping_amount: 500,
        discounts: [{ id: 'd', kind: 'fixed', value: 5000 }],
      }),
    );
    expect(t.discount_amount).toBe(3000);
    expect(t.applied_discounts[0]?.amount).toBe(3000);
    expect(t.total_amount).toBe(500);
  });

  it('allows a 100% discount', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 4990, 2)],
        shipping_amount: 990,
        discounts: [{ id: 'd', kind: 'percent', value: 10_000 }],
      }),
    );
    expect(t.total_amount).toBe(990);
  });

  it('clamps percent values above 100%', () => {
    const t = calculateTotals(
      base({ lines: [line('a', 1000)], discounts: [{ id: 'd', kind: 'percent', value: 15_000 }] }),
    );
    expect(t.discount_amount).toBe(1000);
    expect(t.total_amount).toBe(0);
  });

  it('splits a discount proportionally across lines', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 3000), line('b', 1000)],
        discounts: [{ id: 'd', kind: 'fixed', value: 1000 }],
      }),
    );
    expect(t.lines.map((l) => l.discount_amount)).toEqual([750, 250]);
  });

  it('gives the leftover cent to the earliest line on ties', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 100), line('b', 100), line('c', 100)],
        discounts: [{ id: 'd', kind: 'fixed', value: 100 }],
      }),
    );
    expect(t.lines.map((l) => l.discount_amount)).toEqual([34, 33, 33]);
  });

  it('restricts discounts to specific products', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 10000, 1, { product_id: P1 }), line('b', 5000, 1, { product_id: P2 })],
        discounts: [
          {
            id: 'd',
            kind: 'percent',
            value: 2000,
            applies_to: { type: 'products', product_ids: [P1] },
          },
        ],
      }),
    );
    expect(t.lines.map((l) => l.discount_amount)).toEqual([2000, 0]);
  });

  it('restricts discounts to collections', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 10000, 1, { collection_ids: [C1] }), line('b', 5000)],
        discounts: [
          {
            id: 'd',
            kind: 'fixed',
            value: 1500,
            applies_to: { type: 'collections', collection_ids: [C1] },
          },
        ],
      }),
    );
    expect(t.lines.map((l) => l.discount_amount)).toEqual([1500, 0]);
  });

  it('rejects a discount when no line qualifies, leaving totals untouched', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 10000, 1, { product_id: P2 })],
        discounts: [
          {
            id: 'd',
            code: 'VIP',
            kind: 'percent',
            value: 1000,
            applies_to: { type: 'products', product_ids: [P1] },
          },
        ],
      }),
    );
    expect(t.total_amount).toBe(10000);
    expect(t.applied_discounts).toEqual([]);
    expect(t.rejected_discounts[0]).toMatchObject({
      id: 'd',
      code: 'VIP',
      reason: 'DISCOUNT_NOT_APPLICABLE',
    });
  });

  it('rejects a discount below its minimum subtotal with a hint', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 9000)],
        discounts: [{ id: 'd', kind: 'fixed', value: 1000, min_subtotal_amount: 10000 }],
      }),
    );
    expect(t.total_amount).toBe(9000);
    expect(t.rejected_discounts[0]?.reason).toBe('DISCOUNT_MIN_SUBTOTAL_NOT_MET');
    expect(t.rejected_discounts[0]?.hint).toContain('1000');
  });

  it('accepts a discount exactly at its minimum subtotal', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 10000)],
        discounts: [{ id: 'd', kind: 'fixed', value: 1000, min_subtotal_amount: 10000 }],
      }),
    );
    expect(t.total_amount).toBe(9000);
  });

  it('checks the minimum against eligible lines only', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 5000, 1, { product_id: P1 }), line('b', 15000, 1, { product_id: P2 })],
        discounts: [
          {
            id: 'd',
            kind: 'percent',
            value: 1000,
            min_subtotal_amount: 10000,
            applies_to: { type: 'products', product_ids: [P1] },
          },
        ],
      }),
    );
    expect(t.rejected_discounts).toHaveLength(1);
    expect(t.total_amount).toBe(20000);
  });

  it('stacks discounts in order, each on the remainder (percent then fixed)', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 10000)],
        discounts: [
          { id: 'auto', kind: 'percent', value: 1000 },
          { id: 'code', kind: 'fixed', value: 1000 },
        ],
      }),
    );
    expect(t.applied_discounts.map((d) => d.amount)).toEqual([1000, 1000]);
    expect(t.total_amount).toBe(8000);
  });

  it('stacks discounts in order, each on the remainder (fixed then percent)', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 10000)],
        discounts: [
          { id: 'code', kind: 'fixed', value: 1000 },
          { id: 'auto', kind: 'percent', value: 1000 },
        ],
      }),
    );
    expect(t.applied_discounts.map((d) => d.amount)).toEqual([1000, 900]);
    expect(t.total_amount).toBe(8100);
  });

  it('never discounts a line below zero when stacking', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 1000)],
        discounts: [
          { id: 'x', kind: 'fixed', value: 800 },
          { id: 'y', kind: 'fixed', value: 800 },
        ],
      }),
    );
    expect(t.applied_discounts.map((d) => d.amount)).toEqual([800, 200]);
    expect(t.lines[0]?.total_amount).toBe(0);
  });

  it('handles a fixed discount on an all-zero cart', () => {
    const t = calculateTotals(
      base({ lines: [line('gift', 0)], discounts: [{ id: 'd', kind: 'fixed', value: 500 }] }),
    );
    expect(t.discount_amount).toBe(0);
    expect(t.total_amount).toBe(0);
  });

  it('keeps line discounts summing to the order discount (randomized)', () => {
    let seed = 42;
    const rand = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % max;
    };
    for (let run = 0; run < 200; run++) {
      const lines = Array.from({ length: 1 + rand(6) }, (_, i) =>
        line(`l${i}`, rand(50000), 1 + rand(5)),
      );
      const t = calculateTotals(
        base({
          lines,
          discounts: [
            { id: 'p', kind: 'percent', value: 1 + rand(10000) },
            { id: 'f', kind: 'fixed', value: 1 + rand(30000) },
          ],
          shipping_amount: rand(20000),
          tax: { mode: rand(2) ? 'inclusive' : 'exclusive', rate_bps: rand(2500) },
        }),
      );
      const lineDiscounts = t.lines.reduce((a, l) => a + l.discount_amount, 0);
      expect(lineDiscounts).toBe(t.line_discount_amount);
      expect(t.lines.every((l) => l.total_amount >= 0)).toBe(true);
      const lineTaxes = t.lines.reduce((a, l) => a + l.tax_amount, 0) + t.shipping_tax_amount;
      expect(lineTaxes).toBe(t.tax_amount);
      const expected =
        t.subtotal_amount -
        t.discount_amount +
        t.shipping_amount +
        (t.tax_mode === 'exclusive' ? t.tax_amount : 0);
      expect(t.total_amount).toBe(expected);
    }
  });
});

describe('calculateTotals — free shipping', () => {
  it('removes the shipping charge', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 10000)],
        shipping_amount: 9900,
        discounts: [{ id: 'fs', kind: 'free_shipping', value: 0 }],
      }),
    );
    expect(t.shipping_discount_amount).toBe(9900);
    expect(t.discount_amount).toBe(9900);
    expect(t.total_amount).toBe(10000);
  });

  it('respects the minimum subtotal', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 49900)],
        shipping_amount: 9900,
        discounts: [{ id: 'fs', kind: 'free_shipping', value: 0, min_subtotal_amount: 99900 }],
      }),
    );
    expect(t.total_amount).toBe(59800);
    expect(t.rejected_discounts[0]?.reason).toBe('DISCOUNT_MIN_SUBTOTAL_NOT_MET');
  });

  it('does not double count when two free-shipping discounts stack', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 10000)],
        shipping_amount: 9900,
        discounts: [
          { id: 'fs1', kind: 'free_shipping', value: 0 },
          { id: 'fs2', kind: 'free_shipping', value: 0 },
        ],
      }),
    );
    expect(t.applied_discounts.map((d) => d.amount)).toEqual([9900, 0]);
    expect(t.total_amount).toBe(10000);
  });

  it('applies with zero-cost shipping as a no-op', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 10000)],
        discounts: [{ id: 'fs', kind: 'free_shipping', value: 0 }],
      }),
    );
    expect(t.applied_discounts[0]?.amount).toBe(0);
    expect(t.total_amount).toBe(10000);
  });

  it('removes tax on shipping too', () => {
    const t = calculateTotals(
      base({
        lines: [line('a', 11600)],
        shipping_amount: 11600,
        discounts: [{ id: 'fs', kind: 'free_shipping', value: 0 }],
        tax: { mode: 'inclusive', rate_bps: 1600 },
      }),
    );
    expect(t.tax_amount).toBe(1600);
    expect(t.shipping_tax_amount).toBe(0);
  });
});

describe('calculateTotals — validation', () => {
  it('rejects decimal prices', () => {
    expectError(() => calculateTotals(base({ lines: [line('a', 199.9)] })), 'VALIDATION_ERROR');
  });

  it('rejects negative prices', () => {
    expectError(() => calculateTotals(base({ lines: [line('a', -100)] })), 'VALIDATION_ERROR');
  });

  it('rejects zero or fractional quantities', () => {
    expectError(() => calculateTotals(base({ lines: [line('a', 100, 0)] })), 'VALIDATION_ERROR');
    expectError(() => calculateTotals(base({ lines: [line('a', 100, 1.5)] })), 'VALIDATION_ERROR');
  });

  it('rejects unknown currencies', () => {
    expectError(() => calculateTotals(base({ currency: 'XYZ' })), 'VALIDATION_ERROR');
    expectError(() => calculateTotals(base({ currency: 'mxn' })), 'VALIDATION_ERROR');
  });

  it('names the offending field in the error', () => {
    expect.hasAssertions();
    try {
      calculateTotals(base({ lines: [line('a', 1.5)] }));
    } catch (err) {
      expect(isSellbaseError(err) && err.message).toContain('lines.0.unit_price_amount');
    }
  });

  it('rejects amounts beyond the safe integer range', () => {
    expectError(() => calculateTotals(base({ lines: [line('a', 1e15, 10)] })), 'INVALID_AMOUNT');
  });
});
