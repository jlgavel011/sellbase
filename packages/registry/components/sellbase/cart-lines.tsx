'use client';

/*
 * Sellbase · cart-lines
 * <CartLines /> lists the cart (image, title, variant, appointment time, quantity
 * controls, line total) and <CartTotals /> shows the totals computed by the server.
 * Used by cart-drawer and cart-page.
 * AI: change the markup and styles; keep amounts from the API (`cart.format`), never
 * compute prices in the browser.
 */
import { useCart } from '@sellbase/react';

export function CartLines({
  size = 'sm',
  productHref = (slug) => `/productos/${slug}`,
}: {
  size?: 'sm' | 'lg';
  productHref?: (slug: string) => string;
}) {
  const cart = useCart();
  const items = cart.cart?.items ?? [];
  const image = size === 'lg' ? 'h-24 w-24' : 'h-16 w-16';
  if (items.length === 0) return <p className="text-[var(--sb-muted)]">Tu carrito está vacío.</p>;

  return (
    <ul className="flex flex-col divide-y divide-[var(--sb-border)]" aria-live="polite">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3 py-4 first:pt-0">
          <div className={`${image} shrink-0 overflow-hidden rounded-md bg-[var(--sb-border)]`}>
            {item.image_url && (
              <img src={item.image_url} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <a href={productHref(item.product_slug)} className="font-medium hover:underline">
              {item.title}
            </a>
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
              <span className="text-sm text-[var(--sb-danger)]">
                Sin stock suficiente: baja la cantidad o quítalo.
              </span>
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
                  className="h-8 w-8 rounded border border-[var(--sb-border)]"
                >
                  −
                </button>
                <span aria-label={`Cantidad de ${item.title}`}>{item.quantity}</span>
                <button
                  type="button"
                  aria-label={`Agregar uno de ${item.title}`}
                  disabled={cart.isUpdating}
                  onClick={() => cart.updateItem(item.id, item.quantity + 1)}
                  className="h-8 w-8 rounded border border-[var(--sb-border)]"
                >
                  +
                </button>
                {size === 'lg' && (
                  <button
                    type="button"
                    className="ml-3 text-sm underline"
                    disabled={cart.isUpdating}
                    onClick={() => cart.removeItem(item.id)}
                  >
                    Quitar
                  </button>
                )}
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
  );
}

export function CartTotals() {
  const cart = useCart();
  const totals = cart.cart?.totals;
  if (!totals) return null;
  return (
    <div className="flex flex-col gap-1 text-sm" aria-live="polite">
      <dl className="flex flex-col gap-1">
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
        {totals.tax_mode === 'exclusive' && totals.tax_amount > 0 && (
          <div className="flex justify-between">
            <dt>Impuestos</dt>
            <dd>{cart.format(totals.tax_amount)}</dd>
          </div>
        )}
        <div className="flex justify-between text-base font-semibold">
          <dt>Total</dt>
          <dd>{cart.format(totals.total_amount)}</dd>
        </div>
      </dl>
      {totals.tax_mode === 'inclusive' && totals.tax_amount > 0 && (
        <p className="text-xs text-[var(--sb-muted)]">
          Incluye {cart.format(totals.tax_amount)} de impuestos.
        </p>
      )}
      {cart.cart?.requires_shipping && (
        <p className="text-xs text-[var(--sb-muted)]">El envío se calcula al pagar.</p>
      )}
      {cart.cart?.totals.deposit_amount ? (
        <p className="text-xs text-[var(--sb-muted)]">
          Puedes pagar solo el anticipo ({cart.format(cart.cart.totals.deposit_amount)}) al pagar.
        </p>
      ) : null}
    </div>
  );
}
