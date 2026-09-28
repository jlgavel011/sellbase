/**
 * Where the store lives. Set it once, in any of these ways (first one wins):
 *   Sellbase.configure({ url, anonKey })
 *   <script>window.SellbaseConfig = { url, anonKey }</script>   (sellbase init writes sellbase/config.js)
 *   <script type="module" src="sellbase.js" data-sellbase-url="…" data-sellbase-anon-key="…"></script>
 */
export interface SellbaseWebConfig {
  /** <SUPABASE_URL>/functions/v1/sellbase-api */
  url: string;
  /** Supabase anon/publishable key (public by design; never the service role key). */
  anonKey?: string;
  /** 'es' (default) or 'en'. */
  locale?: 'es' | 'en';
  /** Pages used by the default links and the payment return. */
  checkoutUrl?: string;
  cartUrl?: string;
  successUrl?: string;
  /** `{slug}` is replaced: default /products/{slug}. */
  productUrl?: string;
}

let explicit: SellbaseWebConfig | null = null;

export function configure(config: SellbaseWebConfig) {
  explicit = config;
}

declare global {
  interface Window {
    SellbaseConfig?: SellbaseWebConfig;
  }
}

export function getConfig(): SellbaseWebConfig {
  if (explicit) return explicit;
  if (typeof window !== 'undefined' && window.SellbaseConfig?.url) return window.SellbaseConfig;
  const script =
    typeof document !== 'undefined'
      ? document.querySelector<HTMLScriptElement>('script[data-sellbase-url]')
      : null;
  if (script?.dataset.sellbaseUrl) {
    return {
      url: script.dataset.sellbaseUrl,
      ...(script.dataset.sellbaseAnonKey ? { anonKey: script.dataset.sellbaseAnonKey } : {}),
      ...(script.dataset.sellbaseLocale === 'en' ? { locale: 'en' as const } : {}),
    };
  }
  return { url: '' };
}

export const productHref = (slug: string) =>
  (getConfig().productUrl ?? '/products/{slug}').replace('{slug}', encodeURIComponent(slug));
