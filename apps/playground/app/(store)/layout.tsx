import type { ReactNode } from 'react';
import { CartButton, CartDrawer } from '../../components/sellbase/cart-drawer';
import { Providers } from '../providers';

export default function StoreLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <header className="border-b border-[var(--sb-border)]">
        <nav
          className="mx-auto flex max-w-6xl items-center justify-between gap-4 p-4"
          aria-label="Principal"
        >
          <a href="/" className="text-lg font-semibold">
            Sellbase Playground
          </a>
          <div className="flex items-center gap-4 text-sm">
            <a href="/pedido" className="hover:underline">
              Mi pedido
            </a>
            <CartButton />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
      <CartDrawer cartHref="/carrito" />
    </Providers>
  );
}
