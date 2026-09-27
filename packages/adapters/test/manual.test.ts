import { describe, expect, it } from 'vitest';
import { manualShipping } from '../src/index.js';

const quote = (config: unknown, subtotal_amount: number) =>
  manualShipping(config).quote({
    from: null,
    to: null,
    parcels: [],
    currency: 'MXN',
    subtotal_amount,
  });

describe('manual shipping', () => {
  it('charges the flat rate', async () => {
    expect((await quote({ flat_rate_amount: 9900 }, 50000)).map((r) => [r.id, r.amount])).toEqual([
      ['manual:flat', 9900],
    ]);
  });

  it('is free over the threshold', async () => {
    expect(
      (await quote({ flat_rate_amount: 9900, free_over_amount: 99900 }, 99900))[0],
    ).toMatchObject({ id: 'manual:free', amount: 0 });
  });

  it('offers pickup without an address', async () => {
    const rates = await quote({ flat_rate_amount: 9900, pickup: { enabled: true } }, 100);
    expect(rates.at(-1)).toMatchObject({ id: 'manual:pickup', amount: 0, requires_address: false });
  });

  it('defaults to free standard shipping when unconfigured', async () => {
    expect((await quote({}, 100))[0]?.amount).toBe(0);
  });
});
