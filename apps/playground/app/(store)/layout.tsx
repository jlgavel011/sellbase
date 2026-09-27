import type { ReactNode } from 'react';
import { CartButton, CartDrawer } from '../../components/sellbase/cart-drawer';
import { Providers } from '../providers';

export default function StoreLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <header className="border-b border-[var(--sb-border)]">
        <nav className="mx-auto flex max-w-6xl items-center justify-between p-4">
          <a href="/" className="text-lg font-semibold">
            Sellbase Playground
          </a>
          <CartButton />
        </nav>
      </header>
      <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
      <CartDrawer />
    </Providers>
  );
}
