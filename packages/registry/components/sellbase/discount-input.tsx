'use client';

/*
 * Sellbase · discount-input
 * Applies a discount code to the cart and lists the applied ones. The server decides if
 * the code is valid and explains why not (the message shows under the field).
 * AI: restyle freely; never validate or compute discounts in the browser.
 */
import { useCart } from '@sellbase/react';
import { useId, useState } from 'react';

export function DiscountInput() {
  const cart = useCart();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const applied = cart.cart?.discount_codes ?? [];
  const rejected = cart.cart?.rejected_discounts ?? [];

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const value = code.trim();
          if (!value) return;
          setError(null);
          try {
            await cart.applyDiscount(value);
            setCode('');
          } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo aplicar el código.');
          }
        }}
      >
        <label htmlFor={id} className="sr-only">
          Código de descuento
        </label>
        <input
          id={id}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Código de descuento"
          autoComplete="off"
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-w-0 flex-1 rounded-md border border-[var(--sb-border)] bg-transparent px-3 py-2 text-sm uppercase"
        />
        <button
          type="submit"
          className="rounded-md border border-[var(--sb-border)] px-3 text-sm disabled:opacity-50"
          disabled={cart.isUpdating || !code.trim()}
        >
          Aplicar
        </button>
      </form>
      <div aria-live="polite" className="flex flex-col gap-1 text-sm">
        {error && (
          <p id={`${id}-error`} role="alert" className="text-[var(--sb-danger)]">
            {error}
          </p>
        )}
        {applied.map((c) => {
          const problem = rejected.find((r) => r.code === c);
          return (
            <p key={c} className="flex items-center justify-between gap-2">
              <span className={problem ? 'text-[var(--sb-danger)]' : 'text-[var(--sb-success)]'}>
                {problem ? `${c}: ${problem.hint}` : `Código ${c} aplicado`}
              </span>
              <button
                type="button"
                className="underline"
                onClick={() => cart.removeDiscount(c)}
                aria-label={`Quitar el código ${c}`}
              >
                Quitar
              </button>
            </p>
          );
        })}
      </div>
    </div>
  );
}
