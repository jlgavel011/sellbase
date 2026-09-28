import type { ReactNode } from 'react';
import { CartButton, CartDrawer } from '@/components/sellbase/cart-drawer';
import { SellbaseStoreProvider } from '@/components/sellbase/provider';

export default function StoreLayout({ children }: { children: ReactNode }) {
  return (
    <SellbaseStoreProvider>
      <header className="sticky top-0 z-20 border-b border-[var(--sb-border)] bg-[var(--sb-bg)]/90 backdrop-blur">
        <nav
          className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3"
          aria-label="Principal"
        >
          <a href="/" className="text-lg font-bold tracking-tight">
            Aurora Café
          </a>
          <div className="flex items-center gap-5 text-sm">
            <a href="/#productos" className="hover:underline">
              Tienda
            </a>
            <a href="/pedido" className="hover:underline">
              Mi pedido
            </a>
            <CartButton />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 md:py-12">{children}</main>
      <footer className="border-t border-[var(--sb-border)] py-8 text-center text-sm text-[var(--sb-muted)]">
        Aurora Café · Tienda hecha con{' '}
        <a href="https://github.com/jlgavel011/sellbase" className="underline">
          Sellbase
        </a>
      </footer>
      <CartDrawer cartHref="/carrito" />
    </SellbaseStoreProvider>
  );
}
