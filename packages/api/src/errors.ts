import {
  ERROR_CODES,
  isSellbaseError,
  sellbaseError,
  type ErrorCode,
  type SellbaseError,
} from '@sellbase/core';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INVALID_AMOUNT: 400,
  UNSUPPORTED_CURRENCY: 400,
  CURRENCY_MISMATCH: 409,
  INVALID_TRANSITION: 409,
  DISCOUNT_NOT_APPLICABLE: 422,
  DISCOUNT_MIN_SUBTOTAL_NOT_MET: 422,
  OUT_OF_STOCK: 409,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export const statusFor = (code: ErrorCode): number => STATUS[code];

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);

interface PgError {
  code?: string;
  message?: string;
  hint?: string;
  detail?: string;
  constraint_name?: string;
}

/**
 * Maps database errors to SellbaseErrors. `sellbase.raise_error` puts the code in DETAIL
 * as JSON; constraint violations get a readable message instead of leaking SQL.
 */
export function fromDbError(error: unknown): SellbaseError | null {
  if (isSellbaseError(error)) return error;
  const pg = error as PgError;
  if (pg?.code === 'P0001' && pg.detail) {
    try {
      const { code, ...details } = JSON.parse(pg.detail) as { code?: unknown };
      if (isErrorCode(code)) return sellbaseError(code, pg.message ?? code, pg.hint ?? '', details);
    } catch {
      // not ours
    }
  }
  if (pg?.code === '23505') {
    return sellbaseError(
      'VALIDATION_ERROR',
      `A record with the same unique value already exists (${pg.constraint_name ?? 'unique'}).`,
      'Use a different slug, SKU or code, or update the existing record instead.',
      { constraint: pg.constraint_name },
    );
  }
  if (pg?.code === '23514' && pg.constraint_name === 'inventory_deny_not_negative') {
    return sellbaseError(
      'OUT_OF_STOCK',
      'Stock cannot go below zero or below the units reserved by open checkouts.',
      'Use a smaller adjustment or switch the variant to policy "continue" to allow backorders.',
    );
  }
  return null;
}

export const notFound = (entity: string, id: string, hint: string) =>
  sellbaseError('NOT_FOUND', `${entity} ${id} not found.`, hint, { entity, id });
