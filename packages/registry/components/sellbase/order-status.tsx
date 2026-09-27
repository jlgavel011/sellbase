'use client';

/*
 * Sellbase · order-status
 * Two components for after the purchase:
 * - <CheckoutReturn />: the page the buyer lands on after paying (e.g. /gracias). It reads
 *   ?sellbase_checkout=<id>, shows "Confirmando tu pago…" until the payment webhook
 *   arrives (it can come before or after the buyer), then the order summary, and clears
 *   the cart.
 * - <OrderLookup />: "¿Dónde está mi pedido?": number + email → status, items, tracking and
 *   appointments.
 * AI: restyle and reword freely; never show order data that did not come from the API.
 */
import {
  formatMoney,
  useCart,
  useCheckoutStatus,
  useOrderLookup,
  type OrderSummary,
} from '@sellbase/react';
import { useEffect, useId, useState } from 'react';

const STATUS: Record<string, string> = {
  unfulfilled: 'En preparación',
  partially_fulfilled: 'Enviado en parte',
  fulfilled: 'Entregado o enviado',
};

export function OrderSummaryCard({ order }: { order: OrderSummary }) {
  const money = (n: number) => formatMoney(n, order.currency);
  const when = (iso: string, tz: string) =>
    new Intl.DateTimeFormat('es-MX', {
      timeZone: tz,
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(iso));
  const due = order.total_amount - order.amount_paid;
  return (
    <div className="flex flex-col gap-4 text-left">
      <p>
        Pedido <strong>#{order.number}</strong> ·{' '}
        {order.status === 'cancelled' ? 'Cancelado' : STATUS[order.fulfillment_status]}
      </p>
      <ul className="divide-y divide-[var(--sb-border)] rounded-[var(--sb-radius)] border border-[var(--sb-border)]">
        {order.items.map((item, i) => (
          <li key={i} className="flex justify-between gap-3 p-3 text-sm">
            <span>
              {item.quantity > 1 ? `${item.quantity} × ` : ''}
              {item.title}
              {item.variant_title ? ` (${item.variant_title})` : ''}
            </span>
            <span>{money(item.total_amount)}</span>
          </li>
        ))}
        {order.discount_amount > 0 && (
          <li className="flex justify-between p-3 text-sm text-[var(--sb-success)]">
            <span>Descuento</span>
            <span>−{money(order.discount_amount)}</span>
          </li>
        )}
        {order.shipping_amount > 0 && (
          <li className="flex justify-between p-3 text-sm">
            <span>Envío</span>
            <span>{money(order.shipping_amount)}</span>
          </li>
        )}
        <li className="flex justify-between p-3 font-semibold">
          <span>Total</span>
          <span>{money(order.total_amount)}</span>
        </li>
      </ul>
      {due > 0 && order.status !== 'cancelled' && (
        <p className="text-sm">
          Pagaste {money(order.amount_paid)} de anticipo; quedan {money(due)} por pagar.
        </p>
      )}
      {order.bookings.map((b, i) => (
        <p key={i} className="rounded-[var(--sb-radius)] bg-[var(--sb-card)] p-3 text-sm">
          📅 <strong>{b.title}</strong>: {when(b.starts_at, b.timezone)}
          {b.meeting_url ? (
            <>
              {' · '}
              <a href={b.meeting_url} className="underline">
                Enlace de la sesión
              </a>
            </>
          ) : null}
        </p>
      ))}
      {order.shipments.map((s, i) => (
        <p key={i} className="text-sm">
          📦 Enviado{s.carrier ? ` con ${s.carrier}` : ''}
          {s.tracking_number ? ` · guía ${s.tracking_number}` : ''}
          {s.tracking_url ? (
            <>
              {' · '}
              <a href={s.tracking_url} className="underline">
                Rastrear
              </a>
            </>
          ) : null}
        </p>
      ))}
      {order.has_downloads && (
        <p className="text-sm">⬇ Te enviamos los enlaces de descarga a {order.email}.</p>
      )}
    </div>
  );
}

export function CheckoutReturn({
  cartHref = '/carrito',
  homeHref = '/',
}: {
  cartHref?: string;
  homeHref?: string;
}) {
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  useEffect(() => {
    setCheckoutId(new URLSearchParams(window.location.search).get('sellbase_checkout'));
  }, []);
  const { data, error } = useCheckoutStatus(checkoutId);
  const { clear } = useCart();
  useEffect(() => {
    if (data?.status === 'paid') clear();
  }, [data?.status, clear]);

  let body;
  if (!checkoutId || error) {
    body = <p>¡Gracias por tu compra! Revisa tu correo: ahí llega la confirmación de tu pedido.</p>;
  } else if (!data || data.status === 'pending') {
    body = (
      <p className="flex items-center justify-center gap-2" role="status">
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--sb-border)] border-t-[var(--sb-primary)]"
          aria-hidden
        />
        Confirmando tu pago…
      </p>
    );
  } else if (data.status === 'expired') {
    body = (
      <div className="flex flex-col items-center gap-3">
        <p>El pago no se completó y la reserva expiró. No se hizo ningún cargo.</p>
        <a href={cartHref} className="underline">
          Volver al carrito
        </a>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-6">
        <p className="text-lg">¡Listo! Tu pago se confirmó.</p>
        {data.order && <OrderSummaryCard order={data.order} />}
        <a href={homeHref} className="underline">
          Seguir comprando
        </a>
      </div>
    );
  }

  return (
    <section
      className="mx-auto max-w-lg py-12 text-center text-[var(--sb-fg)]"
      aria-live="polite"
      data-sellbase-checkout-return
    >
      <h1 className="mb-6 text-2xl font-semibold">Gracias por tu compra</h1>
      {body}
    </section>
  );
}

export function OrderLookup() {
  const { lookup, order, isPending, error, reset } = useOrderLookup();
  const [number, setNumber] = useState('');
  const [email, setEmail] = useState('');
  const id = useId();
  return (
    <section className="mx-auto flex max-w-lg flex-col gap-6 py-12 text-[var(--sb-fg)]">
      <h1 className="text-2xl font-semibold">¿Dónde está mi pedido?</h1>
      <form
        className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          reset();
          void lookup({ number: Number(number.replace('#', '')), email }).catch(() => undefined);
        }}
      >
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-n`}>
          Pedido
          <input
            id={`${id}-n`}
            required
            inputMode="numeric"
            placeholder="#1001"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className="rounded-md border border-[var(--sb-border)] bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-e`}>
          Correo de la compra
          <input
            id={`${id}-e`}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-[var(--sb-border)] bg-transparent px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-[var(--sb-radius)] bg-[var(--sb-primary)] px-4 py-2 font-medium text-[var(--sb-primary-fg)] disabled:opacity-50"
        >
          Buscar
        </button>
      </form>
      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-[var(--sb-danger)]">
            {error.code === 'RATE_LIMITED'
              ? 'Demasiados intentos. Espera un minuto.'
              : 'No encontramos un pedido con ese número y correo.'}
          </p>
        )}
        {order && <OrderSummaryCard order={order} />}
      </div>
    </section>
  );
}
