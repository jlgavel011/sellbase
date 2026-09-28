'use client';

import { createSellbase, type Sellbase, type SellbaseClientOptions } from '@sellbase/sdk';
import { QueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface SellbaseContextValue {
  sellbase: Sellbase;
  queryClient: QueryClient;
  /** Shared by every useCart() so all components see the same cart. */
  cartToken: string | null;
  setCartToken: (token: string | null) => void;
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
}

function readStorage(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // private mode: the cart still works for this page view
  }
}

const SellbaseContext = createContext<SellbaseContextValue | null>(null);

export interface SellbaseProviderProps {
  /** Base URL of the sellbase-api function, e.g. `${SUPABASE_URL}/functions/v1/sellbase-api`. */
  url?: string;
  /** Supabase anon/publishable key. Never pass the service role key to the browser. */
  anonKey?: string;
  /** Bring your own client (tests, custom fetch). Overrides url/anonKey. */
  client?: Sellbase;
  /** Share a TanStack QueryClient with the rest of the app; one is created otherwise. */
  queryClient?: QueryClient;
  /** localStorage key that remembers the buyer's cart between visits. */
  cartStorageKey?: string;
  children: ReactNode;
}

/**
 * Wrap the storefront once (e.g. in app/layout.tsx). Hooks read from it; components stay
 * headless so the AI that built the site can style them freely.
 */
/** Query parameter of cart recovery links (same as @sellbase/web). */
export const CART_PARAM = 'sellbase_cart';

const NOT_CONFIGURED = {
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Sellbase is not configured: SellbaseProvider has no `url`.',
    hint: 'Set NEXT_PUBLIC_SELLBASE_URL (Next.js) or VITE_SELLBASE_URL (Vite) to <SUPABASE_URL>/functions/v1/sellbase-api and rebuild.',
    details: {},
  },
};

/**
 * Without a URL (e.g. the first build on a host before its env vars are set) the app must
 * still build and render: every request fails with a hint instead of crashing the page.
 */
function unconfiguredClient() {
  if (typeof window !== 'undefined') console.warn(`[sellbase] ${NOT_CONFIGURED.error.hint}`);
  return createSellbase({
    url: 'https://sellbase.invalid',
    fetch: async () => new Response(JSON.stringify(NOT_CONFIGURED), { status: 503 }),
  });
}

export function SellbaseProvider({
  url,
  anonKey,
  client,
  queryClient,
  cartStorageKey = 'sellbase_cart_token',
  children,
}: SellbaseProviderProps) {
  const [ownQueryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  const [cartOpen, setCartOpen] = useState(false);
  const [cartToken, setCartTokenState] = useState<string | null>(null);

  // Read after mount so server and client render the same markup. A cart recovery link
  // (?sellbase_cart=…, from the abandoned checkout email) replaces the saved cart.
  useEffect(() => {
    const url = new URL(window.location.href);
    const fromLink = url.searchParams.get(CART_PARAM);
    if (fromLink && fromLink.length >= 20) {
      writeStorage(cartStorageKey, fromLink);
      url.searchParams.delete(CART_PARAM);
      window.history.replaceState(window.history.state, '', url.toString());
    }
    setCartTokenState(readStorage(cartStorageKey));
  }, [cartStorageKey]);
  const setCartToken = useCallback(
    (token: string | null) => {
      writeStorage(cartStorageKey, token);
      setCartTokenState(token);
    },
    [cartStorageKey],
  );
  const sellbase = useMemo(() => {
    if (client) return client;
    if (!url) return unconfiguredClient();
    const options: SellbaseClientOptions = { url, ...(anonKey ? { anonKey } : {}) };
    return createSellbase(options);
  }, [client, url, anonKey]);

  const value = useMemo(
    () => ({
      sellbase,
      queryClient: queryClient ?? ownQueryClient,
      cartToken,
      setCartToken,
      cartOpen,
      setCartOpen,
    }),
    [sellbase, queryClient, ownQueryClient, cartToken, setCartToken, cartOpen],
  );
  return <SellbaseContext.Provider value={value}>{children}</SellbaseContext.Provider>;
}

export function useSellbase(): SellbaseContextValue {
  const ctx = useContext(SellbaseContext);
  if (!ctx) throw new Error('Sellbase hooks must be used inside <SellbaseProvider>.');
  return ctx;
}
