import { z } from 'zod';
import { bps, countryCode, currency, email, id, locale, slug, timestamp } from './common.js';

export const staffRole = z.enum(['owner', 'admin', 'staff']);
export type StaffRole = z.infer<typeof staffRole>;

export const apiScope = z.enum([
  'catalog:read',
  'catalog:write',
  'orders:read',
  'orders:write',
  'refunds:write',
  'customers:read',
  'discounts:write',
  'settings:write',
  'integrations:write',
]);
export type ApiScope = z.infer<typeof apiScope>;

/** Agent tokens never get `refunds:write` unless the owner grants it explicitly. */
export const DEFAULT_AGENT_SCOPES: readonly ApiScope[] = apiScope.options.filter(
  (s) => s !== 'refunds:write',
);

export const taxSettings = z.object({
  mode: z.enum(['inclusive', 'exclusive']).default('inclusive'),
  rate_bps: bps.default(0),
  applies_to_shipping: z.boolean().default(true),
});
export type TaxSettings = z.infer<typeof taxSettings>;

export const storeSettings = z
  .object({
    tax: taxSettings.default({ mode: 'inclusive', rate_bps: 0, applies_to_shipping: true }),
    auto_label: z.boolean().default(false),
    brand_color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  })
  .loose();

export const store = z.object({
  id,
  name: z.string().min(1).max(120),
  slug,
  default_currency: currency,
  default_locale: locale,
  timezone: z.string().min(1),
  country: countryCode,
  contact_email: email.nullable(),
  logo_url: z.url().nullable(),
  settings: storeSettings,
  platform_fee_bps: bps,
  created_at: timestamp,
  updated_at: timestamp,
});
export type Store = z.infer<typeof store>;

/** Partial settings for PATCH: no defaults, so omitted keys are left untouched. */
export const storeSettingsPatch = z
  .object({
    tax: z
      .object({
        mode: z.enum(['inclusive', 'exclusive']),
        rate_bps: bps,
        applies_to_shipping: z.boolean(),
      })
      .partial(),
    auto_label: z.boolean(),
    brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    shipping: z.record(z.string(), z.unknown()),
  })
  .partial()
  .loose();

export const storeUpdateInput = store
  .pick({
    name: true,
    default_currency: true,
    default_locale: true,
    timezone: true,
    country: true,
    contact_email: true,
    logo_url: true,
  })
  .partial()
  .extend({ settings: storeSettingsPatch.optional() });
export type StoreUpdateInput = z.infer<typeof storeUpdateInput>;

export const auditActorType = z.enum(['staff', 'token', 'system', 'webhook']);

/** Events a webhook endpoint can subscribe to (the outbox event types). */
export const WEBHOOK_EVENTS = [
  'order.created',
  'order.paid',
  'order.deposit_paid',
  'order.cancelled',
  'payment.succeeded',
  'refund.created',
  'fulfillment.shipped',
  'booking.rescheduled',
  'booking.cancelled',
  'product.created',
  'product.updated',
  'product.archived',
  'inventory.oversold',
] as const;
export const webhookEvent = z.enum(WEBHOOK_EVENTS);
export type WebhookEvent = z.infer<typeof webhookEvent>;
