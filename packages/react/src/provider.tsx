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

  // Read after mount so server and client render the same markup.
  useEffect(() => setCartTokenState(readStorage(cartStorageKey)), [cartStorageKey]);
  const setCartToken = useCallback(
    (token: string | null) => {
      writeStorage(cartStorageKey, token);
      setCartTokenState(token);
    },
    [cartStorageKey],
  );
  const sellbase = useMemo(() => {
    if (client) return client;
    if (!url)
      throw new Error(
        'SellbaseProvider needs `url` (your sellbase-api function URL) or a `client`.',
      );
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
