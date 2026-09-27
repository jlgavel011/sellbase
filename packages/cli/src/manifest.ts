import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sha256Hex } from './util.js';

/**
 * `.sellbase/manifest.json`: what Sellbase installed in the project and the hash of each
 * copied file at install time. `sellbase upgrade` uses it to update only the files the
 * owner has not edited and to know which migrations are Sellbase's.
 */
export interface Manifest {
  version: string;
  migrations: string[];
  functions: string[];
  /** Project-relative path → sha256 of the content Sellbase wrote. */
  files: Record<string, string>;
}

export const MANIFEST_PATH = '.sellbase/manifest.json';

export async function readManifest(cwd: string): Promise<Manifest> {
  const path = join(cwd, MANIFEST_PATH);
  if (!existsSync(path)) return { version: '0.0.0', migrations: [], functions: [], files: {} };
  return JSON.parse(await readFile(path, 'utf8')) as Manifest;
}

export async function writeManifest(cwd: string, manifest: Manifest) {
  const path = join(cwd, MANIFEST_PATH);
  await mkdir(dirname(path), { recursive: true });
  const sorted = Object.fromEntries(
    Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(path, `${JSON.stringify({ ...manifest, files: sorted }, null, 2)}\n`);
}

export async function hashFile(path: string) {
  return sha256Hex(await readFile(path, 'utf8'));
}

/** Records files Sellbase just wrote (paths relative to `cwd`). */
export async function trackFiles(cwd: string, paths: string[]) {
  if (paths.length === 0) return;
  const manifest = await readManifest(cwd);
  for (const p of paths) manifest.files[p] = await hashFile(join(cwd, p));
  await writeManifest(cwd, manifest);
}
