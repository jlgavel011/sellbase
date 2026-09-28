/*
 * Standalone Sellbase admin: a static page for sites that are not React apps (plain
 * HTML, WordPress, Vue, Astro…). Copy the folder to /admin/ and edit config.js; no build,
 * no rewrites (it uses #/ routes).
 */
import { createRoot } from 'react-dom/client';
import { SellbaseAdmin, type AdminConfig } from '../src/index.js';

declare global {
  interface Window {
    SellbaseAdminConfig?: Partial<AdminConfig>;
  }
}

const config = window.SellbaseAdminConfig ?? {};
const root = document.getElementById('sellbase-admin');
if (!root) throw new Error('Missing <div id="sellbase-admin">.');
if (!config.supabaseUrl || !config.supabaseAnonKey) {
  root.innerHTML =
    '<p style="font-family:system-ui;padding:2rem">Falta configurar el admin: edita <code>admin/config.js</code> con supabaseUrl y supabaseAnonKey.</p>';
} else {
  createRoot(root).render(
    <SellbaseAdmin
      config={{
        ...config,
        supabaseUrl: config.supabaseUrl,
        supabaseAnonKey: config.supabaseAnonKey,
        basePath: window.location.pathname,
        routing: 'hash',
      }}
    />,
  );
}
