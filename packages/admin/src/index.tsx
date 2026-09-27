'use client';

import type { CSSProperties } from 'react';
import type { AdminConfig } from './config.js';
import { AdminProvider, useAdmin } from './context.js';
import { AgendaPage } from './pages/agenda.js';
import { HomePage } from './pages/home.js';
import { OrderDetailPage, OrdersPage } from './pages/orders.js';
import { ProductFormPage, ProductsPage } from './pages/products.js';
import { ResourcesPage } from './pages/resources.js';
import { SettingsPage } from './pages/settings.js';
import { match, Router, useRouter } from './router.js';
import { Login, Shell, StaffGate } from './shell.js';
import { Card } from './ui.js';

export type { AdminConfig, AdminPage, AdminTheme, SlotContext, SlotName } from './config.js';
export { SLOT_NAMES } from './config.js';
export type { Texts } from './texts.js';

/**
 * The Sellbase admin. Mount it on a catch-all route (e.g. app/admin/[[...path]]/page.tsx)
 * and import '@sellbase/admin/styles.css' once.
 *
 *   <SellbaseAdmin config={{ supabaseUrl, supabaseAnonKey, basePath: '/admin' }} />
 */
export function SellbaseAdmin({ config }: { config: AdminConfig }) {
  const theme = config.theme ?? {};
  const style = {
    '--sba-primary': theme.primary ?? '#18181b',
    '--sba-primary-fg': theme.primaryForeground ?? '#ffffff',
    '--sba-radius': theme.radius ?? '0.5rem',
    fontFamily:
      theme.fontFamily ?? 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  } as CSSProperties;

  return (
    <div className="sb-admin" style={style}>
      <AdminProvider config={config}>
        <Router basePath={config.basePath ?? '/admin'}>
          <Gate />
        </Router>
      </AdminProvider>
    </div>
  );
}

function Gate() {
  const { session, sessionReady } = useAdmin();
  if (!sessionReady) return null;
  if (!session) return <Login />;
  return (
    <StaffGate>
      <Shell>
        <Routes />
      </Shell>
    </StaffGate>
  );
}

function Routes() {
  const { path, navigate } = useRouter();
  const { config, sellbase } = useAdmin();
  let params: Record<string, string> | null;

  if (match('/', path)) return <HomePage />;
  if (match('/orders', path)) return <OrdersPage />;
  if ((params = match('/orders/:id', path))) return <OrderDetailPage id={params.id ?? ''} />;
  if (match('/agenda', path)) return <AgendaPage />;
  if (match('/agenda/resources', path)) return <ResourcesPage />;
  if (match('/products', path)) return <ProductsPage />;
  if (match('/products/new', path)) return <ProductFormPage />;
  if ((params = match('/products/:id', path)))
    return <ProductFormPage key={params.id} id={params.id ?? ''} />;
  if (match('/settings', path)) return <SettingsPage />;

  const page = config.pages?.find((p) => match(`/${p.path.replace(/^\//, '')}`, path));
  if (page) return <>{page.render({ sellbase, navigate })}</>;

  return <Card>404</Card>;
}
