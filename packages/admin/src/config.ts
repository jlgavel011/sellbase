import type { Sellbase } from '@sellbase/sdk';
import type { ReactNode } from 'react';
import { texts as defaultTexts, type Texts } from './texts.js';

/**
 * Everything a store can customize without forking the package (SPEC §19.3): theme, texts,
 * logo, named UI slots and extra pages. Updating @sellbase/admin keeps all of it.
 */
export interface AdminConfig {
  /** Your Supabase project URL and anon/publishable key (never the service role key). */
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Defaults to `${supabaseUrl}/functions/v1/sellbase-api`. */
  apiUrl?: string;
  /** Where the admin is mounted. Default `/admin`. */
  basePath?: string;
  /**
   * 'path' (default): /admin/orders, needs the host to serve the admin for every
   * /admin/* URL. 'hash': /admin/#/orders, works on any static host with no rewrites
   * (the standalone admin uses it).
   */
  routing?: 'path' | 'hash';
  locale?: 'es' | 'en';
  /** Override any label, e.g. { nav: { orders: 'Ventas' } }. */
  texts?: DeepPartial<Texts>;
  logo?: { src: string; alt?: string };
  theme?: AdminTheme;
  /** Extra content in named places. Each receives the current context. */
  slots?: Partial<Record<SlotName, (ctx: SlotContext) => ReactNode>>;
  /** Extra pages, shown in the sidebar and routed under basePath. */
  pages?: AdminPage[];
}

export interface AdminTheme {
  /** Buttons, active nav and links. Any CSS color. */
  primary?: string;
  primaryForeground?: string;
  /** Corner radius, e.g. '0.5rem'. */
  radius?: string;
  fontFamily?: string;
}

export const SLOT_NAMES = [
  'home.top',
  'home.bottom',
  'orders.list.top',
  'order.detail.sidebar',
  'products.list.top',
  'product.form.bottom',
  'settings.bottom',
  'sidebar.bottom',
] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

export interface SlotContext {
  sellbase: Sellbase;
  navigate: (path: string) => void;
  /** Present on order/product slots. */
  orderId?: string;
  productId?: string;
}

export interface AdminPage {
  /** Path under basePath, e.g. 'reports' → /admin/reports. */
  path: string;
  label: string;
  /** An admin icon name (chart, store, mail, users, tag, file…) or a short text. */
  icon?: string;
  render: (ctx: SlotContext) => ReactNode;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge<T extends object>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    const prev = out[key];
    out[key] =
      prev && typeof prev === 'object' && value && typeof value === 'object'
        ? merge(prev as object, value as object)
        : value;
  }
  return out as T;
}

export function resolveTexts(config: AdminConfig): Texts {
  return merge(defaultTexts[config.locale ?? 'es'], config.texts);
}
