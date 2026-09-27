'use client';

/*
 * Sellbase · cart-drawer
 * <CartButton /> shows the item count and opens <CartDrawer />, a side panel with the
 * cart lines, quantities, discount code and totals computed by the server.
 * Put both once in your layout. `checkoutHref` must point to the page with <Checkout />.
 * AI: restyle the panel (side, width, animation) but keep totals from `cart.totals`:
 * never compute prices in the browser.
 */
import { useCart, useCartDrawer } from '@sellbase/react';
import { useEffect, useState } from 'react';

export function CartButton({ className = '' }: { className?: string }) {
  const { itemCount } = useCart();
  const { toggle } = useCartDrawer();
  return (
    <button
      type="button"
      onClick={toggle}
      className={`relative rounded-full px-3 py-2 ${className}`}
      aria-label={`Carrito, ${itemCount} artículos`}
    >
      <span aria-hidden>🛒</span>
      {itemCount > 0 && (
        <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-[var(--sb-primary)] px-1 text-center text-xs text-[var(--sb-primary-fg)]">
          {itemCount}
        </span>
      )}
    </button>
  );
}

export function CartDrawer({ checkoutHref = '/checkout' }: { checkoutHref?: string }) {
  const { open, setOpen } = useCartDrawer();
  const cart = useCart();
  const [code, setCode] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  if (!open) return null;
  const items = cart.cart?.items ?? [];
  const totals = cart.cart?.totals;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Carrito"
    >
      <button
        type="button"
        aria-label="Cerrar carrito"
        className="absolute inset-0 bg-black/40"
        onClick={() => setOpen(false)}
      />
      <aside className="relative flex h-full w-full max-w-md flex-col bg-[var(--sb-bg)] text-[var(--sb-fg)] shadow-xl">
        <header className="flex items-center justify-between border-b border-[var(--sb-border)] p-4">
          <h2 className="text-lg font-semibold">Tu carrito</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4" aria-live="polite">
          {items.length === 0 ? (
            <p className="text-[var(--sb-muted)]">Tu carrito está vacío.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {items.map((item) => (
                <li key={item.id} className="flex gap-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-[var(--sb-border)]">
                    {item.image_url && (
                      <img src={item.image_url} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="flex flex-1 flex-col">
                    <span className="font-medium">{item.title}</span>
                    {item.variant_title && (
                      <span className="text-sm text-[var(--sb-muted)]">{item.variant_title}</span>
                    )}
                    {item.booking && (
                      <span className="text-sm text-[var(--sb-muted)]">
                        {new Intl.DateTimeFormat('es-MX', {
                          timeZone: item.booking.timezone,
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(new Date(item.booking.starts_at))}
                        {item.booking.resource_name ? ` · ${item.booking.resource_name}` : ''}
                      </span>
                    )}
                    {!item.available && (
                      <span className="text-sm text-[var(--sb-danger)]">Sin stock suficiente</span>
                    )}
                    {item.booking ? (
                      <button
                        type="button"
                        className="mt-1 self-start text-sm underline"
                        disabled={cart.isUpdating}
                        onClick={() => cart.removeItem(item.id)}
                      >
                        Quitar
                      </button>
                    ) : (
                      <div className="mt-1 flex items-center gap-2">
                        <button
                          type="button"
                          aria-label={`Quitar uno de ${item.title}`}
                          disabled={cart.isUpdating}
                          onClick={() =>
                            item.quantity > 1
                              ? cart.updateItem(item.id, item.quantity - 1)
                              : cart.removeItem(item.id)
                          }
                          className="h-7 w-7 rounded border border-[var(--sb-border)]"
                        >
                          −
                        </button>
                        <span aria-label="Cantidad">{item.quantity}</span>
                        <button
                          type="button"
                          aria-label={`Agregar uno de ${item.title}`}
                          disabled={cart.isUpdating}
                          onClick={() => cart.updateItem(item.id, item.quantity + 1)}
                          className="h-7 w-7 rounded border border-[var(--sb-border)]"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <span>{cart.format(item.total_amount)}</span>
                    {item.discount_amount > 0 && (
                      <s className="block text-xs text-[var(--sb-muted)]">
                        {cart.format(item.subtotal_amount)}
                      </s>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && totals && (
          <footer className="flex flex-col gap-3 border-t border-[var(--sb-border)] p-4">
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!code.trim()) return;
                await cart
                  .applyDiscount(code.trim())
                  .then(() => setCode(''))
                  .catch(() => undefined);
              }}
            >
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Código de descuento"
                aria-label="Código de descuento"
                className="flex-1 rounded-md border border-[var(--sb-border)] px-3 py-2 text-sm uppercase"
              />
              <button
                type="submit"
                className="rounded-md border border-[var(--sb-border)] px-3 text-sm"
                disabled={cart.isUpdating}
              >
                Aplicar
              </button>
            </form>
            {cart.error?.hint && (
              <p role="alert" className="text-sm text-[var(--sb-danger)]">
                {cart.error.message}
              </p>
            )}
            {cart.cart?.discount_codes.map((c) => (
              <p key={c} className="flex justify-between text-sm">
                <span>Código {c}</span>
                <button type="button" className="underline" onClick={() => cart.removeDiscount(c)}>
                  Quitar
                </button>
              </p>
            ))}
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd>{cart.format(totals.subtotal_amount)}</dd>
              </div>
              {totals.discount_amount > 0 && (
                <div className="flex justify-between text-[var(--sb-success)]">
                  <dt>Descuento</dt>
                  <dd>−{cart.format(totals.discount_amount)}</dd>
                </div>
              )}
              <div className="flex justify-between text-base font-semibold">
                <dt>Total</dt>
                <dd>{cart.format(totals.total_amount)}</dd>
              </div>
              {cart.cart?.requires_shipping && (
                <p className="text-[var(--sb-muted)]">El envío se calcula al pagar.</p>
              )}
            </dl>
            <a
              href={checkoutHref}
              className="rounded-[var(--sb-radius)] bg-[var(--sb-primary)] py-3 text-center font-medium text-[var(--sb-primary-fg)]"
            >
              Ir a pagar
            </a>
          </footer>
        )}
      </aside>
    </div>
  );
}
