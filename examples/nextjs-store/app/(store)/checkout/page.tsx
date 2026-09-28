import { Checkout } from '@/components/sellbase/checkout';

export const metadata = { title: 'Pagar' };

export default function CheckoutPage() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold tracking-tight">Pagar</h1>
      <Checkout successPath="/gracias" cancelPath="/carrito" />
    </>
  );
}
