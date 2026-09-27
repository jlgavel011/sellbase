import { sellbaseError } from '@sellbase/core';

/** Opaque keyset cursor over (timestamp, id). */
export function encodeCursor(at: Date, id: string): string {
  return btoa(`${at.toISOString()}|${id}`).replace(/=+$/, '');
}

export function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [iso, id] = atob(cursor).split('|');
    const at = new Date(iso ?? '');
    if (!id || Number.isNaN(at.getTime())) throw new Error('bad cursor');
    return { at, id };
  } catch {
    throw sellbaseError(
      'VALIDATION_ERROR',
      'Invalid cursor.',
      'Pass the next_cursor value from the previous page unchanged.',
    );
  }
}
