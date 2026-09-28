#!/usr/bin/env node
// Static acceptance: a plain HTML site (no package.json, no framework, like many landings
// made with AI) gets `sellbase init` and ends up with the web components, their config,
// the static admin and the agent files. Uses the running local stack and its store.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const supabaseBin = join(repo, 'node_modules/.bin/supabase');
const started = Date.now();
const say = (text) => console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s] ${text}`);
const sh = (cmd, args, cwd, quiet = true) =>
  String(execFileSync(cmd, args, { cwd, stdio: quiet ? 'pipe' : 'inherit' }) ?? '');

say('Building the web components, the static admin and the CLI…');
for (const pkg of ['@sellbase/web', '@sellbase/admin', 'sellbase'])
  sh('pnpm', ['--filter', pkg, 'build'], repo);

const site = await mkdtemp(join(tmpdir(), 'sellbase-static-'));
say(`Plain HTML site in ${site}`);
await writeFile(
  join(site, 'index.html'),
  '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Mi landing</title></head><body><h1>Mi landing</h1></body></html>\n',
);
sh(supabaseBin, ['init', '--force'], site);

const status = Object.fromEntries(
  sh(supabaseBin, ['status', '-o', 'env'], repo)
    .split('\n')
    .map((l) => /^([A-Z_]+)="?([^"]*)"?$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
say('npx sellbase init --yes (no framework)');
sh(
  'node',
  [
    join(repo, 'packages/cli/dist/cli.js'),
    'init',
    '--yes',
    '--skip-migrations',
    '--supabase-url',
    status.API_URL,
    '--anon-key',
    status.ANON_KEY,
    '--service-role-key',
    status.SERVICE_ROLE_KEY,
    '--db-url',
    status.DB_URL,
  ],
  site,
  false,
);

const check = (path, test = () => true, why = 'missing') => {
  const abs = join(site, path);
  if (!existsSync(abs) || !test(readFileSync(abs, 'utf8'))) throw new Error(`${path}: ${why}`);
};
check(
  'sellbase/sellbase.js',
  (t) => t.includes('sellbase-add-to-cart'),
  'not the web components bundle',
);
check(
  'sellbase/config.js',
  (t) => t.includes('/functions/v1/sellbase-api') && !/service_role|SERVICE_ROLE/.test(t),
  'bad config',
);
check('admin/index.html');
check('admin/admin.js');
check(
  'admin/config.js',
  (t) => t.includes('supabaseAnonKey') && !/service_role|SERVICE_ROLE/.test(t),
  'bad admin config',
);
check('.env.sellbase', (t) => t.includes('SELLBASE_API_TOKEN='));
check('.gitignore', (t) => t.includes('.env.sellbase'));
check('AGENTS.md', (t) => t.includes('sellbase:start'));
check(
  '.claude/skills/sellbase/add-storefront/SKILL.md',
  (t) => t.includes('<sellbase-add-to-cart'),
  'skill without web components',
);
check(
  '.sellbase/manifest.json',
  (t) => Object.keys(JSON.parse(t).files).includes('sellbase/sellbase.js'),
  'bundle not tracked for upgrades',
);
if (existsSync(join(site, 'package.json')) || existsSync(join(site, 'node_modules')))
  throw new Error('init must not turn a plain HTML site into an npm project');
sh('node', ['--check', join(site, 'sellbase/sellbase.js')], site);
say('Files ok: sellbase/ (bundle + config), admin/ (static admin + config), agent files, no npm');
say(`ACCEPTED (static) in ${((Date.now() - started) / 1000).toFixed(0)}s`);
