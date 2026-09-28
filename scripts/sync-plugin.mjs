#!/usr/bin/env node
/**
 * Keeps the Claude Code plugin (plugins/sellbase) in sync with the repo: copies skills/*
 * into plugins/sellbase/skills/ (add-ecommerce lives only in the plugin) and the package
 * version into plugin.json, .claude-plugin/marketplace.json and server.json.
 *   node scripts/sync-plugin.mjs          # write
 *   node scripts/sync-plugin.mjs --check  # CI: fail if anything is stale
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');
const version = JSON.parse(readFileSync(join(repo, 'packages/cli/package.json'), 'utf8')).version;
const stale = [];

function write(path, content) {
  const abs = join(repo, path);
  const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  if (current === content) return;
  stale.push(path);
  if (!check) {
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
}

// Plugin directories want the license inside the plugin folder.
write('plugins/sellbase/LICENSE', readFileSync(join(repo, 'LICENSE'), 'utf8'));

for (const skill of readdirSync(join(repo, 'skills'))) {
  const source = join(repo, 'skills', skill, 'SKILL.md');
  if (existsSync(source))
    write(`plugins/sellbase/skills/${skill}/SKILL.md`, readFileSync(source, 'utf8'));
}

const json = (path, update) => {
  const data = JSON.parse(readFileSync(join(repo, path), 'utf8'));
  update(data);
  write(path, `${JSON.stringify(data, null, 2)}\n`);
};
json('plugins/sellbase/.claude-plugin/plugin.json', (d) => (d.version = version));
json('.claude-plugin/marketplace.json', (d) => d.plugins.forEach((p) => (p.version = version)));
json('server.json', (d) => {
  d.version = version;
  d.packages.forEach((p) => (p.version = version));
});

if (check && stale.length) {
  console.error(`Stale plugin files: ${stale.join(', ')}. Run \`node scripts/sync-plugin.mjs\`.`);
  process.exit(1);
}
console.log(check ? 'Plugin files are up to date.' : `Synced ${stale.length} file(s).`);
