import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const assetsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../assets');

const color = (code: number) => (text: string) =>
  process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
export const green = color(32);
export const yellow = color(33);
export const red = color(31);
export const dim = color(2);
export const bold = color(1);

export const log = {
  step: (text: string) => console.log(`${green('◆')} ${text}`),
  info: (text: string) => console.log(`  ${dim(text)}`),
  warn: (text: string) => console.log(`${yellow('▲')} ${text}`),
  error: (text: string) => console.error(`${red('✖')} ${text}`),
};

/** Error with the next action, printed without a stack trace. */
export type CliError = Error & { hint: string; name: 'CliError' };

export function cliError(message: string, hint: string): CliError {
  return Object.assign(new Error(message), { hint, name: 'CliError' as const });
}

export const isCliError = (e: unknown): e is CliError =>
  e instanceof Error && e.name === 'CliError';

export function run(
  command: string,
  args: string[],
  options: { cwd: string; capture?: boolean; env?: NodeJS.ProcessEnv } = { cwd: process.cwd() },
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: process.platform === 'win32',
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolvePromise(out)
        : reject(
            new Error(`${command} ${args.join(' ')} exited with ${code}\n${err.slice(-2000)}`),
          ),
    );
  });
}

export function parseEnv(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m?.[1]) vars[m[1]] = (m[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

export async function readEnvFile(path: string): Promise<Record<string, string>> {
  return existsSync(path) ? parseEnv(await readFile(path, 'utf8')) : {};
}

/** Sets variables in an env file, replacing existing keys and keeping everything else. */
export async function upsertEnvFile(
  path: string,
  vars: Record<string, string>,
  options: { secret?: boolean; header?: string } = {},
) {
  let text = existsSync(path)
    ? await readFile(path, 'utf8')
    : options.header
      ? `${options.header}\n`
      : '';
  for (const [key, value] of Object.entries(vars)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    text = re.test(text)
      ? text.replace(re, line)
      : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
  }
  await writeFile(path, text);
  if (options.secret) await chmod(path, 0o600);
}

export async function ensureGitignore(cwd: string, entries: string[]) {
  const path = join(cwd, '.gitignore');
  const current = existsSync(path) ? await readFile(path, 'utf8') : '';
  const missing = entries.filter((e) => !current.split(/\r?\n/).includes(e));
  if (missing.length)
    await appendFile(
      path,
      `${current && !current.endsWith('\n') ? '\n' : ''}# Sellbase\n${missing.join('\n')}\n`,
    );
}

/** Writes a file only if it does not exist; returns whether it was written. */
export async function writeIfMissing(path: string, content: string): Promise<boolean> {
  if (existsSync(path)) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return true;
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  return existsSync(path) ? (JSON.parse(await readFile(path, 'utf8')) as T) : fallback;
}

export const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
