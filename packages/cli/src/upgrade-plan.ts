import { createTwoFilesPatch } from 'diff';
import type { TrackedFile } from './manifest.js';
import { sha256Hex } from './util.js';

/** Migrations newer than the database version, in order ("0007_webhooks.sql" → "0007"). */
export function pendingMigrations(current: string | null, available: readonly string[]): string[] {
  return available
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .filter((f) => current === null || f.slice(0, 4) > current)
    .sort();
}

export type FileAction =
  | { path: string; action: 'current' | 'missing' }
  | { path: string; action: 'update'; content: string }
  | { path: string; action: 'diff'; diff: string };

/**
 * What to do with a file Sellbase copied into the project:
 * - untouched by the owner: replace it with the new version (`update`), or nothing;
 * - edited by the owner: never overwrite; if upstream changed, hand over a diff of the
 *   upstream change (installed base → new) for the agent to merge (`diff`);
 * - deleted by the owner: leave it deleted (`missing`).
 */
export function planFile(input: {
  path: string;
  tracked: TrackedFile;
  current: string | null;
  base: string | null;
  upstream: string;
}): FileAction {
  const { path, tracked, current, base, upstream } = input;
  if (current === null) return { path, action: 'missing' };
  if (sha256Hex(current) === tracked.sha256) {
    return current === upstream
      ? { path, action: 'current' }
      : { path, action: 'update', content: upstream };
  }
  if (base !== null && base === upstream) return { path, action: 'current' };
  return {
    path,
    action: 'diff',
    diff: createTwoFilesPatch(
      `a/${path}`,
      `b/${path}`,
      base ?? '',
      upstream,
      'installed version',
      'new Sellbase version',
    ),
  };
}
