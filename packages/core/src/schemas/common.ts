import { z } from 'zod';
import { isCurrencyCode } from '../money.js';

export const id = z.uuid();

export const timestamp = z.iso.datetime({ offset: true });

export const currency = z
  .string()
  .refine(isCurrencyCode, { message: 'Must be an uppercase ISO 4217 code such as MXN or USD' })
  .describe('ISO 4217 currency code, uppercase (MXN, USD).');

/** Non-negative integer in minor units (cents). $199.90 MXN → 19990. */
export const amount = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .describe('Integer amount in minor units (cents). $199.90 → 19990. Never a decimal.');

/** Basis points: 10000 = 100%, 1600 = 16%. */
export const bps = z.number().int().nonnegative().max(100_000);

export const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, numbers and single hyphens only');

export const countryCode = z
  .string()
  .regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2 country code, uppercase (MX, US)');

export const locale = z
  .string()
  .regex(/^[a-z]{2}(?:-[A-Z]{2})?$/, 'Locale such as es, en or es-MX');

export const metadata = z
  .record(z.string(), z.unknown())
  .default({})
  .describe('Free-form JSON to extend any entity. Never alter Sellbase tables; use this instead.');

export const email = z.email().transform((v) => v.toLowerCase());

export const address = z.object({
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  company: z.string().max(200).optional(),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(120),
  state: z.string().max(120).optional(),
  postal_code: z.string().min(1).max(20),
  country: countryCode,
  phone: z.string().max(30).optional(),
});
export type Address = z.infer<typeof address>;

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
