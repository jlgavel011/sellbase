'use client';

/*
 * Sellbase · product-grid
 * Responsive grid of active products, loaded from the Sellbase API.
 * Props: `collection` (slug) to show one collection, `limit`, and `hrefFor` to match your
 * routes (default /products/<slug>).
 * AI: change columns, gaps and the empty state to fit the page; keep the loading and error
 * states so the page never looks broken.
 */
import { useProducts } from '@sellbase/react';
import { ProductCard } from './product-card';

export function ProductGrid({
  collection,
  limit = 24,
  hrefFor = (slug: string) => `/products/${slug}`,
}: {
  collection?: string;
  limit?: number;
  hrefFor?: (slug: string) => string;
}) {
  const { data, isLoading, error } = useProducts({ limit, ...(collection ? { collection } : {}) });

  if (isLoading) {
    return (
      <div
        className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4"
        aria-busy="true"
        aria-label="Cargando productos"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="aspect-[3/4] animate-pulse rounded-[var(--sb-radius)] bg-[var(--sb-border)]"
          />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-[var(--sb-danger)]">
        No pudimos cargar los productos. Intenta de nuevo.
      </p>
    );
  }
  if (!data?.data.length) {
    return <p className="text-[var(--sb-muted)]">Pronto habrá productos aquí.</p>;
  }
  return (
    <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {data.data.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} href={hrefFor(product.slug)} />
        </li>
      ))}
    </ul>
  );
}
