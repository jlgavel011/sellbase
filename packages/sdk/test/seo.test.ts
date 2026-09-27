import { describe, expect, it } from 'vitest';
import { catalogSitemap, productJsonLd, productMetadata, sitemapXml } from '../src/index.js';

const product = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'playera',
  type: 'physical' as const,
  title: 'Playera',
  description: '<p>Algodón <b>100%</b></p>',
  tags: [],
  image_url: 'https://cdn.test/a.jpg',
  image_alt: null,
  min_price_amount: 34900,
  max_price_amount: 39900,
  currency: 'MXN',
  seo: {},
  options: [{ name: 'Talla', values: ['M', 'L'] }],
  media: [{ url: 'https://cdn.test/a.jpg', alt: '', kind: 'image' as const, variant_id: null }],
  variants: [
    {
      id: 'v1',
      sku: 'P-M',
      title: 'M',
      option_values: { Talla: 'M' },
      price_amount: 34900,
      compare_at_amount: null,
      currency: 'MXN',
      available: true,
      available_quantity: 3,
      service: null,
    },
    {
      id: 'v2',
      sku: 'P-L',
      title: 'L',
      option_values: { Talla: 'L' },
      price_amount: 39900,
      compare_at_amount: null,
      currency: 'MXN',
      available: false,
      available_quantity: 0,
      service: null,
    },
  ],
};

describe('seo helpers', () => {
  it('builds Product JSON-LD with an aggregate offer and stock per variant', () => {
    const ld = productJsonLd(product, {
      url: 'https://tienda.test/products/playera',
      brand: 'Tienda',
    });
    expect(ld).toMatchObject({
      '@type': 'Product',
      name: 'Playera',
      description: 'Algodón 100%',
      image: ['https://cdn.test/a.jpg'],
      offers: {
        '@type': 'AggregateOffer',
        lowPrice: '349.00',
        highPrice: '399.00',
        priceCurrency: 'MXN',
        offerCount: 2,
      },
    });
    const offers = (ld.offers as { offers: { availability: string }[] }).offers;
    expect(offers.map((o) => o.availability)).toEqual([
      'https://schema.org/InStock',
      'https://schema.org/OutOfStock',
    ]);
  });

  it('builds page metadata with Open Graph images', () => {
    const meta = productMetadata(product, {
      url: 'https://tienda.test/products/playera',
      siteName: 'Tienda',
    });
    expect(meta).toMatchObject({
      title: 'Playera',
      alternates: { canonical: 'https://tienda.test/products/playera' },
      openGraph: {
        images: [{ url: 'https://cdn.test/a.jpg', alt: 'Playera' }],
        siteName: 'Tienda',
      },
    });
  });

  it('walks every catalog page for the sitemap and escapes the XML', async () => {
    const pages = [
      { data: [{ slug: 'a' }], next_cursor: 'c1' },
      { data: [{ slug: 'b&c' }], next_cursor: null },
    ];
    const fake = {
      products: { list: async () => pages.shift() as never },
      collections: { list: async () => ({ data: [{ slug: 'novedades' }] }) as never },
    };
    const entries = await catalogSitemap(fake, { baseUrl: 'https://tienda.test/' });
    expect(entries.map((e) => e.url)).toEqual([
      'https://tienda.test/products/a',
      'https://tienda.test/products/b&c',
      'https://tienda.test/collections/novedades',
    ]);
    expect(sitemapXml(entries)).toContain('<loc>https://tienda.test/products/b&amp;c</loc>');
  });
});
