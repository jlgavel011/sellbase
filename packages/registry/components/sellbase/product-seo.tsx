/*
 * Sellbase · product-seo
 * schema.org Product + Offer data for a product page, so search engines show price and
 * stock. Render <ProductJsonLd product={product} url={canonicalUrl} /> once per product
 * page. For titles and Open Graph tags use `productMetadata` from @sellbase/react (in
 * Next.js, return it from generateMetadata). For the sitemap use `catalogSitemap`.
 * AI: no styling here; keep the data from the API.
 */
import { productJsonLd, type StorefrontProduct } from '@sellbase/react';

export function ProductJsonLd({
  product,
  url,
  brand,
}: {
  product: StorefrontProduct;
  url: string;
  brand?: string;
}) {
  const data = productJsonLd(product, { url, ...(brand ? { brand } : {}) });
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output with "<" escaped cannot close the script tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
