'use client';

/*
 * Sellbase · product-carousel
 * A horizontal row of products (e.g. "Lo más vendido" on the home page) that scrolls
 * with touch, trackpad or the arrow buttons. Props: `collection` (slug), `title`,
 * `limit`, `hrefFor`.
 * AI: restyle the arrows, card width and heading; keep it a list so screen readers know
 * how many products there are.
 */
import { useCollection, useProducts } from '@sellbase/react';
import { useRef } from 'react';
import { ProductCard } from './product-card';

export function ProductCarousel({
  collection,
  title,
  limit = 12,
  hrefFor = (slug: string) => `/productos/${slug}`,
}: {
  collection?: string;
  title?: string;
  limit?: number;
  hrefFor?: (slug: string) => string;
}) {
  const { data, isLoading, error } = useProducts({ limit, ...(collection ? { collection } : {}) });
  const info = useCollection(collection);
  const track = useRef<HTMLUListElement>(null);
  const heading = title ?? info.data?.title ?? 'Productos';
  const scroll = (direction: 1 | -1) =>
    track.current?.scrollBy({
      left: direction * track.current.clientWidth * 0.8,
      behavior: 'smooth',
    });

  if (error) return null; // a carousel is decoration: hide it rather than break the page
  return (
    <section aria-labelledby={`sb-carousel-${collection ?? 'all'}`} className="text-[var(--sb-fg)]">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 id={`sb-carousel-${collection ?? 'all'}`} className="text-xl font-semibold">
          {heading}
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => scroll(-1)}
            aria-label={`Anteriores en ${heading}`}
            className="h-9 w-9 rounded-full border border-[var(--sb-border)]"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => scroll(1)}
            aria-label={`Siguientes en ${heading}`}
            className="h-9 w-9 rounded-full border border-[var(--sb-border)]"
          >
            ›
          </button>
        </div>
      </div>
      {isLoading ? (
        <div
          className="flex gap-4 overflow-hidden"
          aria-busy="true"
          aria-label="Cargando productos"
        >
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="aspect-[3/4] w-48 shrink-0 animate-pulse rounded-[var(--sb-radius)] bg-[var(--sb-border)]"
            />
          ))}
        </div>
      ) : (
        <ul
          ref={track}
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2"
          tabIndex={0}
          aria-label={heading}
        >
          {data?.data.map((product) => (
            <li key={product.id} className="w-44 shrink-0 snap-start sm:w-56">
              <ProductCard product={product} href={hrefFor(product.slug)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
