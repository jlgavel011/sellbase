import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { SlotContext, SlotName } from './config.js';
import { useAdmin } from './context.js';
import { Link, useRouter } from './router.js';
import { Alert, Button, Card, Field, Input, cx } from './ui.js';

export function useSlot(name: SlotName, extra: Partial<SlotContext> = {}): ReactNode {
  const { config, sellbase } = useAdmin();
  const { navigate } = useRouter();
  return config.slots?.[name]?.({ sellbase, navigate, ...extra }) ?? null;
}

export function Login() {
  const { supabase, t, config } = useAdmin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(err.message);
  }

  async function magicLink() {
    if (!email) return;
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href, shouldCreateUser: false },
    });
    setBusy(false);
    if (err) setError(err.message);
    else setSent(true);
  }

  return (
    <div className="sb:flex sb:min-h-screen sb:items-center sb:justify-center sb:bg-zinc-50 sb:p-4">
      <Card className="sb:w-full sb:max-w-sm">
        {config.logo && (
          <img src={config.logo.src} alt={config.logo.alt ?? ''} className="sb:mb-4 sb:h-8" />
        )}
        <h1 className="sb:mb-4 sb:text-xl sb:font-semibold">{t.login.title}</h1>
        <form onSubmit={signIn} className="sb:flex sb:flex-col sb:gap-3">
          <Field label={t.login.email}>
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label={t.login.password}>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <Alert>{error}</Alert>}
          {sent && <Alert tone="green">{t.login.magicLinkSent}</Alert>}
          <Button type="submit" disabled={busy || !password}>
            {t.login.signIn}
          </Button>
          <Button variant="ghost" onClick={magicLink} disabled={busy || !email}>
            {t.login.magicLink}
          </Button>
        </form>
      </Card>
    </div>
  );
}

/** First visit from an invitation (or a reset link): choose a password. */
export function SetPassword() {
  const { supabase, t, config, setNeedsPassword } = useAdmin();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) setError(err.message);
    else {
      window.history.replaceState(null, '', window.location.pathname);
      setNeedsPassword(false);
    }
  }

  return (
    <div className="sb:flex sb:min-h-screen sb:items-center sb:justify-center sb:bg-zinc-50 sb:p-4">
      <Card className="sb:w-full sb:max-w-sm">
        {config.logo && (
          <img src={config.logo.src} alt={config.logo.alt ?? ''} className="sb:mb-4 sb:h-8" />
        )}
        <h1 className="sb:mb-1 sb:text-xl sb:font-semibold">{t.login.setPassword}</h1>
        <p className="sb:mb-4 sb:text-sm sb:text-zinc-500">{t.login.setPasswordHint}</p>
        <form onSubmit={save} className="sb:flex sb:flex-col sb:gap-3">
          <Field label={t.login.newPassword}>
            <Input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" disabled={busy || password.length < 8}>
            {t.login.savePassword}
          </Button>
        </form>
      </Card>
    </div>
  );
}

/** Blocks signed-in users who are not on the store team (the API answers 401/403). */
export function StaffGate({ children }: { children: ReactNode }) {
  const { sellbase, supabase, t, setCurrency } = useAdmin();
  const store = useQuery({
    queryKey: ['sellbase-admin', 'store'],
    queryFn: async () => {
      const s = await sellbase.admin.store.get();
      setCurrency(s.default_currency);
      return s;
    },
    retry: false,
  });
  if (store.isLoading) return null;
  if (store.error) {
    return (
      <div className="sb:flex sb:min-h-screen sb:items-center sb:justify-center sb:p-4">
        <Card className="sb:max-w-sm">
          <Alert>{t.login.notStaff}</Alert>
          <Button
            variant="outline"
            className="sb:mt-4 sb:w-full"
            onClick={() => void supabase.auth.signOut()}
          >
            {t.nav.signOut}
          </Button>
        </Card>
      </div>
    );
  }
  return <>{children}</>;
}

export function Shell({ children }: { children: ReactNode }) {
  const { t, config, supabase, sellbase } = useAdmin();
  const { path } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const store = useQuery({
    queryKey: ['sellbase-admin', 'store'],
    queryFn: () => sellbase.admin.store.get(),
  });
  const sidebarBottom = useSlot('sidebar.bottom');

  const nav: { to: string; label: string; icon: string }[] = [
    { to: '/', label: t.nav.home, icon: '⌂' },
    { to: '/orders', label: t.nav.orders, icon: '🧾' },
    { to: '/agenda', label: t.nav.agenda, icon: '📅' },
    { to: '/products', label: t.nav.products, icon: '🏷' },
    { to: '/customers', label: t.nav.customers, icon: '👥' },
    { to: '/discounts', label: t.nav.discounts, icon: '％' },
    ...(config.pages ?? []).map((p) => ({
      to: `/${p.path.replace(/^\//, '')}`,
      label: p.label,
      icon: p.icon ?? '•',
    })),
    { to: '/settings', label: t.nav.settings, icon: '⚙' },
  ];
  const active = (to: string) =>
    to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`);

  const sidebar = (
    <nav className="sb:flex sb:h-full sb:flex-col sb:gap-1 sb:p-3" aria-label="Admin">
      <div className="sb:mb-4 sb:flex sb:items-center sb:gap-2 sb:px-2 sb:py-1">
        {config.logo ? (
          <img src={config.logo.src} alt={config.logo.alt ?? ''} className="sb:h-7" />
        ) : (
          <span className="sb:font-semibold">{store.data?.name ?? 'Sellbase'}</span>
        )}
      </div>
      {nav.map((item) => (
        <span key={item.to} onClick={() => setMenuOpen(false)}>
          <Link
            to={item.to}
            className={cx(
              'sb:flex sb:items-center sb:gap-2 sb:rounded-[var(--sba-radius)] sb:px-3 sb:py-2 sb:text-sm',
              active(item.to)
                ? 'sb:bg-[var(--sba-primary)] sb:text-[var(--sba-primary-fg)]'
                : 'sb:text-zinc-700 sb:hover:bg-zinc-100',
            )}
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </Link>
        </span>
      ))}
      <div className="sb:mt-auto sb:flex sb:flex-col sb:gap-2">
        {sidebarBottom}
        <Button
          variant="ghost"
          className="sb:justify-start"
          onClick={() => void supabase.auth.signOut()}
        >
          {t.nav.signOut}
        </Button>
      </div>
    </nav>
  );

  return (
    <div className="sb:flex sb:min-h-screen sb:bg-zinc-50">
      <aside className="sb:hidden sb:w-60 sb:shrink-0 sb:border-r sb:border-zinc-200 sb:bg-white sb:md:block">
        {sidebar}
      </aside>
      {menuOpen && (
        <div className="sb:fixed sb:inset-0 sb:z-40 sb:md:hidden">
          <button
            type="button"
            aria-label={t.common.cancel}
            className="sb:absolute sb:inset-0 sb:bg-black/30"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="sb:relative sb:h-full sb:w-64 sb:bg-white">{sidebar}</aside>
        </div>
      )}
      <div className="sb:flex sb:min-w-0 sb:flex-1 sb:flex-col">
        <header className="sb:flex sb:items-center sb:gap-3 sb:border-b sb:border-zinc-200 sb:bg-white sb:px-4 sb:py-3 sb:md:hidden">
          <Button
            variant="ghost"
            className="sb:px-2"
            onClick={() => setMenuOpen(true)}
            aria-label={t.common.menu}
          >
            ☰
          </Button>
          <span className="sb:font-semibold">{store.data?.name}</span>
        </header>
        <main className="sb:mx-auto sb:w-full sb:max-w-5xl sb:p-4 sb:md:p-8">{children}</main>
      </div>
    </div>
  );
}

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="sb:mb-6 sb:flex sb:flex-wrap sb:items-center sb:justify-between sb:gap-3">
      <h1 className="sb:text-2xl sb:font-semibold">{children}</h1>
      {actions}
    </div>
  );
}
