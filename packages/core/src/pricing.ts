import { z } from 'zod';
import { fromZodError, sellbaseError, type ErrorCode } from './errors.js';
import { allocate, mulDivRound, multiplyAmount, sumAmounts } from './money.js';
import { amount, bps, currency, id } from './schemas/common.js';
import { discountAppliesTo, discountKind, type DiscountAppliesTo } from './schemas/commerce.js';

/**
 * Server-side totals calculation (SPEC §8). The checkout always recomputes with this
 * function and never trusts totals coming from the browser.
 *
 * Rules (docs/decisions/0002-pricing.md):
 * - Discounts apply in the order received, each on what is left after the previous ones.
 *   Callers pass automatic discounts first, then the code the customer typed.
 * - A line discount is split across eligible lines proportionally (largest remainder),
 *   so `order_items.discount_amount` always adds up to the order discount.
 * - `min_subtotal_amount` is checked against the eligible lines' subtotal before discounts.
 * - Free shipping discounts the whole shipping amount; stacking several has no extra effect.
 * - Tax is either included in prices (MX IVA) or added on top; it is split across lines
 *   and shipping with the same largest-remainder method.
 */

export const pricingLineInput = z.object({
  id: z.string().min(1),
  unit_price_amount: amount,
  quantity: z.number().int().positive(),
  product_id: id.optional(),
  collection_ids: z.array(id).default([]),
});

export const pricingDiscountInput = z.object({
  id: z.string().min(1),
  code: z.string().nullable().default(null),
  kind: discountKind,
  value: z.number().int().nonnegative(),
  applies_to: discountAppliesTo.default({ type: 'all' }),
  min_subtotal_amount: amount.nullable().default(null),
});

export const pricingInput = z.object({
  currency,
  lines: z.array(pricingLineInput),
  discounts: z.array(pricingDiscountInput).default([]),
  shipping_amount: amount.default(0),
  tax: z
    .object({
      mode: z.enum(['inclusive', 'exclusive']),
      rate_bps: bps,
      applies_to_shipping: z.boolean().default(true),
    })
    .default({ mode: 'inclusive', rate_bps: 0, applies_to_shipping: true }),
});

export type PricingInput = z.input<typeof pricingInput>;

export interface PricedLine {
  id: string;
  unit_price_amount: number;
  quantity: number;
  subtotal_amount: number;
  discount_amount: number;
  total_amount: number;
  tax_amount: number;
}

export interface AppliedDiscount {
  id: string;
  code: string | null;
  kind: z.infer<typeof discountKind>;
  amount: number;
}

export interface RejectedDiscount {
  id: string;
  code: string | null;
  reason: Extract<ErrorCode, 'DISCOUNT_NOT_APPLICABLE' | 'DISCOUNT_MIN_SUBTOTAL_NOT_MET'>;
  hint: string;
}

export interface Totals {
  currency: string;
  lines: PricedLine[];
  subtotal_amount: number;
  line_discount_amount: number;
  shipping_amount: number;
  shipping_discount_amount: number;
  /** Line discounts + shipping discount. */
  discount_amount: number;
  tax_mode: 'inclusive' | 'exclusive';
  tax_amount: number;
  /** Tax attributed to shipping (already part of `tax_amount`). */
  shipping_tax_amount: number;
  /** subtotal − discount + shipping (+ tax when exclusive). */
  total_amount: number;
  applied_discounts: AppliedDiscount[];
  rejected_discounts: RejectedDiscount[];
}

type Line = z.infer<typeof pricingLineInput>;

function isEligible(line: Line, appliesTo: DiscountAppliesTo): boolean {
  switch (appliesTo.type) {
    case 'all':
      return true;
    case 'products':
      return line.product_id !== undefined && appliesTo.product_ids.includes(line.product_id);
    case 'collections':
      return line.collection_ids.some((c) => appliesTo.collection_ids.includes(c));
  }
}

export function calculateTotals(raw: PricingInput): Totals {
  const parsed = pricingInput.safeParse(raw);
  if (!parsed.success) throw fromZodError(parsed.error, 'pricing input');
  const input = parsed.data;

  const subtotals = input.lines.map((l, i) =>
    multiplyAmount(l.unit_price_amount, l.quantity, `lines[${i}].subtotal`),
  );
  const subtotal = sumAmounts(subtotals, 'subtotal_amount');
  const lineDiscounts = subtotals.map(() => 0);
  const applied: AppliedDiscount[] = [];
  const rejected: RejectedDiscount[] = [];
  let shippingDiscount = 0;

  for (const discount of input.discounts) {
    const eligible = input.lines
      .map((line, index) => ({ line, index }))
      .filter(
        ({ line }) => discount.kind === 'free_shipping' || isEligible(line, discount.applies_to),
      );
    const ref = { id: discount.id, code: discount.code };

    if (discount.kind !== 'free_shipping' && eligible.length === 0) {
      rejected.push({
        ...ref,
        reason: 'DISCOUNT_NOT_APPLICABLE',
        hint: 'None of the items in the cart qualify for this discount.',
      });
      continue;
    }

    const eligibleSubtotal = sumAmounts(eligible.map(({ index }) => subtotals[index] ?? 0));
    if (discount.min_subtotal_amount !== null && eligibleSubtotal < discount.min_subtotal_amount) {
      rejected.push({
        ...ref,
        reason: 'DISCOUNT_MIN_SUBTOTAL_NOT_MET',
        hint: `Add ${discount.min_subtotal_amount - eligibleSubtotal} more (minor units) of qualifying items to use this discount.`,
      });
      continue;
    }

    if (discount.kind === 'free_shipping') {
      const amountOff = input.shipping_amount - shippingDiscount;
      shippingDiscount += amountOff;
      applied.push({ ...ref, kind: discount.kind, amount: amountOff });
      continue;
    }

    const remaining = eligible.map(
      ({ index }) => (subtotals[index] ?? 0) - (lineDiscounts[index] ?? 0),
    );
    const base = sumAmounts(remaining);
    const amountOff =
      discount.kind === 'percent'
        ? mulDivRound(base, Math.min(discount.value, 10_000), 10_000)
        : Math.min(discount.value, base);
    allocate(amountOff, remaining).forEach((part, j) => {
      const index = eligible[j]?.index;
      if (index !== undefined) lineDiscounts[index] = (lineDiscounts[index] ?? 0) + part;
    });
    applied.push({ ...ref, kind: discount.kind, amount: amountOff });
  }

  const lineTotals = subtotals.map((s, i) => s - (lineDiscounts[i] ?? 0));
  const lineDiscountTotal = sumAmounts(lineDiscounts);
  const merchandiseNet = sumAmounts(lineTotals);
  const shippingNet = input.shipping_amount - shippingDiscount;

  const { mode, rate_bps, applies_to_shipping } = input.tax;
  const taxWeights = [...lineTotals, applies_to_shipping ? shippingNet : 0];
  const taxBase = sumAmounts(taxWeights);
  const tax =
    rate_bps === 0 || taxBase === 0
      ? 0
      : mode === 'inclusive'
        ? mulDivRound(taxBase, rate_bps, 10_000 + rate_bps)
        : mulDivRound(taxBase, rate_bps, 10_000);
  const taxParts = taxBase === 0 ? taxWeights.map(() => 0) : allocate(tax, taxWeights);

  const total = sumAmounts(
    [merchandiseNet, shippingNet, mode === 'exclusive' ? tax : 0],
    'total_amount',
  );
  if (total < 0) {
    throw sellbaseError('INTERNAL_ERROR', 'Computed a negative total.', 'Report this as a bug.', {
      subtotal,
    });
  }

  return {
    currency: input.currency,
    lines: input.lines.map((l, i) => ({
      id: l.id,
      unit_price_amount: l.unit_price_amount,
      quantity: l.quantity,
      subtotal_amount: subtotals[i] ?? 0,
      discount_amount: lineDiscounts[i] ?? 0,
      total_amount: lineTotals[i] ?? 0,
      tax_amount: taxParts[i] ?? 0,
    })),
    subtotal_amount: subtotal,
    line_discount_amount: lineDiscountTotal,
    shipping_amount: input.shipping_amount,
    shipping_discount_amount: shippingDiscount,
    discount_amount: lineDiscountTotal + shippingDiscount,
    tax_mode: mode,
    tax_amount: tax,
    shipping_tax_amount: taxParts[taxParts.length - 1] ?? 0,
    total_amount: total,
    applied_discounts: applied,
    rejected_discounts: rejected,
  };
}
