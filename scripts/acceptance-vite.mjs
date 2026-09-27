#!/usr/bin/env node
// Vite acceptance: a clean Vite + React project (like Lovable or Bolt produce) gets
// `sellbase init`, an agent-style mount of the admin and the storefront, and must build.
// Uses the running local stack and its existing store (no database reset).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packSellbase } from './lib/pack.mjs';

const repo = resolve(import.meta.dirname, '..');
const supabaseBin = join(repo, 'node_modules/.bin/supabase');
const started = Date.now();
const say = (text) => console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s] ${text}`);
const sh = (cmd, args, cwd, quiet = true) =>
  String(execFileSync(cmd, args, { cwd, stdio: quiet ? 'pipe' : 'inherit' }) ?? '');

say('Building and packing Sellbase packages…');
const { packs, overrides } = await packSellbase(repo);

const app = await mkdtemp(join(tmpdir(), 'sellbase-vite-'));
say(`Clean Vite + React project in ${app}`);
await mkdir(join(app, 'src'), { recursive: true });
const pkg = {
  name: 'vite-store',
  private: true,
  type: 'module',
  scripts: { build: 'tsc --noEmit && vite build' },
  dependencies: { react: '^19.3.0', 'react-dom': '^19.3.0' },
  devDependencies: {
    vite: '^7.0.0',
    '@vitejs/plugin-react': '^5.0.0',
    typescript: '~6.0.3',
    '@types/react': '^19.3.0',
    '@types/react-dom': '^19.3.0',
  },
  pnpm: { overrides },
};
await writeFile(join(app, 'package.json'), JSON.stringify(pkg, null, 2));
await writeFile(
  join(app, 'index.html'),
  '<!doctype html><html lang="es"><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
);
await writeFile(
  join(app, 'vite.config.ts'),
  "import react from '@vitejs/plugin-react';\nimport { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [react()] });\n",
);
await writeFile(
  join(app, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['dom', 'dom.iterable', 'esnext'],
        types: ['vite/client'],
        strict: true,
        noEmit: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        skipLibCheck: true,
        isolatedModules: true,
      },
      include: ['src'],
    },
    null,
    2,
  ),
);
await writeFile(
  join(app, 'src/App.tsx'),
  'export default function App() {\n  return <h1>Mi landing hecha con IA</h1>;\n}\n',
);
await writeFile(
  join(app, 'src/main.tsx'),
  "import { createRoot } from 'react-dom/client';\nimport App from './App';\n\ncreateRoot(document.getElementById('root')!).render(<App />);\n",
);
sh('pnpm', ['install'], app);
sh(supabaseBin, ['init', '--force'], app);

say('npx sellbase init --yes (Vite, existing local stack)');
const status = Object.fromEntries(
  sh(supabaseBin, ['status', '-o', 'env'], repo)
    .split('\n')
    .map((l) => /^([A-Z_]+)="?([^"]*)"?$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
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
    '--packages-from',
    packs,
  ],
  app,
  false,
);

const check = (path, test, why) => {
  const abs = join(app, path);
  if (!existsSync(abs) || !test(readFileSync(abs, 'utf8'))) throw new Error(`${path}: ${why}`);
};
check(
  '.env.local',
  (t) => t.includes('VITE_SUPABASE_ANON_KEY=') && !t.includes('SERVICE_ROLE'),
  'expected VITE_ public keys only',
);
check('src/components/sellbase/checkout.tsx', () => true, 'components not copied under src/');
check(
  'src/components/sellbase/provider.tsx',
  (t) => t.includes('import.meta.env.VITE_SELLBASE_URL'),
  'provider not for Vite',
);
check(
  'src/sellbase/admin-page.tsx',
  (t) => t.includes('import.meta.env.VITE_SUPABASE_URL'),
  'admin page not for Vite',
);
check(
  '.sellbase/manifest.json',
  (t) => Object.keys(JSON.parse(t).files).some((f) => f.startsWith('src/components/sellbase/')),
  'manifest paths',
);
say('Vite files ok: .env.local (VITE_), src/components/sellbase, src/sellbase/admin-page.tsx');

// What the agent does next (add-storefront skill): mount the admin and the storefront.
await writeFile(
  join(app, 'src/main.tsx'),
  `import { createRoot } from 'react-dom/client';
import App from './App';
import { SellbaseStoreProvider } from './components/sellbase/provider';
import { ProductGrid } from './components/sellbase/product-grid';
import { CartDrawer } from './components/sellbase/cart-drawer';
import SellbaseAdminPage from './sellbase/admin-page';
import './components/sellbase/theme.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  window.location.pathname.startsWith('/admin') ? (
    <SellbaseAdminPage />
  ) : (
    <SellbaseStoreProvider>
      <App />
      <CartDrawer />
      <ProductGrid />
    </SellbaseStoreProvider>
  ),
);
`,
);
say('vite build of the user project…');
sh('pnpm', ['build'], app);
say(`ACCEPTED (Vite) in ${((Date.now() - started) / 1000).toFixed(0)}s`);
