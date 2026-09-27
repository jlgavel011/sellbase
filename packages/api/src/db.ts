import postgres, { type Sql } from 'postgres';

/**
 * Postgres client for the API. `bigint` columns (money) come back as JS numbers, checked
 * to be safe integers so an out-of-range value fails loudly instead of losing cents.
 */
export function createSql(url: string, options: { max?: number; host?: string } = {}): Sql {
  return postgres(url, {
    ...(options.host ? { host: options.host } : {}),
    max: options.max ?? 5,
    prepare: false, // compatible with Supavisor transaction pooling
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number) => String(value),
        parse: (value: string) => {
          const n = Number(value);
          if (!Number.isSafeInteger(n))
            throw new RangeError(`bigint ${value} exceeds the safe integer range`);
          return n;
        },
      },
    },
  });
}
