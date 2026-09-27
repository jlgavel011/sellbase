import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Sellbase Playground',
  description: 'Demo store used for Sellbase end-to-end tests.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
