import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/** A tiny history router scoped to the admin's basePath, so it works in any host app. */
interface RouterValue {
  path: string;
  /** One-shot message for the next page (e.g. "Saved" after creating a record). */
  flash: string | null;
  navigate: (to: string, flash?: string) => void;
  href: (to: string) => string;
}

const RouterContext = createContext<RouterValue | null>(null);

const clean = (p: string) => '/' + p.replace(/^\/+|\/+$/g, '');

export function Router({ basePath, children }: { basePath: string; children: ReactNode }) {
  const base = clean(basePath);
  const read = useCallback(() => {
    const full = window.location.pathname;
    return clean(full.startsWith(base) ? full.slice(base.length) : '/');
  }, [base]);
  const [path, setPath] = useState('/');
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    setPath(read());
    const onPop = () => {
      setFlash(null);
      setPath(read());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [read]);

  const href = useCallback((to: string) => (base === '/' ? '' : base) + clean(to), [base]);
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
    <RouterContext.Provider value={{ path, flash, navigate, href }}>
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
