/**
 * Single source of the product name (SPEC §19.1). Code reads names from here; the
 * remaining literal occurrences (npm scope `@sellbase/*`, Postgres schema `sellbase`
 * in SQL, env var prefixes) are renamed with a repo-wide search-and-replace.
 */
export const BRAND = {
  name: 'Sellbase',
  slug: 'sellbase',
  npmScope: '@sellbase',
  dbSchema: 'sellbase',
  envPrefix: 'SELLBASE_',
  /** Agent/API tokens look like `sb_live_…`; only the hash is stored. */
  tokenPrefix: 'sb_live_',
  cli: 'sellbase',
} as const;
