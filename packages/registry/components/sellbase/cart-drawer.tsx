'use client';

/*
 * Sellbase · cart-drawer
 * <CartButton /> shows the item count and opens <CartDrawer />, a side panel with the
 * cart lines, discount code and totals computed by the server. Put both once in your
 * layout. `checkoutHref` points to the page with <Checkout />, `cartHref` (optional) to
 * a full <CartPage />.
 * AI: restyle the panel (side, width, animation). Keep: focus moves into the panel and
 * back to the button on close, Escape closes it, totals come from the server.
 */
import { useCart, useCartDrawer } from '@sellbase/react';
import { useEffect, useRef } from 'react';
import { CartLines, CartTotals } from './cart-lines';
import { DiscountInput } from './discount-input';

export function CartButton({ className = '' }: { className?: string }) {
  const { itemCount } = useCart();
  const { toggle, open } = useCartDrawer();
  return (
    <button
      type="button"
      onClick={toggle}
      data-sellbase-cart-button
      className={`relative rounded-full px-3 py-2 ${className}`}
      aria-label={`Carrito, ${itemCount} ${itemCount === 1 ? 'artículo' : 'artículos'}`}
      aria-expanded={open}
      aria-haspopup="dialog"
    >
      <span aria-hidden>🛒</span>
      {itemCount > 0 && (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 min-w-5 rounded-full bg-[var(--sb-primary)] px-1 text-center text-xs text-[var(--sb-primary-fg)]"
        >
          {itemCount}
        </span>
      )}
    </button>
  );
}

export function CartDrawer({
  checkoutHref = '/checkout',
  cartHref,
  productHref,
}: {
  checkoutHref?: string;
  cartHref?: string;
  productHref?: (slug: string) => string;
}) {
  const { open, setOpen } = useCartDrawer();
  const cart = useCart();
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      // Keep Tab inside the panel while it is open.
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled])',
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      (previous ?? document.querySelector<HTMLElement>('[data-sellbase-cart-button]'))?.focus();
    };
  }, [open, setOpen]);

  if (!open) return null;
  const hasItems = (cart.cart?.items.length ?? 0) > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sb-cart-title"
    >
      {/* Backdrop: a mouse shortcut only; keyboard and screen readers use ✕ or Escape. */}
      <div aria-hidden className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
      <aside
        ref={panelRef}
        className="relative flex h-full w-full max-w-md flex-col bg-[var(--sb-bg)] text-[var(--sb-fg)] shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-[var(--sb-border)] p-4">
          <h2 id="sb-cart-title" className="text-lg font-semibold">
            Tu carrito
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar carrito"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          <CartLines {...(productHref ? { productHref } : {})} />
        </div>

        {hasItems && (
          <footer className="flex flex-col gap-3 border-t border-[var(--sb-border)] p-4">
            <DiscountInput />
            <CartTotals />
            <a
              href={checkoutHref}
              className="rounded-[var(--sb-radius)] bg-[var(--sb-primary)] py-3 text-center font-medium text-[var(--sb-primary-fg)]"
            >
              Ir a pagar
            </a>
            {cartHref && (
              <a href={cartHref} className="text-center text-sm underline">
                Ver carrito completo
              </a>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}
