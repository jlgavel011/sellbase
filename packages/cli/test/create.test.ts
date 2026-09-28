import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from '../src/create.js';
import { assetsDir } from '../src/util.js';

describe.skipIf(!existsSync(join(assetsDir, 'examples')))('create', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'sellbase-create-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true });
  });

  it('copies the Next.js store with its .gitignore and components', async () => {
    await create(cwd, 'store', { template: 'nextjs' });
    expect(await readFile(join(cwd, 'store/.gitignore'), 'utf8')).toContain('.env.local');
    expect(existsSync(join(cwd, 'store/_gitignore'))).toBe(false);
    expect(existsSync(join(cwd, 'store/components/sellbase/provider.tsx'))).toBe(true);
    expect(existsSync(join(cwd, 'store/app/admin/[[...path]]/page.tsx'))).toBe(true);
    expect(existsSync(join(cwd, 'store/node_modules'))).toBe(false);
  });

  it('copies the HTML landing page', async () => {
    await create(cwd, 'landing', { template: 'html' });
    expect(await readFile(join(cwd, 'landing/producto.html'), 'utf8')).toContain(
      '<sellbase-product slug-param="p">',
    );
  });

  it('rejects unknown templates and non-empty folders', async () => {
    await expect(create(cwd, 'x', { template: 'wordpress' })).rejects.toThrow(/Unknown template/);
    await writeFile(join(cwd, 'file.txt'), 'x');
    await expect(create(cwd, '.', { template: 'html' })).rejects.toThrow(/not empty/);
  });
});
