'use client';

import { SellbaseAdmin, type AdminConfig } from '@sellbase/admin';
import '@sellbase/admin/styles.css';

/**
 * The admin is an npm package mounted here. Everything below is customization through
 * config, not edits to the package (SPEC §19.3): theme, texts, a slot and an extra page.
 */
const config: AdminConfig = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  basePath: '/admin',
  theme: { primary: '#7c3aed', radius: '0.625rem' },
  texts: { nav: { orders: 'Ventas' } },
  slots: {
    'home.top': () => (
      <div
        data-testid="custom-slot"
        style={{ padding: 12, borderRadius: 8, background: '#f5f3ff', color: '#5b21b6' }}
      >
        Slot personalizado: aquí la tienda puede poner sus propios avisos.
      </div>
    ),
  },
  pages: [
    {
      path: 'reportes',
      label: 'Reportes',
      icon: '📊',
      render: () => <h1 style={{ fontSize: 24, fontWeight: 600 }}>Reportes personalizados</h1>,
    },
  ],
};

export default function AdminPage() {
  return <SellbaseAdmin config={config} />;
}
