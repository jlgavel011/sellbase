// Copies registry components into the playground the same way `sellbase add` will copy
// them into a user's project. The copies are generated; edit packages/registry instead.
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, '../../../packages/registry/components/sellbase');
const to = resolve(here, '../components/sellbase');
await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });
