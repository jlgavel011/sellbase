import { describe, expect, it } from 'vitest';
import {
  allocate,
  currencyMinorDigits,
  formatMoney,
  isCurrencyCode,
  mulDivRound,
  percentOf,
  toMinorUnits,
} from '../src/index.js';

describe('currencies', () => {
  it('accepts ISO 4217 codes and rejects the rest', () => {
    expect(isCurrencyCode('MXN')).toBe(true);
    expect(isCurrencyCode('USD')).toBe(true);
    expect(isCurrencyCode('usd')).toBe(false);
    expect(isCurrencyCode('XYZ')).toBe(false);
  });

  it('knows minor digits', () => {
    expect(currencyMinorDigits('MXN')).toBe(2);
    expect(currencyMinorDigits('JPY')).toBe(0);
  });
});

describe('rounding', () => {
  it('rounds half-up', () => {
    expect(mulDivRound(5, 1, 2)).toBe(3);
    expect(mulDivRound(4, 1, 2)).toBe(2);
    expect(mulDivRound(1, 1, 3)).toBe(0);
    expect(mulDivRound(2, 1, 3)).toBe(1);
  });

  it('computes basis points without float error', () => {
    expect(percentOf(19990, 1600)).toBe(3198); // 3198.4
    expect(percentOf(9_000_000_000_000, 1600)).toBe(1_440_000_000_000);
  });
});

describe('allocate', () => {
  it('always sums to the total', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [3000, 1000])).toEqual([750, 250]);
    expect(allocate(7, [0, 5, 5])).toEqual([0, 4, 3]);
  });

  it('handles zeros', () => {
    expect(allocate(0, [])).toEqual([]);
    expect(allocate(0, [0, 0])).toEqual([0, 0]);
    expect(() => allocate(5, [0, 0])).toThrow();
  });
});

describe('toMinorUnits', () => {
  it('parses decimals exactly', () => {
    expect(toMinorUnits('199.90', 'MXN')).toBe(19990);
    expect(toMinorUnits('199.9', 'MXN')).toBe(19990);
    expect(toMinorUnits('0.01', 'MXN')).toBe(1);
    expect(toMinorUnits('1500', 'JPY')).toBe(1500);
  });

  it('rejects extra decimals and garbage', () => {
    expect(() => toMinorUnits('1.999', 'MXN')).toThrow(/not a valid MXN amount/);
    expect(() => toMinorUnits('1.5', 'JPY')).toThrow();
    expect(() => toMinorUnits('-1', 'MXN')).toThrow();
    expect(() => toMinorUnits('abc', 'MXN')).toThrow();
  });
});

describe('formatMoney', () => {
  it('formats minor units', () => {
    expect(formatMoney(19990, 'MXN', 'es-MX')).toBe('$199.90');
    expect(formatMoney(1500, 'JPY', 'en-US')).toBe('¥1,500');
    expect(formatMoney(-500, 'USD', 'en-US')).toBe('-$5.00');
  });
});
