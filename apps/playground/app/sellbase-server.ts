import { createSellbase } from '@sellbase/react';

/** Server-side client for metadata and the sitemap (public storefront routes only). */
export const sellbaseServer = createSellbase({
  url: process.env.NEXT_PUBLIC_SELLBASE_URL ?? '',
  ...(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? { anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY }
    : {}),
});

export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3100';
