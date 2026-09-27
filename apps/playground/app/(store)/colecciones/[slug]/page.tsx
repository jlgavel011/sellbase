import { ProductGrid } from '../../../../components/sellbase/product-grid';
import { sellbaseServer } from '../../../sellbase-server';

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const collection = await sellbaseServer.collections.get(slug).catch(() => null);
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold">{collection?.title ?? 'Colección'}</h1>
      {collection?.description && (
        <p className="mb-6 text-[var(--sb-muted)]">{collection.description}</p>
      )}
      <ProductGrid collection={slug} />
    </>
  );
}
