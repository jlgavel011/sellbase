import { createSellbase, productMetadata } from '@sellbase/react';
import type { Metadata } from 'next';
import { ProductDetail } from '@/components/sellbase/product-detail';
import { ProductJsonLd } from '@/components/sellbase/product-seo';

type Props = { params: Promise<{ slug: string }> };

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
const sellbase = createSellbase({
  url: process.env.NEXT_PUBLIC_SELLBASE_URL ?? '',
  ...(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? { anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY }
    : {}),
});
const load = (slug: string) => sellbase.products.get(slug).catch(() => null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await load((await params).slug);
  return product
    ? productMetadata(product, {
        url: `${siteUrl}/products/${product.slug}`,
        siteName: 'Aurora Café',
      })
    : { title: 'Producto no disponible' };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = await load(slug);
  return (
    <>
      {product && <ProductJsonLd product={product} url={`${siteUrl}/products/${slug}`} />}
      <ProductDetail slug={slug} />
    </>
  );
}
