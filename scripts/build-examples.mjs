// Copies the storefront components and init templates into examples/nextjs-store, so the
// example matches what `sellbase init` installs. `--check` fails when a copy is stale (CI).
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const example = join(root, 'examples/nextjs-store');
const registry = join(root, 'packages/registry/components/sellbase');

const copies = [
  ...(await readdir(registry)).map((f) => [
    join(registry, f),
    join(example, 'components/sellbase', f),
  ]),
  [join(root, 'templates/provider.tsx'), join(example, 'components/sellbase/provider.tsx')],
  [join(root, 'templates/admin-page.tsx'), join(example, 'app/admin/[[...path]]/page.tsx')],
];

const stale = [];
for (const [from, to] of copies) {
  const content = await readFile(from, 'utf8');
  const current = existsSync(to) ? await readFile(to, 'utf8') : null;
  if (current === content) continue;
  if (check) {
    stale.push(to.slice(root.length + 1));
    continue;
  }
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, content);
}
if (stale.length) {
  console.error(`Stale example files (run pnpm examples:sync):\n  ${stale.join('\n  ')}`);
  process.exit(1);
}
console.log(check ? 'examples up to date' : 'examples synced');
