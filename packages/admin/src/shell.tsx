import { formatMoney } from '@sellbase/sdk';
import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { SlotContext, SlotName } from './config.js';
import { useAdmin } from './context.js';
import { Icon, SellbaseMark, type IconName } from './icons.js';
import { Link, useRouter } from './router.js';
import { Banner, Button, Field, Input, Menu, Thumbnail, cx } from './ui.js';

export function useSlot(name: SlotName, extra: Partial<SlotContext> = {}): ReactNode {
  const { config, sellbase } = useAdmin();
  const { navigate } = useRouter();
  return config.slots?.[name]?.({ sellbase, navigate, ...extra }) ?? null;
}

/** Store settings every page can read (cached by react-query). */
export function useStore() {
  const { sellbase } = useAdmin();
  return useQuery({
    queryKey: ['sellbase-admin', 'store'],
    queryFn: () => sellbase.admin.store.get(),
  });
}

export function siteUrlOf(settings: unknown): string | null {
  const url = (settings as { site_url?: unknown } | undefined)?.site_url;
  return typeof url === 'string' && url ? url : null;
}

// ── Auth screens ─────────────────────────────────────────────────────────────

function AuthFrame({ children }: { children: ReactNode }) {
  const { config, sellbase } = useAdmin();
  // Public store info (name, logo) so the owner recognizes their store before signing in.
  const store = useQuery({
    queryKey: ['sellbase-admin', 'public-store'],
    queryFn: () => sellbase.store.get(),
    retry: false,
  });
  const logo = config.logo?.src ?? store.data?.logo_url ?? null;
  return (
    <div className="sb:flex sb:min-h-screen sb:flex-col sb:items-center sb:justify-center sb:gap-6 sb:bg-[var(--sba-bg)] sb:p-4">
      <div className="sb:flex sb:w-full sb:max-w-sm sb:flex-col sb:gap-5 sb:rounded-2xl sb:bg-white sb:p-8 sb:shadow-[var(--sba-shadow-card)]">
        <div className="sb:flex sb:items-center sb:gap-3">
          {logo ? (
            <img
              src={logo}
              alt={config.logo?.alt ?? ''}
              className="sb:h-9 sb:max-w-40 sb:object-contain"
            />
          ) : (
            <SellbaseMark className="sb:h-9 sb:w-9" />
          )}
          {store.data && (
            <span className="sb:text-base sb:font-semibold sb:text-[var(--sba-text-strong)]">
              {store.data.name}
            </span>
          )}
        </div>
        {children}
      </div>
      <p className="sb:flex sb:items-center sb:gap-1.5 sb:text-xs sb:text-[var(--sba-text-subdued)]">
        <SellbaseMark className="sb:h-4 sb:w-4" />
        Sellbase
      </p>
    </div>
  );
}

export function Login() {
  const { supabase, t } = useAdmin();
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
    <AuthFrame>
      <h1 className="sb:text-xl sb:font-semibold sb:text-[var(--sba-text-strong)]">
        {t.login.title}
      </h1>
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
        {error && <Banner tone="critical">{error}</Banner>}
        {sent && <Banner tone="success">{t.login.magicLinkSent}</Banner>}
        <Button type="submit" size="lg" disabled={busy || !password} loading={busy && !sent}>
          {t.login.signIn}
        </Button>
        <Button variant="tertiary" onClick={magicLink} disabled={busy || !email}>
          {t.login.magicLink}
        </Button>
      </form>
    </AuthFrame>
  );
}

/** First visit from an invitation (or a reset link): choose a password. */
export function SetPassword() {
  const { supabase, t, setNeedsPassword } = useAdmin();
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
    <AuthFrame>
      <div>
        <h1 className="sb:text-xl sb:font-semibold sb:text-[var(--sba-text-strong)]">
          {t.login.setPassword}
        </h1>
        <p className="sb:mt-1 sb:text-[var(--sba-text-subdued)]">{t.login.setPasswordHint}</p>
      </div>
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
        {error && <Banner tone="critical">{error}</Banner>}
        <Button type="submit" size="lg" disabled={busy || password.length < 8}>
          {t.login.savePassword}
        </Button>
      </form>
    </AuthFrame>
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
  if (store.isLoading) return <div className="sb:min-h-screen sb:bg-[var(--sba-bg)]" />;
  if (store.error) {
    return (
      <AuthFrame>
        <Banner tone="critical">{t.login.notStaff}</Banner>
        <Button variant="secondary" onClick={() => void supabase.auth.signOut()}>
          {t.nav.signOut}
        </Button>
      </AuthFrame>
    );
  }
  return <>{children}</>;
}

// ── Contextual save bar ──────────────────────────────────────────────────────

interface SaveBarState {
  onSave: () => void;
  onDiscard: () => void;
  saving?: boolean;
  disabled?: boolean;
}
const SaveBarContext = createContext<(state: SaveBarState | null) => void>(() => undefined);
const SaveBarStateContext = createContext<SaveBarState | null>(null);

/**
 * Shows the "Unsaved changes" bar in the top bar while `state` is set (Shopify's
 * contextual save bar), and warns before leaving the page with unsaved changes.
 */
export function useSaveBar(state: SaveBarState | null) {
  const set = useContext(SaveBarContext);
  const ref = useRef(state);
  ref.current = state;
  const active = Boolean(state);
  const saving = state?.saving;
  const disabled = state?.disabled;
  useEffect(() => {
    if (!active) {
      set(null);
      return;
    }
    set({
      onSave: () => ref.current?.onSave(),
      onDiscard: () => ref.current?.onDiscard(),
      ...(saving !== undefined ? { saving } : {}),
      ...(disabled !== undefined ? { disabled } : {}),
    });
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active, saving, disabled, set]);
  useEffect(() => () => set(null), [set]);
}

// ── Shell ────────────────────────────────────────────────────────────────────

interface NavItem {
  to: string;
  label: string;
  icon: IconName | string;
  children?: { to: string; label: string }[];
}

export function Shell({ children }: { children: ReactNode }) {
  const { t, config } = useAdmin();
  const { path } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveBar, setSaveBar] = useState<SaveBarState | null>(null);
  const store = useStore();
  const sidebarBottom = useSlot('sidebar.bottom');
  const siteUrl = siteUrlOf(store.data?.settings);

  useEffect(() => setMenuOpen(false), [path]);

  const nav: NavItem[] = [
    { to: '/', label: t.nav.home, icon: 'home' },
    {
      to: '/orders',
      label: t.nav.orders,
      icon: 'orders',
      children: [{ to: '/orders/abandoned', label: t.nav2.abandoned }],
    },
    {
      to: '/products',
      label: t.nav.products,
      icon: 'products',
      children: [
        { to: '/products/collections', label: t.nav2.collections },
        { to: '/products/inventory', label: t.nav2.inventory },
      ],
    },
    { to: '/customers', label: t.nav.customers, icon: 'customers' },
    { to: '/discounts', label: t.nav.discounts, icon: 'discounts' },
    { to: '/agenda', label: t.nav.agenda, icon: 'calendar' },
    ...(config.pages ?? []).map((p) => ({
      to: `/${p.path.replace(/^\//, '')}`,
      label: p.label,
      icon: p.icon ?? '•',
    })),
  ];
  const inSection = (to: string) =>
    to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`);
  const exact = (item: NavItem) =>
    item.to === '/'
      ? path === '/'
      : inSection(item.to) && !item.children?.some((c) => inSection(c.to));

  const sidebar = (
    <nav
      className="sb:flex sb:h-full sb:flex-col sb:gap-0.5 sb:overflow-y-auto sb:px-3 sb:py-3"
      aria-label="Admin"
    >
      {nav.map((item) => (
        <div key={item.to} className="sb:flex sb:flex-col sb:gap-0.5">
          <Link
            to={item.to}
            className="sba-nav-item"
            {...(exact(item) ? { 'aria-current': 'page' as const } : {})}
          >
            {isIconName(item.icon) ? (
              <Icon name={item.icon} />
            ) : (
              <span aria-hidden className="sb:grid sb:h-5 sb:w-5 sb:place-items-center">
                {item.icon}
              </span>
            )}
            {item.label}
          </Link>
          {item.children && inSection(item.to) && (
            <div className="sb:flex sb:flex-col sb:gap-0.5">
              {item.children.map((c) => (
                <Link
                  key={c.to}
                  to={c.to}
                  className="sba-nav-sub"
                  {...(inSection(c.to) ? { 'aria-current': 'page' as const } : {})}
                >
                  {c.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}
      {siteUrl && (
        <>
          <p className="sb:mb-1 sb:mt-4 sb:px-2 sb:text-xs sb:font-semibold sb:text-[var(--sba-text-subdued)]">
            {t.shell.salesChannels}
          </p>
          <a href={siteUrl} target="_blank" rel="noreferrer" className="sba-nav-item">
            <Icon name="store" />
            <span className="sb:flex-1">{t.shell.onlineStore}</span>
            <Icon name="external" className="sb:h-4 sb:w-4 sb:opacity-60" />
          </a>
        </>
      )}
      <div className="sb:mt-auto sb:flex sb:flex-col sb:gap-2 sb:pt-4">
        {sidebarBottom}
        <Link
          to="/settings"
          className="sba-nav-item"
          {...(inSection('/settings') ? { 'aria-current': 'page' as const } : {})}
        >
          <Icon name="settings" />
          {t.nav.settings}
        </Link>
      </div>
    </nav>
  );

  return (
    <SaveBarContext.Provider value={setSaveBar}>
      <SaveBarStateContext.Provider value={saveBar}>
        <div className="sb:flex sb:min-h-screen sb:flex-col sb:bg-[var(--sba-bg)]">
          <TopBar onMenu={() => setMenuOpen(true)} saveBar={saveBar} />
          <div className="sb:flex sb:flex-1">
            <aside className="sba-no-print sb:sticky sb:top-14 sb:hidden sb:h-[calc(100vh-3.5rem)] sb:w-60 sb:shrink-0 sb:bg-[var(--sba-sidebar)] sb:md:block">
              {sidebar}
            </aside>
            {menuOpen && (
              <div className="sba-overlay sb:fixed sb:inset-0 sb:z-50 sb:md:hidden">
                <button
                  type="button"
                  aria-label={t.common.cancel}
                  className="sb:absolute sb:inset-0 sb:bg-black/40"
                  onClick={() => setMenuOpen(false)}
                />
                <aside className="sb:relative sb:h-full sb:w-72 sb:bg-[var(--sba-sidebar)] sb:shadow-xl">
                  {sidebar}
                </aside>
              </div>
            )}
            <main className="sb:min-w-0 sb:flex-1 sb:px-3 sb:py-4 sb:sm:px-6 sb:md:py-6">
              {children}
            </main>
          </div>
        </div>
      </SaveBarStateContext.Provider>
    </SaveBarContext.Provider>
  );
}

const ICON_NAMES = new Set([
  'home',
  'orders',
  'products',
  'customers',
  'discounts',
  'calendar',
  'settings',
  'chart',
  'store',
  'receipt',
  'bell',
  'users',
  'bot',
  'truck',
  'card',
  'mail',
  'globe',
  'tag',
  'file',
]);
const isIconName = (value: string): value is IconName => ICON_NAMES.has(value);

function TopBar({ onMenu, saveBar }: { onMenu: () => void; saveBar: SaveBarState | null }) {
  const { t, config, supabase, session } = useAdmin();
  const { navigate } = useRouter();
  const store = useStore();
  const siteUrl = siteUrlOf(store.data?.settings);
  const logo = config.logo?.src ?? store.data?.logo_url ?? null;
  const name = store.data?.name ?? '';
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="sba-no-print sb:sticky sb:top-0 sb:z-40 sb:flex sb:h-14 sb:items-center sb:gap-3 sb:bg-[var(--sba-topbar)] sb:px-3 sb:text-white sb:sm:px-4">
      <button
        type="button"
        className="sb:grid sb:h-9 sb:w-9 sb:cursor-pointer sb:place-items-center sb:rounded-lg sb:hover:bg-white/10 sb:md:hidden"
        aria-label={t.common.menu}
        onClick={onMenu}
      >
        <Icon name="menu" />
      </button>
      <Link to="/" className="sb:flex sb:items-center sb:gap-2 sb:md:w-52">
        <SellbaseMark className="sb:h-7 sb:w-7" />
        <span className="sb:hidden sb:text-[0.9375rem] sb:font-semibold sb:tracking-tight sb:sm:inline">
          sellbase
        </span>
      </Link>
      {saveBar ? (
        <div
          className="sb:flex sb:flex-1 sb:items-center sb:justify-between sb:gap-3"
          role="region"
          aria-label={t.shell.unsaved}
        >
          <span className="sb:flex sb:items-center sb:gap-2 sb:font-semibold">
            <Icon name="alert" className="sb:h-4 sb:w-4 sb:text-amber-300" />
            {t.shell.unsaved}
          </span>
          <div className="sb:flex sb:gap-2">
            <button
              type="button"
              className="sba-btn sb:bg-white/10 sb:text-white sb:hover:bg-white/20"
              onClick={saveBar.onDiscard}
              disabled={saveBar.saving}
            >
              {t.shell.discard}
            </button>
            <button
              type="button"
              className="sba-btn sb:bg-white sb:text-[#1a1a1a] sb:hover:bg-zinc-200"
              onClick={saveBar.onSave}
              disabled={saveBar.saving || saveBar.disabled}
              aria-busy={saveBar.saving || undefined}
            >
              {t.shell.save}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="sb:flex sb:flex-1 sb:justify-center">
            <GlobalSearch />
          </div>
          <Menu
            variant="tertiary"
            ariaLabel={t.shell.account}
            label={
              <span className="sb:flex sb:items-center sb:gap-2 sb:text-white">
                <span className="sb:grid sb:h-7 sb:w-7 sb:place-items-center sb:overflow-hidden sb:rounded-lg sb:bg-emerald-500 sb:text-xs sb:font-bold sb:text-white">
                  {logo ? (
                    <img
                      src={logo}
                      alt=""
                      className="sb:h-full sb:w-full sb:bg-white sb:object-contain"
                    />
                  ) : (
                    initials || 'S'
                  )}
                </span>
                <span className="sb:hidden sb:max-w-40 sb:truncate sb:lg:inline">{name}</span>
              </span>
            }
            icon="chevronDown"
            items={[
              siteUrl
                ? {
                    label: t.shell.viewStore,
                    icon: 'external' as const,
                    onClick: () => void window.open(siteUrl, '_blank', 'noopener'),
                  }
                : null,
              {
                label: t.nav.settings,
                icon: 'settings' as const,
                onClick: () => navigate('/settings'),
              },
              {
                label: (
                  <span className="sb:flex sb:flex-col">
                    {t.nav.signOut}
                    <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">
                      {session?.user.email}
                    </span>
                  </span>
                ),
                icon: 'logout' as const,
                onClick: () => void supabase.auth.signOut(),
              },
            ]}
          />
        </>
      )}
    </header>
  );
}

/** Top bar search across products, orders and customers. Focus it with "/". */
function GlobalSearch() {
  const { sellbase, t, config } = useAdmin();
  const { navigate } = useRouter();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const locale = config.locale === 'en' ? 'en-US' : 'es-MX';

  useEffect(() => {
    const id = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = /input|textarea|select/i.test(target.tagName) || target.isContentEditable;
      if ((e.key === '/' && !typing) || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', close);
    };
  }, []);

  const results = useQuery({
    queryKey: ['sellbase-admin', 'search', term],
    enabled: term.length >= 2,
    queryFn: async () => {
      const [products, orders, customers] = await Promise.all([
        sellbase.admin.products.search({ q: term, limit: 5 }).catch(() => ({ data: [] })),
        sellbase.admin.orders
          .search({ q: term.replace(/^#/, ''), limit: 5 })
          .catch(() => ({ data: [] })),
        sellbase.admin.customers.search({ q: term, limit: 5 }).catch(() => ({ data: [] })),
      ]);
      return { products: products.data, orders: orders.data, customers: customers.data };
    },
  });
  const go = (to: string) => {
    setOpen(false);
    setQ('');
    navigate(to);
  };
  const r = results.data;
  const empty = r && r.products.length + r.orders.length + r.customers.length === 0;

  return (
    <div ref={root} className="sb:relative sb:w-full sb:max-w-xl">
      <div className="sb:flex sb:h-9 sb:items-center sb:gap-2 sb:rounded-lg sb:border sb:border-white/15 sb:bg-white/10 sb:px-2.5 sb:transition sb:focus-within:bg-white sb:focus-within:text-[#1a1a1a]">
        <Icon name="search" className="sb:h-4 sb:w-4 sb:opacity-70" />
        <input
          ref={input}
          type="search"
          value={q}
          placeholder={t.shell.search}
          aria-label={t.shell.searchLabel}
          className="sb:h-full sb:min-w-0 sb:flex-1 sb:border-0 sb:bg-transparent sb:text-sm sb:outline-none sb:placeholder:text-current sb:placeholder:opacity-60"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              input.current?.blur();
            }
          }}
        />
        <kbd className="sba-kbd sb:hidden sb:sm:inline">/</kbd>
      </div>
      {open && term.length >= 2 && (
        <div className="sb:absolute sb:inset-x-0 sb:top-11 sb:z-50 sb:max-h-[70vh] sb:overflow-y-auto sb:rounded-xl sb:bg-white sb:p-2 sb:text-[var(--sba-text)] sb:shadow-[var(--sba-shadow-popover)]">
          {results.isLoading && (
            <p className="sb:px-2 sb:py-3 sb:text-[var(--sba-text-subdued)]">{t.shell.searching}</p>
          )}
          {empty && (
            <p className="sb:px-2 sb:py-3 sb:text-[var(--sba-text-subdued)]">{t.shell.noResults}</p>
          )}
          {r && r.products.length > 0 && (
            <SearchGroup title={t.shell.groups.products}>
              {r.products.map((p) => (
                <SearchRow key={p.id} onClick={() => go(`/products/${p.id}`)}>
                  <Thumbnail src={p.media[0]?.url ?? null} size="sm" />
                  <span className="sb:flex-1 sb:truncate">{p.title}</span>
                </SearchRow>
              ))}
            </SearchGroup>
          )}
          {r && r.orders.length > 0 && (
            <SearchGroup title={t.shell.groups.orders}>
              {r.orders.map((o) => (
                <SearchRow key={o.id} onClick={() => go(`/orders/${o.id}`)}>
                  <Icon name="orders" className="sb:h-4 sb:w-4 sb:text-[var(--sba-text-subdued)]" />
                  <span className="sb:font-semibold">#{o.number}</span>
                  <span className="sb:flex-1 sb:truncate sb:text-[var(--sba-text-subdued)]">
                    {o.email}
                  </span>
                  <span>{formatMoney(o.total_amount, o.currency, locale)}</span>
                </SearchRow>
              ))}
            </SearchGroup>
          )}
          {r && r.customers.length > 0 && (
            <SearchGroup title={t.shell.groups.customers}>
              {r.customers.map((c) => (
                <SearchRow key={c.id} onClick={() => go(`/customers/${c.id}`)}>
                  <Icon
                    name="customers"
                    className="sb:h-4 sb:w-4 sb:text-[var(--sba-text-subdued)]"
                  />
                  <span className="sb:flex-1 sb:truncate">
                    {[c.first_name, c.last_name].filter(Boolean).join(' ') || c.email}
                  </span>
                  <span className="sb:truncate sb:text-[var(--sba-text-subdued)]">{c.email}</span>
                </SearchRow>
              ))}
            </SearchGroup>
          )}
        </div>
      )}
    </div>
  );
}

function SearchGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="sb:mb-1">
      <p className="sb:px-2 sb:pb-1 sb:pt-2 sb:text-xs sb:font-semibold sb:text-[var(--sba-text-subdued)]">
        {title}
      </p>
      {children}
    </div>
  );
}

function SearchRow({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="sb:flex sb:w-full sb:cursor-pointer sb:items-center sb:gap-2 sb:rounded-lg sb:px-2 sb:py-1.5 sb:text-left sb:hover:bg-[var(--sba-surface-hover)]"
    >
      {children}
    </button>
  );
}

// ── Page layout ──────────────────────────────────────────────────────────────

/**
 * Page frame: back link, title with badges, actions on the right. `width` narrow for
 * settings-like pages, wide for tables.
 */
export function Page({
  title,
  backTo,
  backLabel,
  badges,
  subtitle,
  actions,
  children,
  width = 'default',
}: {
  title: ReactNode;
  backTo?: string;
  backLabel?: string;
  badges?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  width?: 'narrow' | 'default' | 'wide';
}) {
  const max =
    width === 'narrow'
      ? 'sb:max-w-3xl'
      : width === 'wide'
        ? 'sb:max-w-[76rem]'
        : 'sb:max-w-[62rem]';
  return (
    <div className={cx('sb:mx-auto sb:flex sb:w-full sb:flex-col sb:gap-4', max)}>
      <div className="sb:flex sb:flex-wrap sb:items-start sb:justify-between sb:gap-3">
        <div className="sb:flex sb:min-w-0 sb:items-start sb:gap-2">
          {backTo && (
            <Link
              to={backTo}
              className="sba-btn sba-btn-tertiary sba-btn-icon sb:-ml-1 sb:mt-[-2px] sba-no-print"
            >
              <Icon name="arrowLeft" className="sb:h-4 sb:w-4" />
              <span className="sb:sr-only">{backLabel}</span>
            </Link>
          )}
          <div className="sb:flex sb:min-w-0 sb:flex-col sb:gap-0.5">
            <div className="sb:flex sb:flex-wrap sb:items-center sb:gap-2">
              <h1 className="sb:text-xl sb:font-bold sb:tracking-tight sb:text-[var(--sba-text-strong)]">
                {title}
              </h1>
              {badges}
            </div>
            {subtitle && <p className="sb:text-[var(--sba-text-subdued)]">{subtitle}</p>}
          </div>
        </div>
        {actions && (
          <div className="sba-no-print sb:flex sb:flex-wrap sb:items-center sb:gap-2">
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/** Two columns on large screens: main content and a narrower aside (Shopify's 2/3 + 1/3). */
export function Layout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="sb:grid sb:items-start sb:gap-4 sb:lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="sb:flex sb:min-w-0 sb:flex-col sb:gap-4">{children}</div>
      {aside && <div className="sb:flex sb:min-w-0 sb:flex-col sb:gap-4">{aside}</div>}
    </div>
  );
}

/** Kept for pages and extensions that use the older header. */
export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="sb:mx-auto sb:mb-4 sb:flex sb:w-full sb:max-w-[62rem] sb:flex-wrap sb:items-center sb:justify-between sb:gap-3">
      <h1 className="sb:text-xl sb:font-bold sb:tracking-tight sb:text-[var(--sba-text-strong)]">
        {children}
      </h1>
      {actions}
    </div>
  );
}

/** Legacy pages render inside this so they share the page width. */
export function PageBody({ children }: { children: ReactNode }) {
  return (
    <div className="sb:mx-auto sb:flex sb:w-full sb:max-w-[62rem] sb:flex-col sb:gap-4">
      {children}
    </div>
  );
}

export const useSaveBarActive = () => useContext(SaveBarStateContext) !== null;
