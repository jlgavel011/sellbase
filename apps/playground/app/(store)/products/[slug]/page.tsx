import { productMetadata } from '@sellbase/react';
import type { Metadata } from 'next';
import { ProductDetail } from '../../../../components/sellbase/product-detail';
import { ProductJsonLd } from '../../../../components/sellbase/product-seo';
import { sellbaseServer, siteUrl } from '../../../sellbase-server';

type Props = { params: Promise<{ slug: string }> };

const load = (slug: string) => sellbaseServer.products.get(slug).catch(() => null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await load((await params).slug);
  return product
    ? productMetadata(product, {
        url: `${siteUrl}/products/${product.slug}`,
        siteName: 'Sellbase Playground',
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
