import { ProductCarousel } from '../../components/sellbase/product-carousel';
import { ProductGrid } from '../../components/sellbase/product-grid';

export default function Home() {
  return (
    <div className="flex flex-col gap-10">
      <ProductCarousel title="Lo más nuevo" limit={8} />
      <section aria-labelledby="catalogo">
        <h1 id="catalogo" className="mb-6 text-2xl font-semibold">
          Productos
        </h1>
        <ProductGrid />
      </section>
    </div>
  );
}
