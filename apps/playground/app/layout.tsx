import type { ReactNode } from 'react';

export const metadata = {
  title: 'Sellbase Playground',
  description: 'Demo site used for Sellbase end-to-end tests.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem' }}>{children}</body>
    </html>
  );
}
