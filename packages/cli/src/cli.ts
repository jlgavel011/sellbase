#!/usr/bin/env node
import { API_SCOPES, BRAND, isSellbaseError, type ApiScope } from '@sellbase/core';
import { Command } from 'commander';
import { addComponents } from './add.js';
import { feedback } from './feedback.js';
import { printDoctor } from './doctor.js';
import { init } from './init.js';
import { PRESETS, seed } from './seed.js';
import { upgrade } from './upgrade.js';
import { createToken, detectProject, readSellbaseEnv, resolveSupabase, withDb } from './project.js';
import { cliError, isCliError, log } from './util.js';
import { VERSION } from './version.js';

const program = new Command(BRAND.cli)
  .description(`${BRAND.name}: commerce for apps built with AI`)
  .version(VERSION);

program
  .command('init')
  .description(
    'Install Sellbase into this project (Next.js, Vite + React, or any website) with Supabase',
  )
  .option('-y, --yes', 'non-interactive, accept defaults (for agents)', false)
  .option('--store-name <name>', 'store name', 'Mi tienda')
  .option('--currency <code>', 'ISO 4217 currency', 'MXN')
  .option('--country <code>', 'ISO 3166 country', 'MX')
  .option('--locale <locale>', 'store locale', 'es')
  .option('--owner-email <email>', 'invite this person as the store owner (magic link)')
  .option('--supabase-url <url>', 'hosted project URL (otherwise the local stack is used)')
  .option('--anon-key <key>', 'hosted project anon/publishable key')
  .option('--service-role-key <key>', 'hosted project service role key (used only during init)')
  .option('--db-url <url>', 'hosted project database URL')
  .option('--supabase-cli <cmd>', 'how to run the Supabase CLI', 'npx supabase')
  .option('--skip-migrations', 'copy files but do not apply migrations or restart Supabase', false)
  .option('--skip-install', 'do not install npm packages', false)
  .option('--packages-from <dir>', 'install Sellbase packages from local .tgz files (development)')
  .option('--seed <giro>', `example catalog: ${Object.keys(PRESETS).join(', ')}`)
  .action((opts) => init(process.cwd(), opts));

program
  .command('feedback')
  .description(
    'Draft a GitHub issue for the Sellbase maintainers (bug, idea or extension). Secrets and personal data are redacted; you review and submit it.',
  )
  .option('--kind <kind>', 'bug | idea | extension', 'bug')
  .option('--title <title>', 'one line')
  .option('--summary <text>', 'what happened, or what the store needed')
  .option('--steps <text>', 'steps to reproduce')
  .option('--expected <text>', 'what should have happened')
  .option('--workaround <text>', 'what was built on top of Sellbase (kind extension)')
  .option('--details-file <path>', 'error output, logs or doctor output to attach')
  .option('--area <area>', 'admin, storefront, web components, api, mcp, cli, database, docs')
  .option('--agent <name>', 'the agent drafting it, e.g. "Claude Code"')
  .option('--no-open', 'print the link instead of opening the browser')
  .action((opts) => feedback(process.cwd(), opts));

program
  .command('doctor')
  .description('Setup checklist with the next step for each pending item')
  .option('--json', 'machine-readable output', false)
  .action(async (opts: { json: boolean }) => {
    await printDoctor(await readSellbaseEnv(process.cwd()), { json: opts.json, exitOnFail: true });
  });

program
  .command('add')
  .description('Copy storefront components into components/sellbase')
  .argument('<components...>', 'e.g. product-grid product-detail cart-drawer checkout')
  .option('--overwrite', 'replace files you already have', false)
  .action(async (names: string[], opts: { overwrite: boolean }) => {
    const project = await detectProject(process.cwd()).catch(() => null);
    if (project?.framework === 'web')
      throw cliError(
        'This site uses the Sellbase web components: every <sellbase-*> element is already in sellbase/sellbase.js.',
        'Place the elements in your HTML (skill add-storefront). `sellbase add` copies React components.',
      );
    await addComponents(process.cwd(), names, {
      overwrite: opts.overwrite,
      base: project?.componentsBase ?? '',
    });
  });

program
  .command('seed')
  .description(`Add an example catalog: ${Object.keys(PRESETS).join(', ')}`)
  .argument('<giro>', Object.keys(PRESETS).join(' | '))
  .action(async (giro: string) => {
    await seed(await readSellbaseEnv(process.cwd()), giro);
  });

program
  .command('upgrade')
  .description('Update Sellbase: migrations (dry run + backup), functions, components, skills')
  .option(
    '--dry-run',
    'show what would change and test migrations in a rolled-back transaction',
    false,
  )
  .option('--skip-backup', 'do not dump the sellbase schema before migrating', false)
  .option('--skip-install', 'do not update npm packages', false)
  .option('--supabase-url <url>', 'hosted project URL (otherwise the local stack is used)')
  .option('--anon-key <key>', 'hosted project anon/publishable key')
  .option('--service-role-key <key>', 'hosted project service role key')
  .option('--db-url <url>', 'hosted project database URL')
  .option('--supabase-cli <cmd>', 'how to run the Supabase CLI', 'npx supabase')
  .option('--packages-from <dir>', 'install Sellbase packages from local .tgz files (development)')
  .action((opts) => upgrade(process.cwd(), opts).then(() => undefined));

const token = program.command('token').description('Manage API tokens');
token
  .command('create')
  .description('Create an API token (printed once; only its hash is stored)')
  .option('--name <name>', 'label', 'API token')
  .option('--scopes <list>', `comma separated: ${API_SCOPES.join(', ')}`)
  .option('--db-url <url>', 'database URL (defaults to the local stack)')
  .option('--supabase-cli <cmd>', 'how to run the Supabase CLI', 'npx supabase')
  .action(async (opts: { name: string; scopes?: string; dbUrl?: string; supabaseCli: string }) => {
    const scopes = opts.scopes?.split(',').map((s) => s.trim()) as ApiScope[] | undefined;
    const invalid = scopes?.filter((s) => !(API_SCOPES as readonly string[]).includes(s)) ?? [];
    if (invalid.length)
      throw cliError(
        `Unknown scope(s): ${invalid.join(', ')}.`,
        `Valid scopes: ${API_SCOPES.join(', ')}.`,
      );
    const dbUrl =
      opts.dbUrl ?? (await resolveSupabase(process.cwd(), { supabaseCli: opts.supabaseCli })).dbUrl;
    const value = await withDb(dbUrl, async (sql) => {
      const [store] = await sql<{ id: string }[]>`select sellbase.current_store_id() as id`;
      if (!store?.id) throw cliError('No store found.', 'Run `npx sellbase init` first.');
      return createToken(sql, store.id, opts.name, scopes);
    });
    console.log(value);
  });

token
  .command('list')
  .description('List API tokens (never their secret)')
  .option('--db-url <url>', 'database URL (defaults to the local stack)')
  .option('--supabase-cli <cmd>', 'how to run the Supabase CLI', 'npx supabase')
  .option('--json', 'machine-readable output', false)
  .action(async (opts: { dbUrl?: string; supabaseCli: string; json: boolean }) => {
    const dbUrl =
      opts.dbUrl ?? (await resolveSupabase(process.cwd(), { supabaseCli: opts.supabaseCli })).dbUrl;
    const rows = await withDb(
      dbUrl,
      (sql) => sql<
        {
          id: string;
          name: string;
          prefix: string;
          scopes: string[];
          last_used_at: Date | null;
          revoked_at: Date | null;
          expires_at: Date | null;
        }[]
      >`
        select id, name, prefix, scopes, last_used_at, revoked_at, expires_at from sellbase.api_tokens
         where store_id = sellbase.current_store_id() order by revoked_at is not null, created_at desc`,
    );
    if (opts.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (rows.length === 0) log.info('No tokens yet. Create one with `sellbase token create`.');
    for (const t of rows) {
      const state = t.revoked_at
        ? 'revoked'
        : t.expires_at && t.expires_at < new Date()
          ? 'expired'
          : `last used ${t.last_used_at?.toISOString() ?? 'never'}`;
      console.log(`${t.id}  ${t.prefix}…  ${t.name}  [${state}]\n    ${t.scopes.join(', ')}`);
    }
  });

token
  .command('revoke')
  .description('Revoke an API token right away (by id or by its sb_live_ prefix)')
  .argument('<id-or-prefix>')
  .option('--db-url <url>', 'database URL (defaults to the local stack)')
  .option('--supabase-cli <cmd>', 'how to run the Supabase CLI', 'npx supabase')
  .action(async (ref: string, opts: { dbUrl?: string; supabaseCli: string }) => {
    const dbUrl =
      opts.dbUrl ?? (await resolveSupabase(process.cwd(), { supabaseCli: opts.supabaseCli })).dbUrl;
    const isId = /^[0-9a-f-]{36}$/i.test(ref);
    const revoked = await withDb(dbUrl, async (sql) => {
      const matches = await sql<{ id: string; name: string }[]>`
        select id, name from sellbase.api_tokens
         where store_id = sellbase.current_store_id() and revoked_at is null
           and ${isId ? sql`id = ${ref}::uuid` : sql`prefix like ${`${ref.replace(/…$/, '')}%`}`}`;
      if (matches.length !== 1) {
        throw cliError(
          matches.length
            ? `"${ref}" matches ${matches.length} tokens.`
            : `No active token matches "${ref}".`,
          'Use the full id from `sellbase token list`.',
        );
      }
      const [match] = matches;
      await sql`update sellbase.api_tokens set revoked_at = now() where id = ${match?.id ?? ''}`;
      await sql`
        insert into sellbase.audit_log (store_id, actor_type, actor_id, action, entity, entity_id)
        values (sellbase.current_store_id(), 'system', 'cli', 'token.revoke', 'api_token', ${match?.id ?? ''})`;
      return match;
    });
    log.step(`Revoked "${revoked?.name}" (${revoked?.id}). It stops working immediately.`);
  });

program
  .command('mcp')
  .description('Start the MCP server over stdio (configured in .mcp.json by init)')
  .action(async () => {
    const { runStdioServer } = await import('@sellbase/mcp');
    const { url, token: apiToken, anonKey } = await readSellbaseEnv(process.cwd());
    await runStdioServer({
      url,
      token: apiToken,
      version: VERSION,
      ...(anonKey ? { anonKey } : {}),
    });
  });

program.parseAsync().catch((error: unknown) => {
  if (isCliError(error) || isSellbaseError(error)) {
    log.error(error.message);
    if (error.hint) console.error(`  → ${error.hint}`);
  } else {
    log.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
