// Collects everything `sellbase init` installs into a user's project: migrations, Edge
// Function bundles, storefront components, skills and templates.
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const assets = resolve(here, '../assets');

const copies = [
  ['supabase/migrations', 'migrations'],
  ['supabase/functions/sellbase-api', 'functions/sellbase-api'],
  ['supabase/functions/sellbase-webhooks', 'functions/sellbase-webhooks'],
  ['supabase/functions/sellbase-jobs', 'functions/sellbase-jobs'],
  ['packages/registry/components', 'registry/components'],
  ['packages/registry/registry.json', 'registry/registry.json'],
  ['skills', 'skills'],
  ['templates', 'templates'],
  ['docs/llms.txt', 'docs/llms.txt'],
  ['docs/llms-full.txt', 'docs/llms-full.txt'],
  ['CHANGELOG.md', 'CHANGELOG.md'],
  // Sites without React: the web components bundle and the static admin.
  ['packages/web/dist/sellbase.js', 'web/sellbase.js'],
  ['packages/admin/dist/standalone', 'admin-standalone'],
];

await rm(assets, { recursive: true, force: true });
for (const [from, to] of copies) {
  const src = resolve(root, from);
  if (!existsSync(src)) throw new Error(`Missing ${from}. Build the packages first (pnpm build).`);
  await mkdir(dirname(resolve(assets, to)), { recursive: true });
  await cp(src, resolve(assets, to), { recursive: true });
}
console.log('assets copied');
