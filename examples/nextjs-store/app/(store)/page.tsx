import { ProductCarousel } from '@/components/sellbase/product-carousel';
import { ProductGrid } from '@/components/sellbase/product-grid';

export default function Home() {
  return (
    <div className="flex flex-col gap-16">
      <section className="grid items-center gap-8 rounded-[var(--sb-radius)] bg-[var(--sb-card)] p-8 md:grid-cols-2 md:p-14">
        <div className="flex flex-col gap-5">
          <span className="w-fit rounded-full border border-[var(--sb-border)] px-3 py-1 text-xs uppercase tracking-widest text-[var(--sb-muted)]">
            Tostado esta semana
          </span>
          <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
            Café de especialidad, directo de nuestro tostador a tu taza.
          </h1>
          <p className="text-lg text-[var(--sb-muted)]">
            Granos de Oaxaca y Chiapas, recetas para preparar en casa y pedidos para recoger en la
            cafetería.
          </p>
          <a
            href="#productos"
            className="w-fit rounded-[var(--sb-radius)] bg-[var(--sb-primary)] px-6 py-3 font-semibold text-[var(--sb-primary-fg)]"
          >
            Ver la tienda
          </a>
        </div>
        <div
          aria-hidden
          className="aspect-square rounded-[var(--sb-radius)] bg-[radial-gradient(circle_at_30%_30%,#f5d9b8,#b07a4f_55%,#3f2a1d)]"
        />
      </section>
      <ProductCarousel title="Lo más nuevo" limit={8} />
      <section id="productos" aria-labelledby="catalogo" className="scroll-mt-24">
        <h2 id="catalogo" className="mb-6 text-2xl font-semibold">
          Todos los productos
        </h2>
        <ProductGrid />
      </section>
    </div>
  );
}
