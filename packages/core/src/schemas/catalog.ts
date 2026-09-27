import { z } from 'zod';
import { amount, currency, id, metadata, slug, timestamp } from './common.js';

export const productType = z.enum(['physical', 'digital', 'service']);
export type ProductType = z.infer<typeof productType>;

export const productStatus = z.enum(['draft', 'active', 'archived']);
export type ProductStatus = z.infer<typeof productStatus>;

export const inventoryPolicy = z.enum(['deny', 'continue']);

export const physicalSpecs = z.object({
  weight_g: z.number().int().nonnegative(),
  length_cm: z.number().nonnegative(),
  width_cm: z.number().nonnegative(),
  height_cm: z.number().nonnegative(),
  requires_shipping: z.boolean().default(true),
  hs_code: z.string().max(20).nullable().default(null),
});

export const digitalAsset = z.object({
  storage_path: z.string().min(1),
  file_name: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  download_limit: z.number().int().positive().nullable().default(null),
  link_ttl_hours: z.number().int().positive().default(72),
  license_template: z.string().nullable().default(null),
});

export const serviceSpecs = z.object({
  duration_min: z.number().int().positive(),
  buffer_before_min: z.number().int().nonnegative().default(0),
  buffer_after_min: z.number().int().nonnegative().default(0),
  capacity: z.number().int().positive().default(1),
  deposit_amount: amount.nullable().default(null),
  location_type: z.enum(['in_person', 'online']),
  online_meeting_url: z.url().nullable().default(null),
  booking_window_days: z.number().int().positive().default(60),
  min_notice_min: z.number().int().nonnegative().default(60),
  slot_interval_min: z
    .number()
    .int()
    .min(5)
    .max(1440)
    .nullable()
    .default(null)
    .describe('Minutes between start times; defaults to the duration (max 60).'),
});

export const variant = z.object({
  id,
  product_id: id,
  sku: z.string().max(64).nullable(),
  title: z.string().min(1).max(200),
  option_values: z.record(z.string(), z.string()).default({}),
  price_amount: amount,
  compare_at_amount: amount.nullable(),
  currency,
  status: productStatus,
  position: z.number().int().nonnegative(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type Variant = z.infer<typeof variant>;

export const product = z.object({
  id,
  type: productType,
  title: z.string().min(1).max(200),
  slug,
  description: z.string().max(50_000).default(''),
  status: productStatus,
  seo: z
    .object({ title: z.string().max(70).optional(), description: z.string().max(160).optional() })
    .default({}),
  tags: z.array(z.string().max(50)).default([]),
  metadata,
  created_at: timestamp,
  updated_at: timestamp,
});
export type Product = z.infer<typeof product>;

/** Variant input for `product_upsert`: id present = update, absent = create. */
export const variantInput = z.object({
  id: id.optional(),
  sku: z.string().max(64).nullable().optional(),
  title: z.string().min(1).max(200).default('Default'),
  option_values: z.record(z.string(), z.string()).default({}),
  price_amount: amount,
  compare_at_amount: amount.nullable().optional(),
  inventory: z
    .object({ on_hand: z.number().int(), policy: inventoryPolicy.default('deny') })
    .optional(),
  physical: physicalSpecs.optional(),
  digital: digitalAsset.omit({ storage_path: true }).partial().optional(),
  service: serviceSpecs.optional(),
});

/**
 * One call creates or updates a full product of any type. Every product has at least one
 * variant; send a single variant titled "Default" when there are no options.
 */
export const productUpsertInput = z
  .object({
    id: id.optional(),
    type: productType,
    title: z.string().min(1).max(200),
    slug: slug.optional(),
    description: z.string().max(50_000).optional(),
    status: productStatus.default('draft'),
    tags: z.array(z.string().max(50)).optional(),
    currency: currency.optional(),
    options: z
      .array(
        z.object({ name: z.string().min(1).max(50), values: z.array(z.string().min(1)).min(1) }),
      )
      .max(3)
      .optional(),
    variants: z.array(variantInput).min(1),
    resource_ids: z
      .array(id)
      .optional()
      .describe('Services: who or what can deliver it (replaces the current assignment).'),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((p, ctx) => {
    p.variants.forEach((v, i) => {
      if (p.type === 'service' && !v.service) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants', i, 'service'],
          message: 'Service products need service specs (duration_min, location_type).',
        });
      }
      if (p.type !== 'service' && v.service) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants', i, 'service'],
          message: `Only service products accept service specs; this product is ${p.type}.`,
        });
      }
      if (p.type !== 'physical' && v.physical) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants', i, 'physical'],
          message: `Only physical products accept physical specs; this product is ${p.type}.`,
        });
      }
    });
  });
export type ProductUpsertInput = z.infer<typeof productUpsertInput>;

export const collection = z.object({
  id,
  title: z.string().min(1).max(200),
  slug,
  description: z.string().max(10_000).default(''),
  rule: z.record(z.string(), z.unknown()).nullable(),
  position: z.number().int().nonnegative(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type Collection = z.infer<typeof collection>;

export const collectionUpsertInput = z.object({
  id: id.optional().describe('Send to update; omit to create.'),
  title: z.string().min(1).max(200),
  slug: slug.optional().describe('Derived from the title when omitted.'),
  description: z.string().max(10_000).optional(),
  position: z.number().int().nonnegative().optional(),
  product_ids: z
    .array(id)
    .max(1000)
    .optional()
    .describe('Replaces the products in the collection, in this order. Omit to keep them.'),
});
export type CollectionUpsertInput = z.infer<typeof collectionUpsertInput>;
