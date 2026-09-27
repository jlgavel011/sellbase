'use client';

import { SellbaseProvider } from '@sellbase/react';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SellbaseProvider url={process.env.NEXT_PUBLIC_SELLBASE_URL ?? ''}>{children}</SellbaseProvider>
  );
}
