import { Checkout } from '../../components/sellbase/checkout';

export default function CheckoutPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Pagar</h1>
      <Checkout successPath="/gracias" cancelPath="/checkout" />
    </>
  );
}
