'use client';

/*
 * Sellbase · cart-page
 * A full cart page (e.g. /carrito): lines with quantities, discount code, totals and the
 * button to checkout. Same data as the drawer, more room.
 * AI: add upsells or trust badges around it; keep totals from the server.
 */
import { useCart } from '@sellbase/react';
import { CartLines, CartTotals } from './cart-lines';
import { DiscountInput } from './discount-input';

export function CartPage({
  checkoutHref = '/checkout',
  continueHref = '/',
  productHref,
}: {
  checkoutHref?: string;
  continueHref?: string;
  productHref?: (slug: string) => string;
}) {
  const cart = useCart();
  if (cart.isLoading)
    return (
      <div
        className="h-64 animate-pulse rounded-[var(--sb-radius)] bg-[var(--sb-border)]"
        aria-busy="true"
      />
    );
  const hasItems = (cart.cart?.items.length ?? 0) > 0;
  const unavailable = cart.cart?.items.some((i) => !i.available) ?? false;

  return (
    <div className="grid gap-8 text-[var(--sb-fg)] md:grid-cols-[1fr_20rem]">
      <section aria-labelledby="sb-cart-page-title">
        <h1 id="sb-cart-page-title" className="mb-6 text-2xl font-semibold">
          Tu carrito
        </h1>
        <CartLines size="lg" {...(productHref ? { productHref } : {})} />
        {!hasItems && (
          <a href={continueHref} className="mt-4 inline-block underline">
            Seguir comprando
          </a>
        )}
      </section>
      {hasItems && (
        <aside className="flex h-fit flex-col gap-4 rounded-[var(--sb-radius)] border border-[var(--sb-border)] p-4">
          <DiscountInput />
          <CartTotals />
          {unavailable && (
            <p role="alert" className="text-sm text-[var(--sb-danger)]">
              Hay productos sin stock suficiente. Ajusta el carrito para continuar.
            </p>
          )}
          {unavailable ? (
            <span className="rounded-[var(--sb-radius)] bg-[var(--sb-border)] py-3 text-center font-medium text-[var(--sb-muted)]">
              Ir a pagar
            </span>
          ) : (
            <a
              href={checkoutHref}
              className="rounded-[var(--sb-radius)] bg-[var(--sb-primary)] py-3 text-center font-medium text-[var(--sb-primary-fg)]"
            >
              Ir a pagar
            </a>
          )}
          <a href={continueHref} className="text-center text-sm underline">
            Seguir comprando
          </a>
        </aside>
      )}
    </div>
  );
}
