import type { z } from 'zod';

/**
 * Every error Sellbase returns (API, MCP, SDK) carries a stable `code`, a readable
 * `message` and a `hint` with the next concrete action, so an agent can recover on its own.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_AMOUNT',
  'UNSUPPORTED_CURRENCY',
  'CURRENCY_MISMATCH',
  'INVALID_TRANSITION',
  'DISCOUNT_NOT_APPLICABLE',
  'DISCOUNT_MIN_SUBTOTAL_NOT_MET',
  'OUT_OF_STOCK',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'IDEMPOTENCY_CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorDetails = Record<string, unknown>;

export interface SellbaseErrorBody {
  code: ErrorCode;
  message: string;
  hint: string;
  details: ErrorDetails;
}

export type SellbaseError = Error & SellbaseErrorBody & { name: 'SellbaseError' };

export function sellbaseError(
  code: ErrorCode,
  message: string,
  hint: string,
  details: ErrorDetails = {},
): SellbaseError {
  return Object.assign(new Error(message), { name: 'SellbaseError' as const, code, hint, details });
}

export function isSellbaseError(value: unknown): value is SellbaseError {
  return value instanceof Error && value.name === 'SellbaseError' && 'code' in value;
}

/** Converts a Zod failure into a VALIDATION_ERROR that names every offending field. */
export function fromZodError(error: z.ZodError, context = 'input'): SellbaseError {
  const issues = error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
  }));
  const fields = issues.map((i) => i.path).join(', ');
  return sellbaseError(
    'VALIDATION_ERROR',
    `Invalid ${context}: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
    `Fix these fields and retry: ${fields}.`,
    { issues },
  );
}

/** Shape used by every HTTP error response: `{ "error": { code, message, hint, details } }`. */
export function toErrorResponse(error: unknown): { error: SellbaseErrorBody } {
  if (isSellbaseError(error)) {
    const { code, message, hint, details } = error;
    return { error: { code, message, hint, details } };
  }
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Unexpected error.',
      hint: 'Retry the request; if it keeps failing run `sellbase doctor` and check the function logs.',
      details: {},
    },
  };
}
