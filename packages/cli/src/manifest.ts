import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sha256Hex } from './util.js';

/**
 * `.sellbase/manifest.json`: what Sellbase installed in the project. For each copied
 * file it keeps the source in the package and the hash of what was written, and
 * `.sellbase/base/<path>` keeps that content. `sellbase upgrade` updates files the owner
 * did not edit and, for edited ones, writes the upstream change (base → new) as a diff.
 */
export interface TrackedFile {
  /** Path inside the package assets, e.g. registry/components/sellbase/checkout.tsx. */
  source: string;
  sha256: string;
}

export interface Manifest {
  version: string;
  migrations: string[];
  functions: string[];
  files: Record<string, TrackedFile>;
}

export const MANIFEST_PATH = '.sellbase/manifest.json';
export const BASE_DIR = '.sellbase/base';

export async function readManifest(cwd: string): Promise<Manifest> {
  const path = join(cwd, MANIFEST_PATH);
  if (!existsSync(path)) return { version: '0.0.0', migrations: [], functions: [], files: {} };
  return JSON.parse(await readFile(path, 'utf8')) as Manifest;
}

export async function writeManifest(cwd: string, manifest: Manifest) {
  const path = join(cwd, MANIFEST_PATH);
  await mkdir(dirname(path), { recursive: true });
  const files = Object.fromEntries(
    Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(path, `${JSON.stringify({ ...manifest, files }, null, 2)}\n`);
}

/** Records files Sellbase just wrote: `[project path, asset source]`. */
export async function trackFiles(cwd: string, entries: [path: string, source: string][]) {
  if (entries.length === 0) return;
  const manifest = await readManifest(cwd);
  for (const [path, source] of entries) {
    const content = await readFile(join(cwd, path), 'utf8');
    manifest.files[path] = { source, sha256: sha256Hex(content) };
    const base = join(cwd, BASE_DIR, path);
    await mkdir(dirname(base), { recursive: true });
    await writeFile(base, content);
  }
  await writeManifest(cwd, manifest);
}
