import { amount, type ShippingAdapter, type ShippingRate } from '@sellbase/core';
import { z } from 'zod';

/**
 * Manual shipping (SPEC §9): a flat rate, free over an amount, and optional pickup.
 * Configured in `stores.settings.shipping`.
 */
export const manualShippingConfig = z.object({
  flat_rate_amount: amount.default(0),
  free_over_amount: amount.nullable().default(null),
  label: z.string().default('Envío estándar'),
  estimated_days: z.object({ min: z.number().int(), max: z.number().int() }).optional(),
  pickup: z
    .object({ enabled: z.boolean().default(false), label: z.string().default('Recoger en tienda') })
    .default({ enabled: false, label: 'Recoger en tienda' }),
});
export type ManualShippingConfig = z.input<typeof manualShippingConfig>;

export function manualShipping(raw: unknown = {}): ShippingAdapter {
  const config = manualShippingConfig.parse(raw ?? {});
  return {
    id: 'manual',
    async quote({ currency, subtotal_amount }) {
      const free = config.free_over_amount !== null && subtotal_amount >= config.free_over_amount;
      const rates: ShippingRate[] = [
        {
          id: free ? 'manual:free' : 'manual:flat',
          carrier: 'manual',
          service: free ? `${config.label} (gratis)` : config.label,
          amount: free ? 0 : config.flat_rate_amount,
          currency,
          requires_address: true,
          ...(config.estimated_days ? { estimated_days: config.estimated_days } : {}),
        },
      ];
      if (config.pickup.enabled) {
        rates.push({
          id: 'manual:pickup',
          carrier: 'manual',
          service: config.pickup.label,
          amount: 0,
          currency,
          requires_address: false,
        });
      }
      return rates;
    },
  };
}
