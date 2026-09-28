'use client';

/*
 * Sellbase · checkout
 * Email, shipping address (only when something ships), shipping option and order summary,
 * then redirects to the payment provider. The order is created by the payment webhook,
 * never by this page. `successPath` must exist (e.g. /gracias) and should call
 * `useCart().clear()`.
 * AI: restyle and reorder fields freely; keep the fields the API requires (email, and the
 * address + shipping option when `cart.requires_shipping`). Services with a deposit offer
 * "pay deposit / pay total" (pay_mode).
 */
import { useCart, useCheckout, useShippingRates, type Address } from '@sellbase/react';
import { useEffect, useState, type FormEvent } from 'react';

const input = 'w-full rounded-md border border-[var(--sb-border)] bg-[var(--sb-bg)] px-3 py-2';

export function Checkout({
  successPath = '/gracias',
  cancelPath = '/checkout',
  defaultCountry = 'MX',
}: {
  successPath?: string;
  cancelPath?: string;
  defaultCountry?: string;
}) {
  const cart = useCart();
  const checkout = useCheckout();
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState<Address>({
    first_name: '',
    line1: '',
    city: '',
    state: '',
    postal_code: '',
    country: defaultCountry,
  });
  const [quotedAddress, setQuotedAddress] = useState<Address | undefined>(undefined);
  const [rateId, setRateId] = useState<string | null>(null);
  const [payMode, setPayMode] = useState<'full' | 'deposit'>('full');

  const needsShipping = Boolean(cart.cart?.requires_shipping);
  const addressReady = Boolean(
    address.line1 && address.city && address.postal_code && address.country,
  );

  // Re-quote shipping only when the address settles, not on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuotedAddress(addressReady ? address : undefined), 500);
    return () => clearTimeout(t);
  }, [address, addressReady]);

  const rates = useShippingRates(needsShipping ? cart.token : null, quotedAddress);
  const options = rates.data?.rates ?? [];
  const rate = options.find((r) => r.id === rateId) ?? null;
  useEffect(() => {
    if (!rateId && options[0]) setRateId(options[0].id);
  }, [options, rateId]);

  if (cart.isLoading) return <p aria-busy="true">Cargando…</p>;
  if (!cart.cart || cart.cart.items.length === 0) return <p>Tu carrito está vacío.</p>;
  const totals = cart.cart.totals;
  const shippingAmount = needsShipping ? (rate?.amount ?? 0) : 0;
  const addressRequired = needsShipping && (rate?.requires_address ?? true);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!cart.token) return;
    const origin = window.location.origin;
    await checkout
      .start({
        cart_token: cart.token,
        email,
        ...(needsShipping && rateId ? { shipping_rate_id: rateId } : {}),
        ...(addressRequired ? { shipping_address: address } : {}),
        ...(payMode === 'deposit' ? { pay_mode: 'deposit' as const } : {}),
        success_url: `${origin}${successPath}`,
        cancel_url: `${origin}${cancelPath}`,
      })
      .catch(() => undefined); // shown below via checkout.error
  }

  const field = (key: keyof Address, label: string, autoComplete: string, required = true) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        className={input}
        required={required}
        autoComplete={autoComplete}
        value={address[key] ?? ''}
        onChange={(e) => setAddress({ ...address, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <form onSubmit={submit} className="grid gap-8 text-[var(--sb-fg)] md:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Contacto</h2>
          <label className="flex flex-col gap-1 text-sm">
            Correo electrónico
            <input
              type="email"
              required
              autoComplete="email"
              className={input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        </section>

        {needsShipping && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Envío</h2>
            {options.length > 0 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">Opciones de envío</legend>
                {options.map((r) => (
                  <label
                    key={r.id}
                    className="flex items-center justify-between rounded-md border border-[var(--sb-border)] p-3 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="rate"
                        checked={rateId === r.id}
                        onChange={() => setRateId(r.id)}
                      />
                      {r.service}
                    </span>
                    <span>{r.amount ? cart.format(r.amount) : 'Gratis'}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {addressRequired && (
              <div className="grid gap-3 sm:grid-cols-2">
                {field('first_name', 'Nombre', 'given-name')}
                {field('last_name', 'Apellidos', 'family-name', false)}
                <div className="sm:col-span-2">
                  {field('line1', 'Calle y número', 'address-line1')}
                </div>
                <div className="sm:col-span-2">
                  {field('line2', 'Colonia, depto. (opcional)', 'address-line2', false)}
                </div>
                {field('city', 'Ciudad', 'address-level2')}
                {field('state', 'Estado', 'address-level1')}
                {field('postal_code', 'Código postal', 'postal-code')}
                {field('phone', 'Teléfono', 'tel', false)}
              </div>
            )}
          </section>
        )}
      </div>

      <aside className="flex h-fit flex-col gap-3 rounded-[var(--sb-radius)] border border-[var(--sb-border)] p-5">
        <h2 className="text-lg font-semibold">Resumen</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {cart.cart.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-2">
              <span>
                {i.title}
                {i.variant_title ? ` — ${i.variant_title}` : ''}
                {i.booking ? '' : ` × ${i.quantity}`}
                {i.booking && (
                  <span className="block text-xs text-[var(--sb-muted)]">
                    {new Intl.DateTimeFormat('es-MX', {
                      timeZone: i.booking.timezone,
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(i.booking.starts_at))}
                  </span>
                )}
              </span>
              <span>{cart.format(i.total_amount)}</span>
            </li>
          ))}
        </ul>
        <dl className="flex flex-col gap-1 border-t border-[var(--sb-border)] pt-3 text-sm">
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
          {needsShipping && (
            <div className="flex justify-between">
              <dt>Envío</dt>
              <dd>{rate ? (shippingAmount ? cart.format(shippingAmount) : 'Gratis') : '—'}</dd>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold">
            <dt>Total</dt>
            <dd data-testid="checkout-total">
              {cart.format(totals.total_amount + shippingAmount)}
            </dd>
          </div>
          {totals.tax_amount > 0 && totals.tax_mode === 'inclusive' && (
            <div className="flex justify-between text-xs text-[var(--sb-muted)]">
              <dt>Impuestos</dt>
              <dd>Incluidos</dd>
            </div>
          )}
          {payMode === 'deposit' && totals.deposit_amount !== null && (
            <div className="flex justify-between font-semibold text-[var(--sb-primary)]">
              <dt>Pagas hoy</dt>
              <dd data-testid="checkout-due-now">
                {cart.format(totals.deposit_amount + shippingAmount)}
              </dd>
            </div>
          )}
        </dl>
        {totals.deposit_amount !== null && (
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">¿Cómo quieres pagar?</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="pay_mode"
                checked={payMode === 'deposit'}
                onChange={() => setPayMode('deposit')}
              />
              Anticipo de {cart.format(totals.deposit_amount)} (el resto después)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="pay_mode"
                checked={payMode === 'full'}
                onChange={() => setPayMode('full')}
              />
              Total ({cart.format(totals.total_amount + shippingAmount)})
            </label>
          </fieldset>
        )}
        {checkout.error && (
          <p role="alert" className="text-sm text-[var(--sb-danger)]">
            {checkout.error.message} {checkout.error.hint}
          </p>
        )}
        <button
          type="submit"
          disabled={checkout.isPending || (needsShipping && !rateId)}
          className="rounded-[var(--sb-radius)] bg-[var(--sb-primary)] py-3 font-medium text-[var(--sb-primary-fg)] disabled:opacity-50"
        >
          {checkout.isPending ? 'Redirigiendo al pago…' : 'Pagar'}
        </button>
        <p className="text-center text-xs text-[var(--sb-muted)]">
          Pago seguro. Tu pedido se confirma al completar el pago.
        </p>
      </aside>
    </form>
  );
}
