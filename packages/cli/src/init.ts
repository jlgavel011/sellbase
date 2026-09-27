import { BRAND } from '@sellbase/core';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { addComponents } from './add.js';
import { readManifest, trackFiles, writeManifest } from './manifest.js';
import { seed } from './seed.js';
import { VERSION } from './version.js';
import { printDoctor } from './doctor.js';
import {
  apiUrlFor,
  createToken,
  detectProject,
  ensureStore,
  inviteOwner,
  resolveSupabase,
  withDb,
  type ProjectInfo,
  type SupabaseConnection,
} from './project.js';
import {
  assetsDir,
  bold,
  ensureGitignore,
  log,
  readJson,
  run,
  upsertEnvFile,
  writeIfMissing,
} from './util.js';

export interface InitOptions {
  yes: boolean;
  storeName: string;
  currency: string;
  country: string;
  locale: string;
  ownerEmail?: string;
  supabaseUrl?: string;
  anonKey?: string;
  serviceRoleKey?: string;
  dbUrl?: string;
  supabaseCli: string;
  skipMigrations: boolean;
  skipInstall: boolean;
  /** Folder with Sellbase package tarballs to install instead of the npm registry. */
  packagesFrom?: string;
  /** Example catalog to load after installing (`sellbase seed`). */
  seed?: string;
}

export const FUNCTIONS = ['sellbase-api', 'sellbase-webhooks', 'sellbase-jobs'] as const;

async function copyBackendFiles(cwd: string) {
  const migrations = join(cwd, 'supabase/migrations');
  await mkdir(migrations, { recursive: true });
  const files = (await readdir(join(assetsDir, 'migrations'))).filter((f) => f.endsWith('.sql'));
  for (const file of files) await cp(join(assetsDir, 'migrations', file), join(migrations, file));
  for (const fn of FUNCTIONS) {
    await mkdir(join(cwd, 'supabase/functions', fn), { recursive: true });
    await cp(
      join(assetsDir, 'functions', fn, 'index.js'),
      join(cwd, 'supabase/functions', fn, 'index.js'),
    );
  }
  const manifest = await readManifest(cwd);
  await writeManifest(cwd, {
    ...manifest,
    version: VERSION,
    migrations: [...new Set([...manifest.migrations, ...files])].sort(),
    functions: [...FUNCTIONS],
  });
  return files.length;
}

/** Registers the functions in supabase/config.toml; returns true if the file changed. */
async function configureFunctions(cwd: string, conn: SupabaseConnection): Promise<boolean> {
  const path = join(cwd, 'supabase/config.toml');
  let toml = await readFile(path, 'utf8');
  const before = toml;
  for (const fn of FUNCTIONS) {
    if (!toml.includes(`[functions.${fn}]`)) {
      toml += `\n# Sellbase: authenticates on its own (sessions, sb_live_ tokens, signed webhooks).\n[functions.${fn}]\nverify_jwt = false\nentrypoint = "./functions/${fn}/index.js"\n`;
    }
  }
  if (conn.local) {
    // Local stack only: a DB host alias Deno can resolve, and the address buyers can reach.
    const secrets = { SELLBASE_DB_HOST: 'db.supabase.internal', SELLBASE_PUBLIC_URL: conn.apiUrl };
    if (!/^\[edge_runtime\.secrets\]/m.test(toml)) toml += '\n[edge_runtime.secrets]\n';
    for (const [key, value] of Object.entries(secrets)) {
      if (!new RegExp(`^${key}\\s*=`, 'm').test(toml)) {
        toml = toml.replace(
          /^\[edge_runtime\.secrets\]\s*$/m,
          `[edge_runtime.secrets]\n${key} = "${value}"`,
        );
      }
    }
  }
  if (toml !== before) await writeFile(path, toml);
  return toml !== before;
}

async function applyBackend(
  cwd: string,
  conn: SupabaseConnection,
  options: InitOptions,
  configChanged: boolean,
) {
  const [cmd, ...base] = options.supabaseCli.split(' ');
  const supabase = (args: string[]) => run(cmd ?? 'npx', [...base, ...args], { cwd });
  if (conn.local) {
    await supabase(['migration', 'up', '--include-all', '--local']);
    if (configChanged) {
      log.info('Restarting the local Supabase stack to load the Sellbase functions…');
      await supabase(['stop']);
      await supabase(['start']);
    }
  } else {
    await supabase(['db', 'push', '--include-all']);
    await supabase(['functions', 'deploy', ...FUNCTIONS, '--no-verify-jwt']);
  }
}

async function installPackages(cwd: string, project: ProjectInfo, options: InitOptions) {
  let deps = ['@sellbase/react', '@sellbase/admin'];
  let devDeps = ['sellbase'];
  if (options.packagesFrom) {
    const dir = resolve(options.packagesFrom);
    const tarballs = (await readdir(dir))
      .filter((f) => f.endsWith('.tgz'))
      .map((f) => join(dir, f));
    deps = tarballs;
    devDeps = [];
  }
  const pm = project.packageManager;
  const add = pm === 'npm' ? ['install'] : ['add'];
  await run(pm, [...add, ...deps], { cwd });
  if (devDeps.length)
    await run(pm, [...add, pm === 'npm' ? '--save-dev' : '-D', ...devDeps], { cwd });
}

/** Writes or refreshes the managed Sellbase section of a markdown file (CLAUDE.md, AGENTS.md). */
async function upsertManagedSection(path: string, section: string) {
  const current = existsSync(path) ? await readFile(path, 'utf8') : '';
  const managed = /<!-- sellbase:start[\s\S]*?<!-- sellbase:end -->\n?/;
  await writeFile(
    path,
    managed.test(current)
      ? current.replace(managed, section)
      : `${current}${current ? '\n' : ''}${section}`,
  );
}

/** Adds the sellbase server to an MCP client config, keeping the other servers. */
async function registerMcp(path: string) {
  const config = await readJson<{ mcpServers?: Record<string, unknown> }>(path, {});
  config.mcpServers = {
    ...config.mcpServers,
    [BRAND.slug]: { command: 'npx', args: [BRAND.cli, 'mcp'] },
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * Agent files (SPEC §13.3): CLAUDE.md and AGENTS.md sections, skills, Cursor rule and
 * MCP configs. Always refreshed: these belong to Sellbase, not to the owner.
 */
export async function writeAgentFiles(cwd: string) {
  const section = await readFile(join(assetsDir, 'templates/CLAUDE.sellbase.md'), 'utf8');
  await upsertManagedSection(join(cwd, 'CLAUDE.md'), section);
  // AGENTS.md is read by Codex, Cursor, Copilot, Gemini and others.
  await upsertManagedSection(join(cwd, 'AGENTS.md'), section);

  for (const skill of await readdir(join(assetsDir, 'skills'))) {
    await mkdir(join(cwd, '.claude/skills/sellbase', skill), { recursive: true });
    await cp(
      join(assetsDir, 'skills', skill, 'SKILL.md'),
      join(cwd, '.claude/skills/sellbase', skill, 'SKILL.md'),
    );
  }
  await mkdir(join(cwd, '.cursor/rules'), { recursive: true });
  await cp(join(assetsDir, 'templates/cursor-rule.mdc'), join(cwd, '.cursor/rules/sellbase.mdc'));

  await registerMcp(join(cwd, '.mcp.json'));
  await registerMcp(join(cwd, '.cursor/mcp.json'));
}

async function writeFrontendFiles(cwd: string, project: ProjectInfo) {
  const vite = project.framework === 'vite-react';
  await addComponents(
    cwd,
    ['theme', 'product-card', 'product-grid', 'product-detail', 'cart-drawer', 'checkout'],
    { quiet: true, base: project.componentsBase },
  );
  const files: [target: string, template: string][] = vite
    ? [
        ['src/components/sellbase/provider.tsx', 'templates/provider.vite.tsx'],
        ['src/sellbase/admin-page.tsx', 'templates/admin-page.vite.tsx'],
      ]
    : [
        ['components/sellbase/provider.tsx', 'templates/provider.tsx'],
        [`${project.appDir}/admin/[[...path]]/page.tsx`, 'templates/admin-page.tsx'],
      ];
  const written: string[] = [];
  for (const [target, template] of files) {
    if (await writeIfMissing(join(cwd, target), await readFile(join(assetsDir, template), 'utf8')))
      written.push(target);
  }
  await trackFiles(cwd, written);
}

export async function init(cwd: string, options: InitOptions) {
  const started = Date.now();
  console.log(bold(`\n${BRAND.name} init\n`));

  const project = await detectProject(cwd);
  log.step(
    project.framework === 'vite-react'
      ? `Vite + React project (${project.packageManager})`
      : `Next.js project (${project.appDir}/, ${project.packageManager})`,
  );

  const conn = await resolveSupabase(cwd, options);
  log.step(`Supabase ${conn.local ? 'local stack' : 'project'} at ${conn.apiUrl}`);

  const migrations = await copyBackendFiles(cwd);
  const configChanged = await configureFunctions(cwd, conn);
  log.step(`Copied ${migrations} migrations and ${FUNCTIONS.length} Edge Functions into supabase/`);

  if (!options.skipMigrations) {
    await applyBackend(cwd, conn, options, configChanged);
    log.step('Applied migrations and loaded the functions');
  }

  const { storeId, token, created } = await withDb(conn.dbUrl, async (sql) => {
    const slug =
      options.storeName
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'store';
    const store = await ensureStore(sql, {
      name: options.storeName,
      slug,
      currency: options.currency,
      country: options.country,
      locale: options.locale,
      contactEmail: options.ownerEmail ?? null,
    });
    // pg_cron calls the jobs function from inside the database container.
    const jobsUrl = conn.local
      ? 'http://kong:8000/functions/v1/sellbase-jobs'
      : `${conn.apiUrl.replace(/\/+$/, '')}/functions/v1/sellbase-jobs`;
    await sql`select sellbase.configure_jobs(${jobsUrl}, ${conn.serviceRoleKey})`;
    if (options.ownerEmail)
      await inviteOwner(conn, sql, store.id, options.ownerEmail, 'http://localhost:3000/admin');
    return {
      storeId: store.id,
      created: store.created,
      token: await createToken(sql, store.id, 'AI agent (sellbase init)'),
    };
  });
  log.step(
    created
      ? `Created the store "${options.storeName}" (${options.currency})`
      : 'Using the existing store',
  );
  if (options.ownerEmail)
    log.info(`Invited ${options.ownerEmail} as owner: check the inbox for the sign-in link.`);

  const sellbaseUrl = apiUrlFor(conn);
  await upsertEnvFile(
    join(cwd, '.env.sellbase'),
    { SELLBASE_URL: sellbaseUrl, SELLBASE_API_TOKEN: token, SUPABASE_ANON_KEY: conn.anonKey },
    {
      secret: true,
      header:
        '# Sellbase agent credentials (secret; used by `npx sellbase mcp`). Never commit this file.',
    },
  );
  // Public values only: the browser gets the anon key, never the service role key.
  const prefix = project.framework === 'vite-react' ? 'VITE_' : 'NEXT_PUBLIC_';
  await upsertEnvFile(join(cwd, '.env.local'), {
    [`${prefix}SUPABASE_URL`]: conn.apiUrl,
    [`${prefix}SUPABASE_ANON_KEY`]: conn.anonKey,
    [`${prefix}SELLBASE_URL`]: sellbaseUrl,
  });
  await ensureGitignore(cwd, ['.env.sellbase', '.env.local']);
  log.step('Wrote .env.local (public keys) and .env.sellbase (agent token, gitignored)');

  if (!options.skipInstall) {
    await installPackages(cwd, project, options);
    log.step('Installed @sellbase/react, @sellbase/admin and the sellbase CLI');
  }

  await writeFrontendFiles(cwd, project);
  log.step(
    project.framework === 'vite-react'
      ? 'Added storefront components (src/components/sellbase) and the admin page (src/sellbase/admin-page.tsx)'
      : 'Added storefront components (components/sellbase) and the admin (/admin)',
  );
  if (project.framework === 'vite-react')
    log.info(
      'Mount the admin at /admin: see the comment at the top of src/sellbase/admin-page.tsx (your agent can do it).',
    );

  await writeAgentFiles(cwd);
  log.step(
    'Wrote CLAUDE.md and AGENTS.md sections, .claude/skills/sellbase, .cursor/rules, .mcp.json and .cursor/mcp.json',
  );

  if (options.seed) await seed({ url: sellbaseUrl, token, anonKey: conn.anonKey }, options.seed);

  console.log('');
  await printDoctor({ url: sellbaseUrl, token, anonKey: conn.anonKey }, { exitOnFail: false });
  console.log(
    `\n${bold('Next step:')} open your AI agent in this folder and say:\n  "Configura mi tienda con Sellbase"\n`,
  );
  log.info(`Done in ${Math.round((Date.now() - started) / 1000)}s (store ${storeId}).`);
}
