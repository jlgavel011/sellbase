import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Aurora Café', template: '%s · Aurora Café' },
  description: 'Café de especialidad tostado en casa. Tienda hecha con Sellbase.',
};

// The store's header and cart live in (store)/layout.tsx, so /admin gets the whole page.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
