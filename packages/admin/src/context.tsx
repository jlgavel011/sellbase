import { createSellbase, type Sellbase } from '@sellbase/sdk';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { resolveTexts, type AdminConfig } from './config.js';
import type { Texts } from './texts.js';

interface AdminContextValue {
  config: AdminConfig;
  t: Texts;
  supabase: SupabaseClient;
  session: Session | null;
  sessionReady: boolean;
  sellbase: Sellbase;
  currency: string;
  setCurrency: (c: string) => void;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ config, children }: { config: AdminConfig; children: ReactNode }) {
  const supabase = useMemo(
    () =>
      createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: true, storageKey: 'sellbase-admin-auth' },
      }),
    [config.supabaseUrl, config.supabaseAnonKey],
  );
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [currency, setCurrency] = useState('MXN');
  const sessionRef = useRef<Session | null>(null);
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } }),
  );

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      sessionRef.current = data.session;
      setSession(data.session);
      setSessionReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      sessionRef.current = next;
      setSession(next);
      if (!next) queryClient.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [supabase, queryClient]);

  // Every admin write goes through the API with the staff session (ADR 0004).
  const sellbase = useMemo(
    () =>
      createSellbase({
        url: config.apiUrl ?? `${config.supabaseUrl.replace(/\/+$/, '')}/functions/v1/sellbase-api`,
        anonKey: config.supabaseAnonKey,
        token: () => sessionRef.current?.access_token ?? null,
      }),
    [config.apiUrl, config.supabaseUrl, config.supabaseAnonKey],
  );

  const t = useMemo(() => resolveTexts(config), [config]);
  const value = { config, t, supabase, session, sessionReady, sellbase, currency, setCurrency };
  return (
    <QueryClientProvider client={queryClient}>
      <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
    </QueryClientProvider>
  );
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin outside <SellbaseAdmin>');
  return ctx;
}
