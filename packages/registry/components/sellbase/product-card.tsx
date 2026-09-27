'use client';

/*
 * Sellbase · product-card
 * One product tile: image, title and price (or price range). Data always comes from the
 * API via useProducts/useProduct; never hardcode products or prices.
 * AI: restyle freely (layout, typography, hover effects). Keep `formatMoney` for prices:
 * amounts are integers in cents.
 */
import { formatMoney, type StorefrontProductSummary } from '@sellbase/react';

export function ProductCard({
  product,
  href,
}: {
  product: StorefrontProductSummary;
  href: string;
}) {
  const { min_price_amount: min, max_price_amount: max, currency } = product;
  const price =
    min === null || !currency
      ? null
      : min === max
        ? formatMoney(min, currency)
        : `${formatMoney(min, currency)} – ${formatMoney(max ?? min, currency)}`;

  return (
    <a
      href={href}
      className="group flex flex-col overflow-hidden rounded-[var(--sb-radius)] border border-[var(--sb-border)] bg-[var(--sb-card)] text-[var(--sb-fg)] transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-[var(--sb-primary)]"
    >
      <div className="aspect-square w-full overflow-hidden bg-[var(--sb-border)]">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.image_alt ?? product.title}
            className="h-full w-full object-cover transition group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div
            className="flex h-full items-center justify-center text-4xl text-[var(--sb-muted)]"
            aria-hidden
          >
            {product.type === 'digital' ? '⬇' : '◻'}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="font-medium leading-snug">{product.title}</h3>
        {price && <p className="text-[var(--sb-muted)]">{price}</p>}
      </div>
    </a>
  );
}
