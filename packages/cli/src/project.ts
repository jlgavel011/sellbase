import { BRAND, DEFAULT_AGENT_SCOPES, type ApiScope } from '@sellbase/core';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { cliError, parseEnv, randomToken, readEnvFile, readJson, run, sha256Hex } from './util.js';

export interface SupabaseConnection {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl: string;
  local: boolean;
}

export type Framework = 'next-app' | 'vite-react' | 'web';

export interface ProjectInfo {
  framework: Framework;
  /** Next.js: app/ or src/app/. Vite: src/. */
  appDir: string;
  /** Prefix for copied storefront components: '' (components/sellbase) or 'src/'. */
  componentsBase: string;
  /**
   * Any other site (plain HTML, WordPress theme, Vue, Svelte, Astro, Angular…): the folder
   * served as-is, where sellbase/ and admin/ are copied ('' = project root).
   */
  publicDir: string;
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun';
}

export async function detectProject(cwd: string): Promise<ProjectInfo> {
  const pkg = await readJson<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(join(cwd, 'package.json'), {});
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const packageManager = existsSync(join(cwd, 'pnpm-lock.yaml'))
    ? 'pnpm'
    : existsSync(join(cwd, 'yarn.lock'))
      ? 'yarn'
      : existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))
        ? 'bun'
        : 'npm';
  if (deps.next) {
    const appDir = existsSync(join(cwd, 'src/app')) ? 'src/app' : 'app';
    if (!existsSync(join(cwd, appDir))) {
      throw cliError(
        'No app/ directory found.',
        'Sellbase needs the Next.js App Router (app/ or src/app/).',
      );
    }
    return {
      framework: 'next-app',
      appDir,
      componentsBase: '',
      publicDir: 'public',
      packageManager,
    };
  }
  if (deps.vite && deps.react) {
    // Lovable, Bolt and most AI app builders produce Vite + React projects.
    return {
      framework: 'vite-react',
      appDir: 'src',
      componentsBase: 'src/',
      publicDir: 'public',
      packageManager,
    };
  }
  // Everything else: web components + static admin, served from the public folder.
  const publicDir = ['public', 'static'].find((d) => existsSync(join(cwd, d))) ?? '';
  if (!existsSync(join(cwd, 'package.json')) && !existsSync(join(cwd, 'index.html'))) {
    throw cliError(
      'No website found in this folder.',
      'Run it in the root of your site: the folder with index.html (plain HTML) or package.json.',
    );
  }
  return { framework: 'web', appDir: '', componentsBase: '', publicDir, packageManager };
}

/**
 * Finds the project's Supabase: explicit flags first, otherwise the local stack via
 * `supabase status`. Nothing is created; Sellbase installs into the existing project.
 */
export async function resolveSupabase(
  cwd: string,
  flags: {
    supabaseUrl?: string;
    anonKey?: string;
    serviceRoleKey?: string;
    dbUrl?: string;
    supabaseCli: string;
  },
): Promise<SupabaseConnection> {
  if (flags.supabaseUrl && flags.anonKey && flags.serviceRoleKey && flags.dbUrl) {
    return {
      apiUrl: flags.supabaseUrl,
      anonKey: flags.anonKey,
      serviceRoleKey: flags.serviceRoleKey,
      dbUrl: flags.dbUrl,
      local: /127\.0\.0\.1|localhost/.test(flags.supabaseUrl),
    };
  }
  if (!existsSync(join(cwd, 'supabase/config.toml'))) {
    throw cliError(
      'No Supabase project found in this folder.',
      'Run `npx supabase init && npx supabase start` first, or pass --supabase-url, --anon-key, --service-role-key and --db-url for a hosted project.',
    );
  }
  const [cmd, ...args] = flags.supabaseCli.split(' ');
  let out: string;
  try {
    out = await run(cmd ?? 'npx', [...args, 'status', '-o', 'env'], { cwd, capture: true });
  } catch {
    throw cliError(
      'The local Supabase stack is not running.',
      'Start it with `npx supabase start` and run `sellbase init` again.',
    );
  }
  const env = parseEnv(out);
  const apiUrl = env.API_URL;
  const anonKey = env.ANON_KEY ?? env.PUBLISHABLE_KEY;
  const serviceRoleKey = env.SERVICE_ROLE_KEY ?? env.SECRET_KEY;
  const dbUrl = env.DB_URL;
  if (!apiUrl || !anonKey || !serviceRoleKey || !dbUrl) {
    throw cliError(
      'Could not read the local Supabase keys.',
      'Check `npx supabase status -o env` prints API_URL, ANON_KEY, SERVICE_ROLE_KEY and DB_URL.',
    );
  }
  return { apiUrl, anonKey, serviceRoleKey, dbUrl, local: true };
}

export const apiUrlFor = (conn: { apiUrl: string }) =>
  `${conn.apiUrl.replace(/\/+$/, '')}/functions/v1/${BRAND.slug}-api`;

export async function withDb<T>(dbUrl: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(dbUrl, { max: 1, onnotice: () => undefined });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

export async function ensureStore(
  sql: postgres.Sql,
  input: {
    name: string;
    slug: string;
    currency: string;
    country: string;
    locale: string;
    contactEmail: string | null;
  },
): Promise<{ id: string; created: boolean }> {
  const [existing] = await sql<{ id: string }[]>`select sellbase.current_store_id() as id`;
  if (existing?.id) return { id: existing.id, created: false };
  const [store] = await sql<{ id: string }[]>`
    insert into sellbase.stores (name, slug, default_currency, country, default_locale, contact_email, settings)
    values (${input.name}, ${input.slug}, ${input.currency}, ${input.country}, ${input.locale}, ${input.contactEmail},
            ${sql.json({ tax: { mode: 'inclusive', rate_bps: input.country === 'MX' ? 1600 : 0 } })})
    returning id`;
  if (!store) throw new Error('store insert returned no row');
  return { id: store.id, created: true };
}

export async function createToken(
  sql: postgres.Sql,
  storeId: string,
  name: string,
  scopes: readonly ApiScope[] = DEFAULT_AGENT_SCOPES,
) {
  const token = `${BRAND.tokenPrefix}${randomToken()}`;
  await sql`
    insert into sellbase.api_tokens (store_id, name, token_hash, prefix, scopes)
    values (${storeId}, ${name}, ${sha256Hex(token)}, ${token.slice(0, 12)}, ${sql.array([...scopes])})`;
  return token;
}

/** Invites the owner by email (magic link) and adds them to the store team. */
export async function inviteOwner(
  conn: SupabaseConnection,
  sql: postgres.Sql,
  storeId: string,
  email: string,
  redirectTo: string,
) {
  const headers = {
    apikey: conn.serviceRoleKey,
    authorization: `Bearer ${conn.serviceRoleKey}`,
    'content-type': 'application/json',
  };
  const res = await fetch(`${conn.apiUrl}/auth/v1/invite`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, data: {}, redirect_to: redirectTo }),
  });
  let userId: string | undefined;
  if (res.ok) {
    userId = ((await res.json()) as { id?: string }).id;
  } else {
    // Already registered: look the user up instead.
    const [user] = await sql<
      { id: string }[]
    >`select id from auth.users where email = ${email.toLowerCase()}`;
    userId = user?.id;
  }
  if (!userId)
    throw cliError(
      `Could not invite ${email}.`,
      'Check the email address and that Supabase Auth is running.',
    );
  await sql`
    insert into sellbase.staff_members (store_id, user_id, role) values (${storeId}, ${userId}, 'owner')
    on conflict (store_id, user_id) do nothing`;
}

/** Reads the agent credentials written by `sellbase init`. */
export async function readSellbaseEnv(cwd: string) {
  const env = { ...(await readEnvFile(join(cwd, '.env.sellbase'))), ...process.env };
  const url = env.SELLBASE_URL;
  const token = env.SELLBASE_API_TOKEN;
  if (!url || !token) {
    throw cliError(
      'No Sellbase credentials found.',
      'Run `npx sellbase init` in this project (it writes .env.sellbase), or set SELLBASE_URL and SELLBASE_API_TOKEN.',
    );
  }
  return { url, token, anonKey: env.SUPABASE_ANON_KEY };
}
