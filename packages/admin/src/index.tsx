'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { AdminConfig } from './config.js';
import { AdminProvider, useAdmin } from './context.js';
import { AbandonedPage } from './pages/abandoned.js';
import { AgendaPage } from './pages/agenda.js';
import { CollectionsPage } from './pages/collections.js';
import { CustomerDetailPage, CustomersPage } from './pages/customers.js';
import { DiscountsPage } from './pages/discounts.js';
import { ManualOrderPage } from './pages/manual-order.js';
import { HomePage } from './pages/home.js';
import { InventoryPage } from './pages/inventory.js';
import { OrderDetailPage, OrdersPage } from './pages/orders.js';
import { ProductFormPage, ProductsPage } from './pages/products.js';
import { ResourcesPage } from './pages/resources.js';
import { SettingsPage } from './pages/settings.js';
import { match, Router, useRouter } from './router.js';
import { Login, PageBody, SetPassword, Shell, StaffGate } from './shell.js';
import { EmptyState, ToastProvider } from './ui.js';

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
    '--sba-primary': theme.primary ?? '#5b4bff',
    // The brand gradient unless the store picked its own primary color.
    '--sba-primary-gradient': theme.primary
      ? 'none'
      : 'linear-gradient(135deg, #7c6bff 0%, #5b4bff 55%, #3f8cf0 100%)',
    '--sba-primary-fg': theme.primaryForeground ?? '#ffffff',
    '--sba-radius': theme.radius ?? '0.5rem',
    fontFamily:
      theme.fontFamily ??
      '"Inter var", "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  } as CSSProperties;

  return (
    <div className="sb-admin" style={style}>
      <AdminProvider config={config}>
        <ToastProvider>
          <Router basePath={config.basePath ?? '/admin'} mode={config.routing ?? 'path'}>
            <Gate />
          </Router>
        </ToastProvider>
      </AdminProvider>
    </div>
  );
}

function Gate() {
  const { session, sessionReady, needsPassword } = useAdmin();
  if (!sessionReady) return null;
  if (!session) return <Login />;
  if (needsPassword) return <SetPassword />;
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
  const { config, sellbase, t } = useAdmin();
  let params: Record<string, string> | null;
  // Pages from before the v2 layout share the page width through PageBody.
  const legacy = (node: ReactNode) => <PageBody>{node}</PageBody>;

  if (match('/', path)) return <HomePage />;
  if (match('/orders', path)) return <OrdersPage />;
  if (match('/orders/new', path)) return <ManualOrderPage />;
  if (match('/orders/abandoned', path)) return <AbandonedPage />;
  if ((params = match('/orders/:id', path)))
    return <OrderDetailPage key={params.id} id={params.id ?? ''} />;
  if (match('/agenda', path)) return <AgendaPage />;
  if (match('/agenda/resources', path)) return <ResourcesPage />;
  if (match('/products', path)) return <ProductsPage />;
  if (match('/products/collections', path)) return <CollectionsPage />;
  if (match('/products/inventory', path)) return <InventoryPage />;
  if (match('/products/new', path)) return <ProductFormPage key="new" />;
  if ((params = match('/products/:id', path)))
    return <ProductFormPage key={params.id} id={params.id ?? ''} />;
  if (match('/customers', path)) return <CustomersPage />;
  if ((params = match('/customers/:id', path)))
    return <CustomerDetailPage key={params.id} id={params.id ?? ''} />;
  if (match('/discounts', path)) return <DiscountsPage />;
  if (match('/settings', path)) return <SettingsPage />;
  if ((params = match('/settings/:section', path)))
    return <SettingsPage key={params.section} section={params.section ?? 'general'} />;

  const page = config.pages?.find((p) => match(`/${p.path.replace(/^\//, '')}`, path));
  if (page) return legacy(<>{page.render({ sellbase, navigate })}</>);

  return legacy(
    <EmptyState
      icon="search"
      title="404"
      body={path}
      action={
        <a
          href="#/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          {t.nav.home}
        </a>
      }
    />,
  );
}
