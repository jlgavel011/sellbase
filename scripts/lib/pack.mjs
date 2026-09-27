// Builds the publishable Sellbase packages and packs them as npm would ship them.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PUBLISHABLE = ['core', 'sdk', 'react', 'admin', 'mcp', 'cli'];

export async function packSellbase(repo) {
  const run = (args, cwd) => execFileSync('pnpm', args, { cwd, stdio: 'pipe' });
  const packs = await mkdtemp(join(tmpdir(), 'sellbase-packs-'));
  run(['--filter', '@sellbase/api', 'build'], repo);
  for (const name of PUBLISHABLE) {
    run(['--filter', name === 'cli' ? 'sellbase' : `@sellbase/${name}`, 'build'], repo);
    run(['pack', '--pack-destination', packs], join(repo, 'packages', name));
  }
  const tarball = (prefix) =>
    join(
      packs,
      readdirSync(packs).find((f) => f.startsWith(prefix)),
    );
  /** pnpm overrides so unpublished packages resolve to the local tarballs. */
  const overrides = Object.fromEntries(
    PUBLISHABLE.filter((n) => n !== 'cli').map((n) => [`@sellbase/${n}`, tarball(`sellbase-${n}`)]),
  );
  return { packs, tarball, overrides };
}
