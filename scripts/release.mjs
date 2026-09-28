#!/usr/bin/env node
/**
 * Lockstep release: every @sellbase/* package and the `sellbase` CLI share one version.
 *
 *   node scripts/release.mjs 0.4.0   # bumps package.json files and the CLI VERSION
 *   git commit -am "Release 0.4.0" && git tag v0.4.0 && git push --follow-tags
 *
 * Pushing the tag runs .github/workflows/release.yml, which builds, tests and publishes
 * the public packages to npm (needs the NPM_TOKEN secret) and creates a GitHub release.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? '')) {
  console.error('Usage: node scripts/release.mjs <semver>, e.g. 0.4.0');
  process.exit(1);
}
const repo = resolve(import.meta.dirname, '..');
for (const dir of readdirSync(join(repo, 'packages'))) {
  const path = join(repo, 'packages', dir, 'package.json');
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${pkg.name}@${version}${pkg.private ? ' (private, not published)' : ''}`);
}
const versionFile = join(repo, 'packages/cli/src/version.ts');
writeFileSync(
  versionFile,
  readFileSync(versionFile, 'utf8').replace(/VERSION = '[^']+'/, `VERSION = '${version}'`),
);
execFileSync('node', [join(repo, 'scripts/sync-plugin.mjs')], { stdio: 'inherit' });
console.log(`\nNext: update CHANGELOG.md, then commit, tag v${version} and push --follow-tags.`);
