'use client';

/*
 * Sellbase · product-detail
 * Product page body: gallery, title, price, variant picker, availability and "Add to cart".
 * Variants come from the API; options (e.g. Talla, Color) are built from them.
 * AI: rearrange the layout, add sections (reviews, FAQs) around it, change button copy.
 * Keep the availability check: the server also refuses out-of-stock checkouts.
 */
import {
  formatMoney,
  useCart,
  useCartDrawer,
  useProduct,
  type StorefrontProduct,
} from '@sellbase/react';
import { useMemo, useState } from 'react';

type Variant = StorefrontProduct['variants'][number];

function pickVariant(variants: Variant[], selected: Record<string, string>) {
  return (
    variants.find((v) =>
      Object.entries(selected).every(([k, val]) => v.option_values[k] === val),
    ) ?? null
  );
}

export function ProductDetail({ slug }: { slug: string }) {
  const { data: product, isLoading, error } = useProduct(slug);
  const cart = useCart();
  const drawer = useCartDrawer();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);

  const variant = useMemo(() => {
    if (!product) return null;
    if (product.variants.length === 1) return product.variants[0] ?? null;
    return pickVariant(product.variants, selected);
  }, [product, selected]);

  if (isLoading)
    return (
      <div
        className="h-96 animate-pulse rounded-[var(--sb-radius)] bg-[var(--sb-border)]"
        aria-busy="true"
      />
    );
  if (error || !product) return <p role="alert">Este producto no está disponible.</p>;

  const image = product.media.find((m) => m.variant_id === variant?.id) ?? product.media[0];
  const allChosen = product.options.every((o) => selected[o.name]);
  const canAdd = Boolean(variant?.available) && !cart.isUpdating;

  async function add() {
    if (!variant) return;
    await cart.addItem(variant.id, quantity);
    drawer.setOpen(true);
  }

  return (
    <div className="grid gap-8 text-[var(--sb-fg)] md:grid-cols-2">
      <div className="aspect-square overflow-hidden rounded-[var(--sb-radius)] bg-[var(--sb-border)]">
        {image ? (
          <img
            src={image.url}
            alt={image.alt || product.title}
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-3xl font-semibold">{product.title}</h1>
          <p className="mt-2 text-xl" aria-live="polite">
            {variant
              ? formatMoney(variant.price_amount, variant.currency)
              : product.min_price_amount !== null && product.currency
                ? `Desde ${formatMoney(product.min_price_amount, product.currency)}`
                : null}
            {variant?.compare_at_amount ? (
              <s className="ml-2 text-base text-[var(--sb-muted)]">
                {formatMoney(variant.compare_at_amount, variant.currency)}
              </s>
            ) : null}
          </p>
        </div>

        {product.options.map((option) => (
          <fieldset key={option.name}>
            <legend className="mb-2 text-sm font-medium">{option.name}</legend>
            <div className="flex flex-wrap gap-2">
              {option.values.map((value) => {
                const active = selected[option.name] === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelected({ ...selected, [option.name]: value })}
                    className={`rounded-full border px-4 py-1.5 text-sm ${active ? 'border-[var(--sb-primary)] bg-[var(--sb-primary)] text-[var(--sb-primary-fg)]' : 'border-[var(--sb-border)]'}`}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        {product.type === 'physical' && (
          <label className="flex items-center gap-3 text-sm">
            Cantidad
            <input
              type="number"
              min={1}
              max={variant?.available_quantity ?? 99}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 rounded-md border border-[var(--sb-border)] px-2 py-1"
            />
          </label>
        )}

        <button
          type="button"
          onClick={add}
          disabled={!canAdd}
          className="rounded-[var(--sb-radius)] bg-[var(--sb-primary)] px-6 py-3 font-medium text-[var(--sb-primary-fg)] disabled:opacity-50"
        >
          {!allChosen && product.options.length
            ? 'Elige una opción'
            : variant?.available === false
              ? 'Agotado'
              : cart.isUpdating
                ? 'Agregando…'
                : 'Agregar al carrito'}
        </button>
        {variant?.available_quantity !== null &&
          variant?.available_quantity !== undefined &&
          variant.available_quantity > 0 &&
          variant.available_quantity <= 5 && (
            <p className="text-sm text-[var(--sb-muted)]">
              Solo quedan {variant.available_quantity}.
            </p>
          )}
        {cart.error && (
          <p role="alert" className="text-sm text-[var(--sb-danger)]">
            {cart.error.message}
          </p>
        )}

        {product.description && (
          <p className="whitespace-pre-line leading-relaxed text-[var(--sb-muted)]">
            {product.description}
          </p>
        )}
      </div>
    </div>
  );
}
