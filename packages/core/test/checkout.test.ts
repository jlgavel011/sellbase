import { describe, expect, it } from 'vitest';
import {
  fulfillmentTypeFor,
  isSellbaseError,
  planCheckout,
  type CartLineWithCatalog,
} from '../src/index.js';

const P = '11111111-1111-4111-8111-111111111111';

const line = (over: Partial<CartLineWithCatalog> = {}): CartLineWithCatalog => ({
  cart_item_id: 'ci-1',
  variant_id: '22222222-2222-4222-8222-222222222222',
  product_id: P,
  product_type: 'physical',
  product_status: 'active',
  variant_status: 'active',
  title: 'Tee',
  variant_title: 'M',
  sku: 'TEE-M',
  unit_price_amount: 34900,
  currency: 'MXN',
  quantity: 2,
  collection_ids: [],
  requires_shipping: true,
  image_url: null,
  ...over,
});

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return isSellbaseError(err) ? err.code : 'NOT_SELLBASE';
  }
  return undefined;
}

describe('fulfillmentTypeFor', () => {
  it('maps product types', () => {
    expect(fulfillmentTypeFor('physical', true)).toBe('shipment');
    expect(fulfillmentTypeFor('physical', false)).toBe('none');
    expect(fulfillmentTypeFor('digital', true)).toBe('digital');
    expect(fulfillmentTypeFor('service', false)).toBe('booking');
  });
});

describe('planCheckout', () => {
  it('builds snapshot lines with discounts and fulfillment types', () => {
    const plan = planCheckout({
      currency: 'MXN',
      lines: [
        line(),
        line({
          cart_item_id: 'ci-2',
          product_type: 'digital',
          requires_shipping: false,
          unit_price_amount: 19900,
          quantity: 1,
          sku: 'EB',
        }),
      ],
      discounts: [{ id: 'd', kind: 'percent', value: 1000 }],
      shipping_amount: 9900,
    });
    expect(plan.requires_shipping).toBe(true);
    expect(plan.lines.map((l) => l.fulfillment_type)).toEqual(['shipment', 'digital']);
    expect(plan.lines.map((l) => l.discount_amount)).toEqual([6980, 1990]);
    expect(plan.totals.total_amount).toBe(69800 + 19900 - 8970 + 9900);
  });

  it('charges no shipping when nothing ships', () => {
    const plan = planCheckout({
      currency: 'MXN',
      lines: [line({ product_type: 'digital', requires_shipping: false })],
      shipping_amount: 9900,
    });
    expect(plan.requires_shipping).toBe(false);
    expect(plan.totals.shipping_amount).toBe(0);
  });

  it('rejects empty carts, unavailable items and mixed currencies with hints', () => {
    expect(codeOf(() => planCheckout({ currency: 'MXN', lines: [] }))).toBe('VALIDATION_ERROR');
    expect(
      codeOf(() =>
        planCheckout({ currency: 'MXN', lines: [line({ product_status: 'archived' })] }),
      ),
    ).toBe('NOT_FOUND');
    expect(
      codeOf(() => planCheckout({ currency: 'MXN', lines: [line({ variant_status: 'draft' })] })),
    ).toBe('NOT_FOUND');
    expect(
      codeOf(() => planCheckout({ currency: 'MXN', lines: [line({ currency: 'USD' })] })),
    ).toBe('CURRENCY_MISMATCH');
  });
});
