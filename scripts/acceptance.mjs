#!/usr/bin/env node
/**
 * Phase 1 acceptance (SPEC §15): in a clean Next.js project, `sellbase init --yes` plus an
 * agent session over MCP ends in a successful test purchase (order + email + download)
 * in under 10 minutes.
 *
 * The "agent" is a scripted MCP client speaking stdio to `npx sellbase mcp`, exactly the
 * server Claude Code or Cursor would launch. Real LLM runs live in evals/ (Phase 2).
 *
 * Requires: Docker, the local Supabase stack of this repo (project_id "sellbase"),
 * STRIPE_SECRET_KEY (test) and STRIPE_WEBHOOK_SECRET in the environment or ./.env.
 * It resets the local database and restarts the stack from the temp project, then
 * restarts it from this repo at the end.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const supabaseBin = join(repo, 'node_modules/.bin/supabase');
const env = { ...Object.fromEntries(readEnv(join(repo, '.env'))), ...process.env };
const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`;
const say = (text) => console.log(`[${elapsed()}] ${text}`);
const sh = (cmd, args, cwd, opts = {}) =>
  execFileSync(cmd, args, {
    cwd,
    stdio: opts.quiet ? 'pipe' : 'inherit',
    env: { ...process.env, ...opts.env },
  });

function readEnv(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]);
}

if (!env.STRIPE_SECRET_KEY?.startsWith('sk_test_') || !env.STRIPE_WEBHOOK_SECRET) {
  console.error('Set STRIPE_SECRET_KEY (sk_test_…) and STRIPE_WEBHOOK_SECRET.');
  process.exit(1);
}

// 1. Package tarballs, as they would come from npm.
const packs = await mkdtemp(join(tmpdir(), 'sellbase-packs-'));
const publishable = ['core', 'sdk', 'react', 'admin', 'mcp', 'cli'];
say('Building and packing Sellbase packages…');
sh('pnpm', ['--filter', '@sellbase/api', 'build'], repo, { quiet: true });
for (const name of publishable) {
  const filter = name === 'cli' ? 'sellbase' : `@sellbase/${name}`;
  sh('pnpm', ['--filter', filter, 'build'], repo, { quiet: true });
  sh('pnpm', ['pack', '--pack-destination', packs], join(repo, 'packages', name), { quiet: true });
}
const tarball = (prefix) =>
  join(
    packs,
    readdirSync(packs).find((f) => f.startsWith(prefix)),
  );

// 2. A clean Next.js project with its own supabase/ folder.
const app = await mkdtemp(join(tmpdir(), 'sellbase-accept-'));
say(`Clean Next.js project in ${app}`);
await mkdir(join(app, 'app'), { recursive: true });
await writeFile(
  join(app, 'package.json'),
  JSON.stringify(
    {
      name: 'accept-store',
      private: true,
      scripts: { build: 'next build' },
      dependencies: { next: '^16.3.6', react: '^19.3.0', 'react-dom': '^19.3.0' },
      devDependencies: {
        typescript: '~6.0.3',
        '@types/react': '^19.3.0',
        '@types/node': '^24.0.0',
      },
      // Unpublished packages resolve to the local tarballs.
      pnpm: {
        overrides: {
          '@sellbase/core': tarball('sellbase-core'),
          '@sellbase/sdk': tarball('sellbase-sdk'),
          '@sellbase/mcp': tarball('sellbase-mcp'),
          '@sellbase/react': tarball('sellbase-react'),
          '@sellbase/admin': tarball('sellbase-admin'),
        },
      },
    },
    null,
    2,
  ),
);
await writeFile(
  join(app, 'app/layout.tsx'),
  `export default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html lang="es"><body>{children}</body></html>;\n}\n`,
);
await writeFile(
  join(app, 'app/page.tsx'),
  `export default function Home() {\n  return <h1>Mi landing hecha con IA</h1>;\n}\n`,
);
await writeFile(
  join(app, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['dom', 'dom.iterable', 'esnext'],
        strict: true,
        noEmit: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        skipLibCheck: true,
        esModuleInterop: true,
        isolatedModules: true,
        plugins: [{ name: 'next' }],
      },
      include: ['**/*.ts', '**/*.tsx'],
    },
    null,
    2,
  ),
);
sh('pnpm', ['install'], app, { quiet: true });
sh(supabaseBin, ['init', '--force'], app, { quiet: true });
let toml = await readFile(join(app, 'supabase/config.toml'), 'utf8');
toml = toml
  .replace(/^project_id = .*$/m, 'project_id = "sellbase"')
  .replace(/(\[analytics\]\s*\nenabled = )true/, '$1false')
  .replace(/(\[realtime\]\s*\nenabled = )true/, '$1false');
await writeFile(join(app, 'supabase/config.toml'), toml);

// 3. "Existing Supabase": the running local stack, with an empty database.
say('Resetting the local database (clean install)…');
sh(supabaseBin, ['db', 'reset', '--no-seed'], app, { quiet: true });

try {
  // 4. sellbase init --yes
  say('npx sellbase init --yes');
  sh(
    'node',
    [
      join(repo, 'packages/cli/dist/cli.js'),
      'init',
      '--yes',
      '--store-name',
      'Tienda Aceptación',
      '--owner-email',
      'owner@example.com',
      '--supabase-cli',
      supabaseBin,
      '--packages-from',
      packs,
    ],
    app,
  );

  // 4b. Files for the agent (SPEC §13.3), and a second init leaves them tidy.
  sh(
    'node',
    [
      join(repo, 'packages/cli/dist/cli.js'),
      'init',
      '--yes',
      '--supabase-cli',
      supabaseBin,
      '--skip-migrations',
      '--skip-install',
    ],
    app,
    { quiet: true },
  );
  const expectFile = (path, test = () => true, why = 'missing') => {
    const abs = join(app, path);
    if (!existsSync(abs) || !test(readFileSync(abs, 'utf8'))) throw new Error(`${path}: ${why}`);
  };
  const oneSection = (text) => text.split('<!-- sellbase:start').length === 2;
  expectFile('CLAUDE.md', oneSection, 'expected exactly one Sellbase section');
  expectFile('AGENTS.md', oneSection, 'expected exactly one Sellbase section');
  expectFile('.cursor/rules/sellbase.mdc');
  expectFile('.cursor/mcp.json', (t) => Boolean(JSON.parse(t).mcpServers?.sellbase));
  const skills = readdirSync(join(app, '.claude/skills/sellbase'));
  for (const skill of [
    'setup-store',
    'add-storefront',
    'manage-catalog',
    'operate-orders',
    'configure-payments',
    'configure-shipping',
    'services-and-bookings',
    'upgrade',
  ])
    if (!skills.includes(skill)) throw new Error(`skill ${skill} was not installed`);
  expectFile(
    '.sellbase/manifest.json',
    (t) => {
      const m = JSON.parse(t);
      return (
        m.migrations.includes('0000_foundation.sql') &&
        Object.keys(m.files).some((f) => f.startsWith('components/sellbase/'))
      );
    },
    'manifest without migrations or components',
  );
  say(
    `Agent files ok: CLAUDE.md, AGENTS.md, ${skills.length} skills, Cursor rule and MCP configs, manifest`,
  );

  // 5. The agent, over the real stdio MCP server configured in .mcp.json.
  const mcpConfig = JSON.parse(await readFile(join(app, '.mcp.json'), 'utf8')).mcpServers.sellbase;
  say(`Agent connects: ${mcpConfig.command} ${mcpConfig.args.join(' ')}`);
  const client = new Client({ name: 'acceptance-agent', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: mcpConfig.command,
      args: mcpConfig.args,
      cwd: app,
      stderr: 'ignore',
    }),
  );
  const call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const data = JSON.parse(res.content[0].text);
    if (res.isError) throw new Error(`${name} failed: ${JSON.stringify(data)}`);
    return data;
  };

  const plan = await call('storefront_scaffold', {
    intent: 'tienda de playeras y una guía digital',
  });
  const docs = await call('docs_search', { query: 'webhook de stripe en local' });
  if (!plan.command.includes('checkout') || docs.results.length === 0)
    throw new Error('storefront_scaffold or docs_search returned nothing useful');
  say(`storefront_scaffold: ${plan.command}; docs_search: ${docs.results[0].title}`);

  const status = await call('store_status');
  say(
    `store_status: ${status.checks
      .filter((c) => c.status !== 'ok')
      .map((c) => c.id)
      .join(', ')} pending`,
  );
  await call('integration_connect', {
    provider: 'stripe',
    secret_key: env.STRIPE_SECRET_KEY,
    webhook_secret: env.STRIPE_WEBHOOK_SECRET,
  });
  await call('store_update_settings', {
    changes: { settings: { shipping: { flat_rate_amount: 9900, free_over_amount: 150000 } } },
  });
  const tee = await call('product_upsert', {
    product: {
      type: 'physical',
      title: 'Playera Aceptación',
      status: 'active',
      variants: [
        {
          price_amount: 34900,
          inventory: { on_hand: 10 },
          physical: { weight_g: 200, length_cm: 30, width_cm: 25, height_cm: 2 },
        },
      ],
    },
  });
  const guide = await call('product_upsert', {
    product: {
      type: 'digital',
      title: 'Guía Aceptación',
      status: 'active',
      variants: [{ price_amount: 19900 }],
    },
  });
  const pdf = join(app, 'guia.pdf');
  await writeFile(pdf, '%PDF-1.4\n% Sellbase acceptance\n');
  await call('product_file_upload', {
    variant_id: guide.variants[0].id,
    file_path: pdf,
    download_limit: 3,
  });
  say(`Catalog ready: ${tee.title}, ${guide.title}`);

  const purchase = await call('test_purchase', { email: 'comprador@example.com' });
  for (const step of purchase.steps) say(`  ${step.ok ? '✔' : '✖'} ${step.step}: ${step.detail}`);
  await client.close();
  if (!purchase.ok) throw new Error('test_purchase failed');

  // 6. The generated admin page and components compile in the user's app.
  say('next build of the user project…');
  sh('pnpm', ['build'], app, { quiet: true });

  const seconds = (Date.now() - started) / 1000;
  say(
    `ACCEPTED: order #${purchase.order_number}, ${purchase.total_amount / 100} ${purchase.currency}, in ${seconds.toFixed(0)}s (limit 600s)`,
  );
  if (seconds > 600) throw new Error('Took longer than 10 minutes');
} finally {
  // Put the stack back on this repo's config and functions.
  say('Restoring the local stack from the repo…');
  sh(supabaseBin, ['stop'], app, { quiet: true });
  sh(supabaseBin, ['start'], repo, { quiet: true });
  if (!process.env.KEEP_ACCEPTANCE_APP) await rm(app, { recursive: true, force: true });
  await rm(packs, { recursive: true, force: true });
}
