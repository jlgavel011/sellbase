import { sellbaseError } from './errors.js';

/**
 * Money is always an integer amount of minor units (cents) plus an ISO 4217 code.
 * Amounts are JS numbers restricted to safe integers; intermediate products use BigInt
 * so multiplications never lose precision. See docs/decisions/0001-money.md.
 */

const BPS = 10_000n;

let currencyCache: Set<string> | undefined;

function supportedCurrencies(): Set<string> {
  currencyCache ??= new Set(Intl.supportedValuesOf('currency'));
  return currencyCache;
}

export function isCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && supportedCurrencies().has(code);
}

export function assertCurrency(code: string): void {
  if (!isCurrencyCode(code)) {
    throw sellbaseError(
      'UNSUPPORTED_CURRENCY',
      `"${code}" is not a supported ISO 4217 currency code.`,
      'Use an uppercase three-letter code such as MXN, USD or EUR.',
      { currency: code },
    );
  }
}

/** Number of decimal digits in the currency's minor unit (MXN → 2, JPY → 0). */
export function currencyMinorDigits(code: string): number {
  assertCurrency(code);
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

export function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function assertAmount(value: number, field: string): void {
  if (!isAmount(value)) {
    throw sellbaseError(
      'INVALID_AMOUNT',
      `${field} must be a non-negative integer in minor units (e.g. cents); got ${String(value)}.`,
      'Send money as integers of the smallest unit: $199.90 MXN is 19990.',
      { field, value },
    );
  }
}

function toSafeNumber(value: bigint, field: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n) {
    throw sellbaseError(
      'INVALID_AMOUNT',
      `${field} is out of range.`,
      'Check quantities and prices; the resulting amount exceeds the supported maximum.',
      { field },
    );
  }
  return Number(value);
}

/** Integer division rounding half away from zero, for non-negative operands. */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** `amount * numerator / denominator`, rounded half-up, without floating point. */
export function mulDivRound(amount: number, numerator: number, denominator: number): number {
  if (denominator <= 0) throw new RangeError('denominator must be positive');
  return toSafeNumber(
    divRoundHalfUp(BigInt(amount) * BigInt(numerator), BigInt(denominator)),
    'amount',
  );
}

/** Percentage of an amount expressed in basis points (1000 bps = 10%), rounded half-up. */
export function percentOf(amount: number, bps: number): number {
  return mulDivRound(amount, bps, Number(BPS));
}

export function multiplyAmount(amount: number, quantity: number, field = 'amount'): number {
  return toSafeNumber(BigInt(amount) * BigInt(quantity), field);
}

export function sumAmounts(amounts: readonly number[], field = 'amount'): number {
  return toSafeNumber(
    amounts.reduce((acc, a) => acc + BigInt(a), 0n),
    field,
  );
}

/**
 * Splits `total` across `weights` proportionally using the largest-remainder method.
 * The parts always sum exactly to `total`; ties go to the earlier index.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  assertAmount(total, 'total');
  weights.forEach((w, i) => assertAmount(w, `weights[${i}]`));
  if (weights.length === 0) {
    if (total === 0) return [];
    throw new RangeError('cannot allocate a non-zero total across zero weights');
  }
  const weightSum = weights.reduce((acc, w) => acc + BigInt(w), 0n);
  if (weightSum === 0n) {
    if (total === 0) return weights.map(() => 0);
    throw new RangeError('cannot allocate a non-zero total when all weights are zero');
  }
  const big = BigInt(total);
  const parts = weights.map((w) => {
    const product = big * BigInt(w);
    return { floor: product / weightSum, remainder: product % weightSum };
  });
  let leftover = big - parts.reduce((acc, p) => acc + p.floor, 0n);
  const order = parts
    .map((p, index) => ({ index, remainder: p.remainder }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  const result = parts.map((p) => p.floor);
  for (const { index } of order) {
    if (leftover === 0n) break;
    result[index] = (result[index] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return result.map((r) => Number(r));
}

/**
 * Parses a decimal string ("199.90") into minor units (19990) without floating point.
 * Rejects more decimals than the currency allows instead of silently rounding.
 */
export function toMinorUnits(decimal: string, currency: string): number {
  const digits = currencyMinorDigits(currency);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  const [, whole = '', fraction = ''] = match ?? [];
  if (!match || fraction.length > digits) {
    throw sellbaseError(
      'INVALID_AMOUNT',
      `"${decimal}" is not a valid ${currency} amount.`,
      `Use a non-negative number with at most ${digits} decimals, e.g. "${digits ? '199.' + '9'.padEnd(digits, '0') : '199'}".`,
      { value: decimal, currency },
    );
  }
  return toSafeNumber(BigInt(whole + fraction.padEnd(digits, '0')), 'amount');
}

export function formatMoney(amount: number, currency: string, locale = 'es-MX'): string {
  const digits = currencyMinorDigits(currency);
  const sign = amount < 0 ? '-' : '';
  const abs = BigInt(Math.abs(amount));
  const scale = 10n ** BigInt(digits);
  const decimal = digits
    ? `${abs / scale}.${(abs % scale).toString().padStart(digits, '0')}`
    : `${abs}`;
  // Intl accepts decimal strings, which keeps large values exact.
  const formatted = new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    decimal as `${number}`,
  );
  return sign ? `${sign}${formatted}` : formatted;
}
