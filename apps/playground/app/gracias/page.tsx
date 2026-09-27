'use client';

import { useCart } from '@sellbase/react';
import { useEffect } from 'react';

export default function ThanksPage() {
  const { clear } = useCart();
  useEffect(() => clear(), [clear]);
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-2xl font-semibold">¡Gracias por tu compra!</h1>
      <p className="mt-3 text-[var(--sb-muted)]">
        Te enviamos la confirmación y, si compraste algo digital, tus links de descarga por correo.
      </p>
      <a href="/" className="mt-8 inline-block underline">
        Seguir comprando
      </a>
    </div>
  );
}
