import { toDecimalString } from '@sellbase/core';
import type { RouteResponse } from './client.js';

type Product = RouteResponse<'storefrontProductGet'>;

const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * schema.org Product with its Offer(s) for a product page (render it inside
 * <script type="application/ld+json">). Prices come from the API, never the page.
 */
export function productJsonLd(product: Product, options: { url: string; brand?: string }) {
  const variants = product.variants;
  const offer = (v: (typeof variants)[number]) => ({
    '@type': 'Offer',
    price: toDecimalString(v.price_amount, v.currency),
    priceCurrency: v.currency,
    availability: v.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    url: options.url,
    ...(v.sku ? { sku: v.sku } : {}),
  });
  const prices = variants.map((v) => v.price_amount);
  const currency = variants[0]?.currency ?? product.currency ?? 'MXN';
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: strip(product.seo.description ?? product.description).slice(0, 5000),
    image: product.media.filter((m) => m.kind === 'image').map((m) => m.url),
    url: options.url,
    ...(options.brand ? { brand: { '@type': 'Brand', name: options.brand } } : {}),
    ...(variants.length === 1 && variants[0]?.sku ? { sku: variants[0].sku } : {}),
    offers:
      variants.length <= 1
        ? variants[0]
          ? offer(variants[0])
          : undefined
        : {
            '@type': 'AggregateOffer',
            priceCurrency: currency,
            lowPrice: toDecimalString(Math.min(...prices), currency),
            highPrice: toDecimalString(Math.max(...prices), currency),
            offerCount: variants.length,
            offers: variants.map(offer),
          },
  };
}

/**
 * Title, description and Open Graph tags for a product page. The shape matches Next.js
 * `Metadata` (return it from generateMetadata); in other frameworks, map it to <meta>.
 */
export function productMetadata(product: Product, options: { url: string; siteName?: string }) {
  const title = product.seo.title ?? product.title;
  const description = strip(product.seo.description ?? product.description).slice(0, 160);
  const images = product.media
    .filter((m) => m.kind === 'image')
    .slice(0, 4)
    .map((m) => ({ url: m.url, alt: m.alt || product.title }));
  return {
    title,
    description,
    alternates: { canonical: options.url },
    openGraph: {
      title,
      description,
      url: options.url,
      type: 'website',
      images,
      ...(options.siteName ? { siteName: options.siteName } : {}),
    },
    twitter: { card: images.length ? 'summary_large_image' : 'summary', title, description },
  };
}

/** Sitemap entries for every active product and collection (all pages of the catalog). */
export async function catalogSitemap(
  sellbase: {
    products: {
      list: (q: {
        limit?: number;
        cursor?: string;
      }) => Promise<RouteResponse<'storefrontProductsList'>>;
    };
    collections: { list: () => Promise<RouteResponse<'storefrontCollectionsList'>> };
  },
  options: {
    baseUrl: string;
    productPath?: (slug: string) => string;
    collectionPath?: (slug: string) => string;
  },
) {
  const base = options.baseUrl.replace(/\/+$/, '');
  const productPath = options.productPath ?? ((slug) => `/products/${slug}`);
  const collectionPath = options.collectionPath ?? ((slug) => `/collections/${slug}`);
  const entries: { url: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await sellbase.products.list({ limit: 100, ...(cursor ? { cursor } : {}) });
    for (const p of page.data) entries.push({ url: `${base}${productPath(p.slug)}` });
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  const collections = await sellbase.collections.list();
  for (const c of collections.data) entries.push({ url: `${base}${collectionPath(c.slug)}` });
  return entries;
}

/** sitemap.xml text for hosts without a sitemap helper (e.g. a Vite build script). */
export function sitemapXml(entries: { url: string }[]) {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map((e) => `  <url><loc>${escape(e.url)}</loc></url>`)
    .join('\n')}\n</urlset>\n`;
}
