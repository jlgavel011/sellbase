import { catalogSitemap } from '@sellbase/react';
import type { MetadataRoute } from 'next';
import { sellbaseServer, siteUrl } from './sellbase-server';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries = await catalogSitemap(sellbaseServer, { baseUrl: siteUrl }).catch(() => []);
  return [{ url: siteUrl }, ...entries];
}
