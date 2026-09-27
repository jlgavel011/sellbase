import { existsSync } from 'node:fs';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { trackFiles } from './manifest.js';
import { assetsDir, cliError, log } from './util.js';

interface RegistryItem {
  name: string;
  description: string;
  files: string[];
  registryDependencies: string[];
}

/**
 * Copies storefront components into the project (shadcn style). Existing files are kept,
 * so the user's edits are never overwritten; pass `overwrite` to replace them.
 */
export async function addComponents(
  cwd: string,
  names: string[],
  options: { overwrite?: boolean; quiet?: boolean; base?: string } = {},
) {
  const registry = JSON.parse(
    await readFile(join(assetsDir, 'registry/registry.json'), 'utf8'),
  ) as { components: RegistryItem[] };
  const byName = new Map(registry.components.map((c) => [c.name, c]));
  const unknown = names.filter((n) => !byName.has(n));
  if (unknown.length) {
    throw cliError(
      `Unknown component(s): ${unknown.join(', ')}.`,
      `Available: ${[...byName.keys()].join(', ')}.`,
    );
  }

  const wanted = new Set<string>();
  const visit = (name: string) => {
    if (wanted.has(name)) return;
    wanted.add(name);
    byName.get(name)?.registryDependencies.forEach(visit);
  };
  names.forEach(visit);

  const written: string[] = [];
  const tracked: [string, string][] = [];
  const kept: string[] = [];
  for (const name of wanted) {
    for (const source of byName.get(name)?.files ?? []) {
      const file = `${options.base ?? ''}${source}`;
      const target = join(cwd, file);
      if (existsSync(target) && !options.overwrite) {
        kept.push(file);
        continue;
      }
      await mkdir(dirname(target), { recursive: true });
      await cp(join(assetsDir, 'registry', source), target);
      written.push(file);
      tracked.push([file, `registry/${source}`]);
    }
  }
  await trackFiles(cwd, tracked);
  if (!options.quiet) {
    written.forEach((f) => log.step(`Added ${f}`));
    kept.forEach((f) => log.info(`Kept your version of ${f} (use --overwrite to replace)`));
  }
  return { written, kept };
}
