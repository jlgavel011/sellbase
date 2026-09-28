import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/** A tiny history router scoped to the admin's basePath, so it works in any host app. */
interface RouterValue {
  path: string;
  /** One-shot message for the next page (e.g. "Saved" after creating a record). */
  flash: string | null;
  navigate: (to: string, flash?: string) => void;
  href: (to: string) => string;
  /** Absolute URL of an admin page, for links sent elsewhere (emails, Stripe returns). */
  absolute: (to: string) => string;
}

const RouterContext = createContext<RouterValue | null>(null);

const clean = (p: string) => '/' + p.replace(/^\/+|\/+$/g, '');

export function Router({
  basePath,
  mode = 'path',
  children,
}: {
  basePath: string;
  mode?: 'path' | 'hash';
  children: ReactNode;
}) {
  const base = clean(basePath);
  const read = useCallback(() => {
    if (mode === 'hash') {
      const hash = window.location.hash.slice(1);
      // Supabase auth links put tokens in the hash (#access_token=…): that is not a route.
      return hash.startsWith('/') ? clean(hash.split('?')[0] ?? '/') : '/';
    }
    const full = window.location.pathname;
    return clean(full.startsWith(base) ? full.slice(base.length) : '/');
  }, [base, mode]);
  const [path, setPath] = useState('/');
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    setPath(read());
    const onChange = () => {
      setFlash(null);
      setPath(read());
    };
    window.addEventListener('popstate', onChange);
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('hashchange', onChange);
    };
  }, [read]);

  const href = useCallback(
    (to: string) => (mode === 'hash' ? `#${clean(to)}` : (base === '/' ? '' : base) + clean(to)),
    [base, mode],
  );
  const absolute = useCallback(
    (to: string) =>
      mode === 'hash'
        ? `${window.location.origin}${window.location.pathname}#${clean(to)}`
        : `${window.location.origin}${href(to)}`,
    [href, mode],
  );
  const navigate = useCallback(
    (to: string, message?: string) => {
      window.history.pushState(null, '', href(to));
      setFlash(message ?? null);
      setPath(clean(to));
      window.scrollTo(0, 0);
    },
    [href],
  );

  return (
    <RouterContext.Provider value={{ path, flash, navigate, href, absolute }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter outside <Router>');
  return ctx;
}

/** Matches '/orders/:id' against the current path; returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const a = clean(pattern).split('/');
  const b = clean(path).split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const seg = a[i] ?? '';
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(b[i] ?? '');
    else if (seg !== b[i]) return null;
  }
  return params;
}

/** Link that navigates inside the admin without a full reload. */
export function Link({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  const { navigate, href } = useRouter();
  return (
    <a
      href={href(to)}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
