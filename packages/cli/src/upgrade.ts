import { BRAND } from '@sellbase/core';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { printDoctor } from './doctor.js';
import {
  applyBackend,
  copyBackendFiles,
  FUNCTIONS,
  installPackages,
  writeAgentFiles,
} from './init.js';
import { BASE_DIR, readManifest, writeManifest } from './manifest.js';
import { detectProject, readSellbaseEnv, resolveSupabase, withDb } from './project.js';
import { pendingMigrations, planFile, type FileAction } from './upgrade-plan.js';
import { assetsDir, bold, cliError, dim, green, log, run, sha256Hex, yellow } from './util.js';
import { VERSION } from './version.js';

export interface UpgradeOptions {
  dryRun: boolean;
  skipBackup: boolean;
  skipInstall: boolean;
  supabaseCli: string;
  supabaseUrl?: string;
  anonKey?: string;
  serviceRoleKey?: string;
  dbUrl?: string;
  packagesFrom?: string;
}

const ROLLBACK = Symbol('rollback');

/** Applies pending migrations inside a transaction and always rolls back. */
async function dryRunMigrations(dbUrl: string, files: string[]) {
  const failures: { file: string; error: string }[] = [];
  await withDb(dbUrl, async (sql) => {
    try {
      await sql.begin(async (tx) => {
        for (const file of files) {
          try {
            await tx.unsafe(await readFile(join(assetsDir, 'migrations', file), 'utf8'));
          } catch (error) {
            failures.push({ file, error: error instanceof Error ? error.message : String(error) });
            throw ROLLBACK;
          }
        }
        throw ROLLBACK;
      });
    } catch (error) {
      if (error !== ROLLBACK) throw error;
    }
  });
  return failures;
}

/** Schema and data of the `sellbase` schema, dumped with the Supabase CLI (matching pg_dump). */
async function backup(cwd: string, local: boolean, supabaseCli: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(cwd, '.sellbase/backups');
  await mkdir(dir, { recursive: true });
  const [cmd, ...base] = supabaseCli.split(' ');
  const target = local ? ['--local'] : ['--linked'];
  const schema = join(dir, `${stamp}-schema.sql`);
  const data = join(dir, `${stamp}-data.sql`);
  try {
    await run(
      cmd ?? 'npx',
      [...base, 'db', 'dump', ...target, '--schema', BRAND.dbSchema, '-f', schema],
      {
        cwd,
        capture: true,
      },
    );
    await run(
      cmd ?? 'npx',
      [...base, 'db', 'dump', ...target, '--schema', BRAND.dbSchema, '--data-only', '-f', data],
      { cwd, capture: true },
    );
  } catch (error) {
    throw cliError(
      `Could not back up the ${BRAND.dbSchema} schema: ${error instanceof Error ? error.message.split('\n')[0] : error}`,
      local
        ? 'Make sure the local stack is running (`npx supabase start`), or pass --skip-backup if you have your own backup.'
        : 'Link the project (`npx supabase link --project-ref <ref>`), or pass --skip-backup if you have your own backup.',
    );
  }
  return [schema, data];
}

async function readIfExists(path: string) {
  return existsSync(path) ? readFile(path, 'utf8') : null;
}

export async function upgrade(cwd: string, options: UpgradeOptions) {
  console.log(bold(`\n${BRAND.name} upgrade${options.dryRun ? ' (dry run)' : ''} → ${VERSION}\n`));
  const project = await detectProject(cwd);
  const conn = await resolveSupabase(cwd, options);
  const manifest = await readManifest(cwd);
  if (Object.keys(manifest.files).length === 0 && manifest.migrations.length === 0) {
    log.info(
      'No .sellbase/manifest.json yet (installed before 0.2): components are treated as edited.',
    );
  }

  // 1. Database
  const available = (await readdir(join(assetsDir, 'migrations'))).filter((f) =>
    f.endsWith('.sql'),
  );
  const current = await withDb(conn.dbUrl, async (sql) => {
    const [row] = await sql<{ version: string | null }[]>`
      select max(version) as version from ${sql(BRAND.dbSchema)}.schema_version`;
    return row?.version ?? null;
  });
  const pending = pendingMigrations(current, available);
  if (pending.length) {
    log.step(`Database ${current} → ${pending.at(-1)?.slice(0, 4)}: ${pending.join(', ')}`);
    const failures = await dryRunMigrations(conn.dbUrl, pending);
    if (failures.length) {
      for (const f of failures) log.error(`${f.file}: ${f.error}`);
      throw cliError(
        'A migration fails against this database; nothing was changed.',
        'Share the error with the Sellbase maintainers or check for manual changes in the sellbase schema.',
      );
    }
    log.step(green('Dry run: every pending migration applies cleanly (rolled back).'));
  } else {
    log.step(`Database is up to date (${current}).`);
  }

  // 2. Edge Functions (Sellbase-owned bundles)
  const functions: string[] = [];
  for (const fn of FUNCTIONS) {
    const next = await readFile(join(assetsDir, 'functions', fn, 'index.js'), 'utf8');
    const now = await readIfExists(join(cwd, 'supabase/functions', fn, 'index.js'));
    if (now !== next) functions.push(fn);
  }
  log.step(
    functions.length ? `Functions to update: ${functions.join(', ')}` : 'Functions are current.',
  );

  // 3. Files copied into the project
  const plans: (FileAction & { source: string })[] = [];
  for (const [path, tracked] of Object.entries(manifest.files)) {
    const upstreamPath = join(assetsDir, tracked.source);
    if (!existsSync(upstreamPath)) continue;
    plans.push({
      ...planFile({
        path,
        tracked,
        current: await readIfExists(join(cwd, path)),
        base: await readIfExists(join(cwd, BASE_DIR, path)),
        upstream: await readFile(upstreamPath, 'utf8'),
      }),
      source: tracked.source,
    });
  }
  const updates = plans.filter((p) => p.action === 'update');
  const diffs = plans.filter((p) => p.action === 'diff');
  for (const p of updates) log.step(`Update ${p.path} ${dim('(not edited)')}`);
  for (const p of diffs)
    log.step(
      `${yellow('Edited')} ${p.path}: upstream change saved as .sellbase/updates/${p.path}.diff`,
    );
  if (!updates.length && !diffs.length) log.step('Components and templates are current.');

  if (options.dryRun) {
    log.info('Dry run: nothing was changed. Run `npx sellbase upgrade` to apply.');
    return { pending, functions, updates: updates.length, diffs: diffs.length };
  }

  // 4. Apply
  if (pending.length && !options.skipBackup) {
    const files = await backup(cwd, conn.local, options.supabaseCli);
    log.step(`Backup: ${files.map((f) => f.replace(`${cwd}/`, '')).join(', ')}`);
  }
  await copyBackendFiles(cwd);
  if (pending.length || functions.length) {
    await applyBackend(cwd, conn, options, false);
    log.step(pending.length ? 'Applied migrations' : 'Functions copied');
    if (conn.local && functions.length)
      log.info(
        'Local stack: restart the edge runtime to load the new functions (`npx supabase stop && npx supabase start`).',
      );
  }
  for (const p of plans) {
    if (p.action === 'update') {
      await writeFile(join(cwd, p.path), p.content);
      const base = join(cwd, BASE_DIR, p.path);
      await mkdir(dirname(base), { recursive: true });
      await writeFile(base, p.content);
      manifest.files[p.path] = { source: p.source, sha256: sha256Hex(p.content) };
    }
    if (p.action === 'diff') {
      const out = join(cwd, '.sellbase/updates', `${p.path}.diff`);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, p.diff);
    }
  }
  const latest = await readManifest(cwd);
  await writeManifest(cwd, {
    ...latest,
    version: VERSION,
    files: { ...latest.files, ...manifest.files },
  });
  if (!options.skipInstall && project.framework !== 'web') {
    await installPackages(cwd, project, options);
    log.step('Updated @sellbase packages');
  }
  await writeAgentFiles(cwd);
  log.step('Refreshed CLAUDE.md, AGENTS.md, skills, rules and MCP configs');

  console.log('');
  const creds = await readSellbaseEnv(cwd).catch(() => null);
  if (creds) await printDoctor(creds, { exitOnFail: false });
  if (diffs.length)
    console.log(
      `\n${bold('Next:')} ask your agent to merge the diffs in .sellbase/updates/ (skill "upgrade"), then run test_purchase.\n`,
    );
  return { pending, functions, updates: updates.length, diffs: diffs.length };
}
