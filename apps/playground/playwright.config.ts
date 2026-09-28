import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

/** Public values of the playground (.env.local), also used by the plain HTML site. */
const publicEnv = Object.fromEntries(
  (existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '')
    .split('\n')
    .map((l) => /^(NEXT_PUBLIC_[A-Z_]+)=(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => [m[1] ?? '', m[2] ?? '']),
);

export default defineConfig({
  testDir: './e2e',
  // Several tests wait for Stripe Checkout (test mode), which can take 15–20 s under load.
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:3100', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm build && pnpm start',
      url: 'http://localhost:3100',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // A plain HTML site (no framework) with the web components and the static admin.
      command: 'node ../static-site/serve.mjs',
      url: 'http://localhost:3200',
      reuseExistingServer: !process.env.CI,
      env: { ...publicEnv, PORT: '3200' },
    },
  ],
});
